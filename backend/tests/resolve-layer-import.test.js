const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');
test('guarded Resolve layer helper verifies backup, identity and duplicate boundaries without connecting to Resolve',()=>{const r=spawnSync('/usr/bin/python3',[path.join(__dirname,'fixtures/resolve-layer-import-test.py'),path.join(__dirname,'../lib/resolve-layer-import.py')],{env:{PATH:'/usr/bin:/bin',PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/Ran 5 tests/);});
