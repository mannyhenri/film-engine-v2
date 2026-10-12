#!/usr/bin/env python3
"""Pinned local MODNet portrait alpha adapter. CPU decodes/exports; MPS infers.

This is framewise portrait matting, not temporal object tracking or depth.
The isolated launcher supplies FILM_MODNET_ROOT and the unchanged Python runtime.
"""
import argparse
import contextlib
from fractions import Fraction
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import time

os.environ['PYTORCH_ENABLE_MPS_FALLBACK'] = '0'
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
ROOT = Path(os.environ.get('FILM_MODNET_ROOT', Path(__file__).parent)).resolve()
MODEL_SHA = '913b82b66558db39b6286c150f809017d7528c872b156eb14333c9c6cb52108b'
SOURCE_REVISION = '28165a451e4610c9d77cfdf925a94610bb2810fb'
LIMITS = dict(max_width=1920, max_height=1920, max_frames=1800,
              max_raw_bytes=536870912, max_output_pixels=2073600,
              max_source_pixels=16777216, max_model_pixels=1048576,
              max_duration_seconds=60, model_input_size_min=128,
              model_input_size_max=1024, model_input_size_multiple=32)
CANCELLED = False
DEADLINE = None


def sha256(file):
    h = hashlib.sha256()
    with open(file, 'rb') as f:
        for block in iter(lambda: f.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def check():
    if CANCELLED:
        raise RuntimeError('Cancelled')
    if DEADLINE and time.monotonic() > DEADLINE:
        raise RuntimeError('MODNet exceeded twenty-minute runtime limit')


def cancel(_signum, _frame):
    global CANCELLED
    CANCELLED = True


def verify_install():
    manifest_path = ROOT / 'source-manifest.json'
    manifest = json.loads(manifest_path.read_text())
    if manifest['revision'] != SOURCE_REVISION:
        raise RuntimeError('MODNet source revision mismatch')
    for entry in manifest['files']:
        file = (ROOT / 'upstream' / entry['path']).resolve()
        if not file.is_relative_to(ROOT / 'upstream') or sha256(file) != entry['sha256']:
            raise RuntimeError('MODNet source checksum mismatch')
    weights = ROOT / 'modnet_webcam_portrait_matting.ckpt'
    if sha256(weights) != MODEL_SHA or os.environ.get('FILM_MATTE_MODEL_SHA256') != MODEL_SHA:
        raise RuntimeError('MODNet model checksum mismatch')
    return manifest_path, weights


def describe():
    manifest, _ = verify_install()
    return dict(contract='film-matte-worker-v1', operation='subject_alpha',
                provider='modnet-local', model='MODNet-webcam-portrait',
                revision=SOURCE_REVISION, license='Apache-2.0',
                model_sha256=MODEL_SHA, worker_sha256=sha256(__file__),
                source_manifest_sha256=sha256(manifest),
                source_timestamps=True, network_uploads=False, paid=False,
                raw_format='f32le', alpha_mode='straight',
                output_coordinates='encoded', temporal_behavior='framewise',
                fixture=False, backend='pytorch-mps-fp32',
                supported_devices=['mps'], gpu_required_when_selected=True,
                cpu_neural_fallback=False, model_input_rule='longest side rounded down to multiples of 32',
                runtime='PyTorch 2.2.2', **LIMITS)


def decoded_frames(r):
    import av
    import numpy as np
    t = r['timing']
    tb = Fraction(t['time_base']['numerator'], t['time_base']['denominator'])
    if sha256(r['source_path']) != r['source_sha256']:
        raise RuntimeError('Source checksum mismatch')
    turns = round(t.get('display_rotation_degrees', 0) / 90) % 4
    count, index, last_time, next_time, last_duration = 0, 0, None, None, None
    durations = {}
    with av.open(r['source_path']) as container:
        stream = container.streams.video[0]
        if (stream.width, stream.height) != (t['width'], t['height']):
            raise RuntimeError('Source dimensions differ from reviewed timing')
        for packet in container.demux(stream):
            check()
            if packet.pts is not None and packet.duration:
                durations[Fraction(packet.pts) * packet.time_base] = Fraction(packet.duration) * packet.time_base
                if len(durations) > 256:
                    del durations[next(iter(durations))]
            for frame in packet.decode():
                check()
                actual = Fraction(frame.pts) * frame.time_base if frame.pts is not None else None
                if index >= t['end_frame_exclusive']:
                    next_time = actual
                    break
                if index >= t['start_frame']:
                    if actual != t['frames'][count]['pts'] * tb:
                        raise RuntimeError('Decoded frame PTS differs from reviewed source')
                    for side in frame.side_data:
                        if side.type.name == 'DISPLAYMATRIX':
                            matrix = np.frombuffer(bytes(side), dtype='<i4').reshape(3, 3)
                            angle = t.get('display_rotation_degrees', 0) * np.pi / 180
                            expected = np.rint([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]]).astype(np.int64) * 65536
                            if not np.array_equal(matrix[:2, :2], expected):
                                raise RuntimeError('Decoded display rotation differs from reviewed source')
                    rgb = frame.to_ndarray(format='rgb24')
                    if rgb.shape[:2] != (t['height'], t['width']):
                        raise RuntimeError('Source dimensions changed during decode')
                    count += 1
                    last_time, last_duration = actual, durations.get(actual)
                    yield np.rot90(rgb, k=turns).copy() if turns else rgb
                index += 1
            if next_time is not None:
                break
    duration = next_time - last_time if next_time is not None and last_time is not None else last_duration
    if count != t['frame_count'] or duration != t['frames'][-1]['duration_ticks'] * tb:
        raise RuntimeError('Selected frame count or final duration differs from reviewed timing')
    if sha256(r['source_path']) != r['source_sha256']:
        raise RuntimeError('Source changed during inference')


def emit(event):
    print(json.dumps(event), flush=True)


def run(r):
    global DEADLINE
    DEADLINE = time.monotonic() + 1200
    descriptor = describe()
    n, w, h, t = r['settings']['model_input_size'], r['width'], r['height'], r['timing']
    if r['settings']['device'] != 'mps' or os.environ.get('GRIDLIGHT_MATTE_DEVICE') != 'mps':
        raise RuntimeError('Explicit MPS selection required; CPU fallback forbidden')
    if not isinstance(n, int) or not 128 <= n <= 1024 or n % 32:
        raise RuntimeError('MODNet input size must be a multiple of 32 between 128 and 1024')
    if min(w, h) < 1 or max(w, h) > 1920 or w*h > LIMITS['max_output_pixels'] or t['width']*t['height'] > LIMITS['max_source_pixels']:
        raise RuntimeError('Matte geometry exceeds audited limits')
    required = w*h*t['frame_count']*4
    if not 1 <= t['frame_count'] <= 1800 or required > LIMITS['max_raw_bytes'] or t['duration_ticks']*t['time_base']['numerator']/t['time_base']['denominator'] > 60:
        raise RuntimeError('Matte range exceeds audited limits')
    out = Path(r['output_dir']).resolve()
    existing = list(out.iterdir())
    if any(file.resolve() != Path(r['source_path']).resolve() for file in existing):
        raise RuntimeError('Matte output directory contains an existing output')
    import shutil
    if shutil.disk_usage(out).free < required + 16777216:
        raise RuntimeError('Insufficient disk for matte output')
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        import torch.nn.functional as F
        from torch.utils._python_dispatch import TorchDispatchMode
        from torch.utils._pytree import tree_flatten
        if torch.__version__.split('+')[0] != '2.2.2' or not torch.backends.mps.is_available():
            raise RuntimeError('Pinned PyTorch 2.2.2 MPS runtime unavailable; no CPU neural fallback')
        sys.path.insert(0, str(ROOT / 'upstream'))
        from src.models.modnet import MODNet
        model = MODNet(backbone_pretrained=False)
        weights = torch.load(ROOT / 'modnet_webcam_portrait_matting.ckpt', map_location='cpu', weights_only=True)
        model.load_state_dict({k.removeprefix('module.'): v for k, v in weights.items()}, strict=True)
        model = model.eval().float().to('mps')
        stats = dict(gpu_forward_hook_calls=0, gpu_dispatch_output_tensors=0)

        def require_mps(values):
            for value in tree_flatten(values)[0]:
                if isinstance(value, torch.Tensor) and value.device.type != 'mps':
                    raise RuntimeError('Neural tensor escaped MPS; CPU fallback forbidden')

        def hook(_module, args, output):
            require_mps((args, output))
            stats['gpu_forward_hook_calls'] += 1

        for module in model.modules():
            module.register_forward_hook(hook)

        class GPUDispatch(TorchDispatchMode):
            def __torch_dispatch__(self, func, types, args=(), kwargs=None):
                output = func(*args, **(kwargs or {}))
                require_mps(output)
                stats['gpu_dispatch_output_tensors'] += sum(isinstance(x, torch.Tensor) for x in tree_flatten(output)[0])
                return output

    turns = round(t.get('display_rotation_degrees', 0) / 90) % 4
    alpha_path = out / 'alpha.f32'
    started = time.monotonic()
    try:
        with alpha_path.open('wb') as file, torch.inference_mode():
            for i, rgb in enumerate(decoded_frames(r)):
                check()
                # Decode/upload and final download are transport, outside neural dispatch.
                tensor = torch.from_numpy(rgb.copy()).permute(2, 0, 1).unsqueeze(0).to('mps', dtype=torch.float32)
                model_h = max(32, int(rgb.shape[0] * n / max(rgb.shape[:2])) // 32 * 32)
                model_w = max(32, int(rgb.shape[1] * n / max(rgb.shape[:2])) // 32 * 32)
                with GPUDispatch():
                    x = F.interpolate(tensor / 127.5 - 1, size=(model_h, model_w), mode='bilinear', align_corners=False)
                    _, _, alpha = model(x, True)
                    alpha = F.interpolate(alpha, size=(w, h) if turns % 2 else (h, w), mode='bilinear', align_corners=False).clamp(0, 1)
                    if turns:
                        alpha = torch.rot90(alpha, k=-turns, dims=(-2, -1))
                torch.mps.synchronize()
                values = alpha.squeeze().cpu().numpy().astype('<f4')
                file.write(values.tobytes())
                emit(dict(type='progress', progress=(i+1)/t['frame_count'], phase=f'MODNet MPS frame {i+1} of {t["frame_count"]}'))
        check()
        verify_install()
        if alpha_path.stat().st_size != required:
            raise RuntimeError('Alpha output byte count mismatch')
        orientation = dict(coded_width=t['width'], coded_height=t['height'],
                           display_width=t['height'] if turns % 2 else t['width'],
                           display_height=t['width'] if turns % 2 else t['height'],
                           display_rotation_degrees=t.get('display_rotation_degrees', 0), output_coordinates='encoded')
        provenance = dict(backend='mps', neural_device='mps:0', precision='float32', cpu_neural_fallback=False,
                          request_fingerprint=r['request_fingerprint'], source_sha256=r['source_sha256'], model_input_size=n,
                          **{k: descriptor[k] for k in ['model_sha256','worker_sha256','source_manifest_sha256']}, **stats,
                          wall_seconds=time.monotonic()-started, temporal_behavior='framewise', model_grid=[model_w,model_h])
        provenance['timing'] = {**t, 'width': w, 'height': h}
        (out / 'matte-provenance.json').write_text(json.dumps(provenance, indent=2))
        emit(dict(type='result', provenance_file='matte-provenance.json', request_fingerprint=r['request_fingerprint'], source_fingerprint=r['source_fingerprint'],
                  raw_file='alpha.f32', timing={**t,'width':w,'height':h}, orientation=orientation, provenance=provenance))
    except BaseException:
        alpha_path.unlink(missing_ok=True)
        raise


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, cancel)
    signal.signal(signal.SIGINT, cancel)
    parser = argparse.ArgumentParser()
    parser.add_argument('--describe', action='store_true')
    parser.add_argument('--run', action='store_true')
    args = parser.parse_args()
    try:
        if args.describe:
            print(json.dumps(describe()))
        elif args.run:
            line = sys.stdin.readline(1048577)
            if len(line) > 1048576:
                raise RuntimeError('Request exceeds protocol limit')
            run(json.loads(line))
        else:
            raise RuntimeError('Choose --describe or --run')
    except Exception as error:
        emit(dict(type='error', message=str(error)[:200]))
        sys.exit(1)
