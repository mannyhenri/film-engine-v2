import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('layers', sys.argv[1])
layers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(layers)
sys.argv = [sys.argv[0]]

class Timeline:
    def __init__(self, owner, uid): self.owner, self.uid = owner, uid
    def GetUniqueId(self): return self.uid
    def GetName(self): return 'Original' if self.uid == 'original' else 'Duplicate'
    def GetSettings(self): return {'timelineFrameRate': '24', 'timelineResolutionWidth': '64', 'timelineResolutionHeight': '48'}
    def GetEndFrame(self): return 100
    def GetTrackCount(self, kind): return 3
    def AddTrack(self, kind): self.owner.events.append(('add_track', self.uid)); return True
    def DuplicateTimeline(self, name):
        self.owner.events.append(('duplicate', self.uid))
        return self if self.owner.bad_duplicate else self.owner.duplicate
class Manager:
    def __init__(self):
        self.events = []; self.backup_ok = True; self.bad_duplicate = False
        self.original = Timeline(self, 'original'); self.duplicate = Timeline(self, 'duplicate'); self.current = self.original
    def GetProjectManager(self): return self
    def GetCurrentProject(self): return self
    def GetCurrentTimeline(self): return self.current
    def GetUniqueId(self): return 'project'
    def GetName(self): return 'Owned project'
    def GetMediaPool(self): return self
    def SaveProject(self): self.events.append(('save', self.current.uid)); return True
    def ExportProject(self, name, file, stills):
        self.events.append(('backup', name))
        if self.backup_ok: Path(file).write_bytes(b'fake drp backup for guard test')
        return self.backup_ok
    def SetCurrentTimeline(self, timeline): self.current = timeline; self.events.append(('select', timeline.uid)); return True
    def ImportMedia(self, records): self.events.append(('import', self.current.uid)); return ['background', 'foreground']
    def AppendToTimeline(self, records): self.events.append(('append', self.current.uid, records)); return ['background-item', 'foreground-item']

class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name); self.manager = Manager()
        self.manifest = {'contract': 'film-resolve-layers-v1', 'fixture': False, 'native_import_ready': True,
            'orientation': {'display_width': 64, 'display_height': 48}, 'timing': {'frame_count': 4, 'fps': {'numerator': 24, 'denominator': 1}}, 'files': []}
        for role in ['background_layer', 'foreground_layer']:
            file = self.root / (role + '.mov'); file.write_bytes(role.encode())
            self.manifest['files'].append({'role': role, 'name': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
        self.write()
    def tearDown(self): self.temp.cleanup()
    def write(self):
        (self.root/'manifest.json').write_text(json.dumps(self.manifest)); self.pin = hashlib.sha256((self.root/'manifest.json').read_bytes()).hexdigest()
    def run_import(self, **kwargs): return layers.import_reviewed(self.manager, self.root, 'project', 'original', expected_manifest_sha256=self.pin, **kwargs)
    def test_verified_backup_precedes_duplicate_and_only_duplicate_receives_layers(self):
        result = self.run_import(); self.assertEqual(result['status'], 'layers_imported_visual_review_required')
        names = [e[0] for e in self.manager.events]; self.assertLess(names.index('backup'), names.index('duplicate')); self.assertLess(names.index('duplicate'), names.index('import'))
        entry = next(e for e in self.manager.events if e[0]=='append'); self.assertEqual(entry[1], 'duplicate'); self.assertEqual([r['trackIndex'] for r in entry[2]], [4,5]); self.assertEqual(entry[2][0]['recordFrame'], 101)
        self.assertIs(self.manager.current, self.manager.original); self.assertTrue(Path(result['backup']).is_file())
    def test_failed_backup_prevents_duplicate_and_import(self):
        self.manager.backup_ok = False
        with self.assertRaisesRegex(RuntimeError, 'backup'): self.run_import()
        self.assertFalse(any(e[0] in ['duplicate','import','append'] for e in self.manager.events))
    def test_manifest_or_layer_tamper_prevents_any_project_change(self):
        (self.root/'manifest.json').write_text('{}')
        with self.assertRaisesRegex(RuntimeError, 'checksum'): self.run_import()
        self.write(); (self.root/'foreground_layer.mov').write_bytes(b'changed')
        with self.assertRaisesRegex(RuntimeError, 'bytes changed'): self.run_import()
        self.assertEqual(self.manager.events, [])
    def test_wrong_project_vfr_and_fixture_are_gated_before_backup(self):
        with self.assertRaisesRegex(RuntimeError, 'identities'): layers.import_reviewed(self.manager,self.root,'other','original',expected_manifest_sha256=self.pin)
        self.manifest.update(native_import_ready=False,native_import_blockers=['VFR conform']); self.write()
        with self.assertRaisesRegex(RuntimeError, 'conform'): self.run_import()
        self.manifest.update(native_import_ready=True,fixture=True); self.write()
        with self.assertRaisesRegex(RuntimeError, 'Synthetic'): self.run_import()
        self.assertEqual(self.manager.events, [])
    def test_original_timeline_is_restored_after_duplicate_failure(self):
        self.manager.bad_duplicate=True
        with self.assertRaisesRegex(RuntimeError, 'separate duplicate'): self.run_import()
        self.assertIs(self.manager.current,self.manager.original); self.assertFalse(any(e[0]=='import' for e in self.manager.events))
unittest.main()
