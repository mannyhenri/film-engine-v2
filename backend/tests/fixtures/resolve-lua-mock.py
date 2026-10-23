# Runs a generated "Load into Resolve.lua" against a stand-in Resolve (lupa: Lua 5.x in Python) and prints, as JSON,
# every API call it made. Used by tests/production-cuts.test.js when FILM_TEST_LUPA_PYTHON names a Python with lupa.
import json, sys
from lupa import LuaRuntime
calls = []
L = LuaRuntime(unpack_returned_tuples=True)
def rec(name, ret=None):
    def f(self, *a):
        calls.append([name] + [list(x.values()) if hasattr(x, 'values') and name == 'ImportMedia' else (dict(x) if hasattr(x, 'items') else x) for x in a])
        return ret
    return f
L.execute('''function make(rec, py)
  local tl = { AddMarker = rec("AddMarker", true) }
  local pool = { GetRootFolder = rec("GetRootFolder", "root"), AddSubFolder = function(self, p, n) py("AddSubFolder", n); return "bin:" .. n end,
    SetCurrentFolder = rec("SetCurrentFolder", true), ImportMedia = function(self, files) py("ImportMedia", files); local out = {}; for i = 1, #files do out[i] = i end; return out end,
    ImportTimelineFromFile = function(self, p, o) py("ImportTimelineFromFile", p, o); return tl end }
  local project = { SetSetting = rec("SetSetting", true), GetMediaPool = function() return pool end, SetCurrentTimeline = rec("SetCurrentTimeline", true) }
  local pm = { CreateProject = function(self, n) py("CreateProject", n); return project end, SaveProject = rec("SaveProject", true) }
  return { GetProjectManager = function() return pm end, OpenPage = rec("OpenPage", true) }
end''')
def py(name, *a):
    out = [name]
    for x in a:
        if hasattr(x, 'items'):
            d = dict(x.items()); out.append(list(d.values()) if all(isinstance(k, int) for k in d) else d)
        else: out.append(x)
    calls.append(out)
lrec = lambda name, ret=None: (lambda *a: (calls.append([name] + [x for x in a[1:] if not hasattr(x, 'items')]), ret)[1])
L.globals().resolve = L.globals().make(lrec, py)
printed = []
L.globals().print = lambda *a: printed.append(' '.join(str(x) for x in a))
L.execute(open(sys.argv[1], encoding='utf-8').read())
print(json.dumps({ 'calls': calls, 'printed': printed }))
