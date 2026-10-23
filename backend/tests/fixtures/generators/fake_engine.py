#!/usr/bin/env python3
"""A stand-in engine for the Generators tests: same CLI shape and progress JSON as the real ones.
FAKE_MODE=fail exits with an error; FAKE_MODE=slow keeps running until killed (for Cancel)."""
import json, os, sys, time
a = sys.argv[1:]
inp = a[0]
def opt(flag, default=None):
    return a[a.index(flag) + 1] if flag in a else default
out, prog = opt('--out') or opt('--outdir'), opt('--progress')
def report(**k):
    tmp = prog + '.tmp'; json.dump(k, open(tmp, 'w')); os.replace(tmp, prog)
mode = os.environ.get('FAKE_MODE', '')
report(stage='Working', done=0, total=4)
if mode == 'fail':
    report(stage='error', error='the fake engine was told to fail'); sys.exit(3)
for i in range(1, 5):
    time.sleep(0.6 if mode == 'slow' else 0.05); report(stage='Working', done=i, total=4)
while mode == 'slow':
    time.sleep(0.2)
with open(out, 'w') as f:
    json.dump({'input': inp, 'args': a}, f)
report(stage='done', done=4, total=4, out=out, stats={'integrated_lufs': -14.02, 'true_peak_dbtp': -2.1, 'nested': {'dropped': 1}}, note='a note from the engine')
