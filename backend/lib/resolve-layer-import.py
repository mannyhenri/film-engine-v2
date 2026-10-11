"""Explicit, guarded import into a duplicate of the current Resolve timeline.

This file never discovers a connection, changes permissions or runs on import.
Pass an already authorized Resolve object and exact project/timeline identities.
"""
import hashlib
import json
import uuid
from fractions import Fraction
from pathlib import Path


def _hash(path):
    with path.open('rb') as stream:
        value = hashlib.sha256()
        for block in iter(lambda: stream.read(1048576), b''):
            value.update(block)
    return value.hexdigest()


def inspect_current(resolve):
    manager = resolve.GetProjectManager()
    project = manager.GetCurrentProject()
    timeline = project.GetCurrentTimeline() if project else None
    if not project or not timeline:
        raise RuntimeError('Open the intended project and timeline first')
    return {'project_id': project.GetUniqueId(), 'project_name': project.GetName(),
            'timeline_id': timeline.GetUniqueId(), 'timeline_name': timeline.GetName(),
            'settings': timeline.GetSettings()}


def _fps(value):
    text = str(value).strip()
    return {'23.976': Fraction(24000, 1001), '29.97': Fraction(30000, 1001),
            '59.94': Fraction(60000, 1001)}.get(text, Fraction(text))


def import_reviewed(resolve, package, expected_project_id, expected_timeline_id, *, expected_manifest_sha256, allow_fixture=False):
    root = Path(package).resolve(strict=True)
    manifest_path = root / 'manifest.json'
    if manifest_path.is_symlink():
        raise RuntimeError('Package manifest must be a regular local file')
    if _hash(manifest_path) != expected_manifest_sha256:
        raise RuntimeError('Package manifest differs from the reviewed checksum')
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('contract') != 'film-resolve-layers-v1':
        raise RuntimeError('Unsupported layer package')
    if manifest.get('fixture') and not allow_fixture:
        raise RuntimeError('Synthetic test package; explicitly allow fixture import only for a test')
    if not manifest.get('native_import_ready'):
        raise RuntimeError('Manual conform required: ' + '; '.join(manifest.get('native_import_blockers', [])))
    files = {}
    for entry in manifest['files']:
        candidate = root / entry['name']
        resolved = candidate.resolve(strict=True)
        if candidate.is_symlink() or not resolved.is_relative_to(root) or not resolved.is_file():
            raise RuntimeError('Package file is outside the reviewed package')
        if _hash(resolved) != entry['sha256']:
            raise RuntimeError('Package bytes changed: ' + entry['name'])
        files[entry['role']] = resolved
    manager = resolve.GetProjectManager()
    project = manager.GetCurrentProject()
    original = project.GetCurrentTimeline() if project else None
    if not project or not original or project.GetUniqueId() != expected_project_id or original.GetUniqueId() != expected_timeline_id:
        raise RuntimeError('The active project or timeline differs from the reviewed identities')
    settings = original.GetSettings()
    rate = manifest['timing']['fps']
    if _fps(settings['timelineFrameRate']) != Fraction(rate['numerator'], rate['denominator']):
        raise RuntimeError('Timeline frame rate differs; conform manually before importing')
    o = manifest['orientation']
    if int(settings['timelineResolutionWidth']) != o['display_width'] or int(settings['timelineResolutionHeight']) != o['display_height']:
        raise RuntimeError('Timeline dimensions differ; conform manually before importing')
    backups = root / 'Resolve Backups'
    backups.mkdir(exist_ok=True)
    if backups.is_symlink():
        raise RuntimeError('Backup folder must be inside this package')
    backup = backups / ('before-layer-import-' + str(uuid.uuid4()) + '.drp')
    if not manager.SaveProject():
        raise RuntimeError('Resolve could not save the current project; no import attempted')
    if not manager.ExportProject(project.GetName(), str(backup), True) or backup.is_symlink() or not backup.is_file() or backup.stat().st_size < 1:
        raise RuntimeError('Project backup was not verified; no import attempted')
    receipt = {'project_id': expected_project_id, 'original_timeline_id': expected_timeline_id,
               'backup': str(backup), 'backup_sha256': _hash(backup), 'status': 'backup_verified'}
    receipt_path = backups / (backup.stem + '-receipt.json')
    receipt_path.write_text(json.dumps(receipt, indent=2))
    try:
        duplicate = original.DuplicateTimeline(original.GetName() + ' — Film layers ' + str(uuid.uuid4())[:8])
        if not duplicate or duplicate.GetUniqueId() == original.GetUniqueId():
            raise RuntimeError('A separate duplicate timeline was not created')
        receipt['duplicate_timeline_id'] = duplicate.GetUniqueId()
        if not project.SetCurrentTimeline(duplicate):
            raise RuntimeError('Could not select the duplicate timeline')
        pool = project.GetMediaPool()
        imported = pool.ImportMedia([{'media': str(files['background_layer'])}, {'media': str(files['foreground_layer'])}])
        if not imported or len(imported) != 2:
            raise RuntimeError('Layer media could not be imported')
        existing = duplicate.GetTrackCount('video')
        if not duplicate.AddTrack('video') or not duplicate.AddTrack('video'):
            raise RuntimeError('Could not add video tracks to the duplicate')
        start = duplicate.GetEndFrame() + 1
        count = manifest['timing']['frame_count']
        items = pool.AppendToTimeline([{'mediaPoolItem': item, 'startFrame': 0, 'endFrame': count-1,
                    'mediaType': 1, 'trackIndex': existing+i+1, 'recordFrame': start} for i, item in enumerate(imported)])
        if not items or len(items) != 2:
            raise RuntimeError('Layers did not append completely; inspect the duplicate before retrying')
        receipt.update(status='layers_imported_visual_review_required', record_frame=start,
                       frame_count=count, source_audio='Original source remains in package; align audio manually')
        if not manager.SaveProject():
            raise RuntimeError('Layers imported but project save failed; inspect the duplicate')
        return receipt
    except Exception as error:
        receipt.update(status='failed_inspect_duplicate', error=str(error))
        raise
    finally:
        restored = project.SetCurrentTimeline(original)
        receipt['original_timeline_restored'] = bool(restored)
        receipt_path.write_text(json.dumps(receipt, indent=2))
        if not restored:
            raise RuntimeError('Could not restore original timeline selection; inspect Resolve')
