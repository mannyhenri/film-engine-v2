import {describe,it,expect} from 'vitest';
import {readFileSync} from 'fs';
import path from 'path';

// public/legacy/core.js is generated (tools/split-map.js) from a source that is not
// in this repo. The bridge hands back {__manual_handoff} for a route it already
// completed; both legacy callers must return it instead of posting again.
const core=readFileSync(path.resolve(process.cwd(),'public/legacy/core.js'),'utf8');
const body=name=>{const i=core.indexOf(name);expect(i,name+' exists').toBeGreaterThan(-1);return core.slice(i,i+4000);};
describe('legacy callers honour the bridge passthrough',()=>{
 it('api() returns the passthrough before fetching',()=>{
  const b=body('async function api(path, opts = {})');
  const prepare=b.indexOf('__fePrepareFinalRequest(path, opts)'),handoff=b.indexOf('if (opts.__manual_handoff) return opts.__manual_handoff;'),fetchAt=b.indexOf('await fetch(');
  expect(prepare).toBeGreaterThan(-1);expect(handoff).toBeGreaterThan(prepare);expect(fetchAt).toBeGreaterThan(handoff);
 });
 it('streamSSEPost finishes on the passthrough before opening its own stream',()=>{
  const b=body('async function streamSSEPost(path, body, onEvent, onDone, onError)');
  const handoff=b.indexOf('if (approved.__manual_handoff) {'),ret=b.indexOf('return;',handoff),fetchAt=b.indexOf('await fetch(');
  expect(handoff).toBeGreaterThan(-1);expect(ret).toBeGreaterThan(handoff);expect(fetchAt).toBeGreaterThan(ret);
  expect(b).toMatch(/window\.__feObserveFinalRequestState\?\.\(data\)/);
 });
});
