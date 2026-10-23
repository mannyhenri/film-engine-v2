"""
The static gate for a Blender build script written by Astra (GPT-6-Astra through Codex).

That script is AI-written code that runs on the user's Mac, so it is read before it runs, and anything
that could reach outside "make geometry, materials and lights in this scene" is refused:
  - imports outside bpy, bmesh, mathutils, math and random
  - builtins that run code, read or write files, or reach objects indirectly: __import__, exec, eval,
    compile, open, getattr / setattr / delattr, globals / locals / vars, input, breakpoint, help
  - any dunder name or attribute (__class__, __globals__, __subclasses__, __builtins__...), the usual
    climb from a harmless object to os
  - the modules themselves by name (os., sys., subprocess, socket, shutil, pathlib, importlib...)
  - bpy operators that load, save, export, import, run scripts or change preferences (bpy.ops.wm.*,
    export_*, import_*, script.*, preferences.*, file.*), and data calls that write or load files or run
    text as code (save, save_render, libraries.load, as_module, execfile...)

The runner (blender-astra.py) applies this before exec, inside the OS sandbox; the backend applies it
first too (lib/astra-build.js), so a refused script never starts Blender. Two layers, on purpose: the
gate keeps honest mistakes and the obvious escapes out, and the sandbox (no network, writes only in the
job folder) holds even if the gate misses something.

Usage: python3 astra_check.py <script.py>  ->  prints {"ok": true} or {"ok": false, "problems": [...]}
"""
import ast
import json
import sys

ALLOWED_IMPORTS = {'bpy', 'bmesh', 'mathutils', 'math', 'random'}
BANNED_NAMES = {'__import__', 'exec', 'eval', 'compile', 'open', 'getattr', 'setattr', 'delattr',
                'globals', 'locals', 'vars', 'input', 'breakpoint', 'help', 'memoryview', 'exit', 'quit'}
BANNED_MODULE_NAMES = {'os', 'sys', 'subprocess', 'socket', 'shutil', 'pathlib', 'importlib', 'ctypes',
                       'urllib', 'http', 'requests', 'pickle', 'marshal', 'builtins', 'io', 'tempfile',
                       'glob', 'signal', 'threading', 'multiprocessing', 'asyncio', 'code', 'runpy'}
BANNED_OPS = {'wm', 'export_scene', 'export_mesh', 'export_anim', 'import_scene', 'import_mesh',
              'import_anim', 'import_image', 'import_curve', 'script', 'preferences', 'file', 'text',
              'sound', 'cachefile', 'ed', 'screen', 'render'}
BANNED_ATTRS = {'save', 'save_render', 'save_mainfile', 'save_as_mainfile', 'save_userpref', 'execfile',
                'as_module', 'load', 'reload', 'filepath_raw', 'unpack', 'pack', 'write', 'quit_blender',
                'register_class', 'unregister_class', 'app', 'utils', 'context_override', 'temp_override',
                'handlers', 'timers', 'msgbus', 'driver_namespace', 'path'}


def _dotted(node):
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return list(reversed(parts))


def check(source):
    problems = []
    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        return [f'syntax error on line {e.lineno}: {e.msg}']
    for node in ast.walk(tree):
        line = getattr(node, 'lineno', '?')
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split('.')[0] not in ALLOWED_IMPORTS:
                    problems.append(f'line {line}: import {a.name} is not allowed (only {", ".join(sorted(ALLOWED_IMPORTS))})')
        elif isinstance(node, ast.ImportFrom):
            if node.level or (node.module or '').split('.')[0] not in ALLOWED_IMPORTS:
                problems.append(f'line {line}: from {node.module or "."} import is not allowed')
        elif isinstance(node, ast.Name):
            if node.id in BANNED_NAMES:
                problems.append(f'line {line}: {node.id} is not allowed')
            elif node.id in BANNED_MODULE_NAMES:
                problems.append(f'line {line}: the {node.id} module is not allowed')
            elif node.id.startswith('__'):
                problems.append(f'line {line}: {node.id} is not allowed (no dunder names)')
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith('__'):
                problems.append(f'line {line}: .{node.attr} is not allowed (no dunder attributes)')
            elif node.attr in BANNED_ATTRS:
                problems.append(f'line {line}: .{node.attr} is not allowed (it reads, writes or runs outside the scene)')
            chain = _dotted(node)
            if len(chain) >= 3 and chain[0] == 'bpy' and chain[1] == 'ops' and chain[2] in BANNED_OPS:
                problems.append(f'line {line}: bpy.ops.{chain[2]} is not allowed (the runner saves and exports)')
            if len(chain) >= 3 and chain[0] == 'bpy' and chain[1] == 'data' and chain[2] == 'libraries':
                problems.append(f'line {line}: bpy.data.libraries is not allowed (no linked files)')
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and '__' in node.value and node.value.strip('_').isidentifier():
            # A dunder hidden in a string, for a getattr-style climb ("__globals__").
            if node.value.startswith('__') and node.value.endswith('__'):
                problems.append(f'line {line}: the string {node.value!r} is not allowed')
    seen, out = set(), []
    for p in problems:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


if __name__ == '__main__':
    src = open(sys.argv[1], encoding='utf-8').read()
    probs = check(src)
    print(json.dumps({'ok': not probs, 'problems': probs}))
    sys.exit(0 if not probs else 3)
