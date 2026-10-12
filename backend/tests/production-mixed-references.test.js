'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {resolveFinalRequest}=require('../lib/final-provider-request');
const {instruction}=require('../lib/moodboard-influence');
const uri=bytes=>'data:image/png;base64,'+Buffer.from(bytes).toString('base64');
function payload(duplicate=false) {
    const start={uri:uri('start frame'),asset_id:'start',reference_role:'first_frame'};
    const look={uri:duplicate?start.uri:uri('style plate'),asset_id:'look',moodboard_entry_id:'look-row',reference_role:'style',influence_roles:['style'],influence_note:'Use lighting only'};
    return {model:'seedance-2.5',workflow:'omni-reference',prompt:'Move forward. '+instruction(look,2),init_image:start,reference_images:[look]};
}
test('mixed start frame and Moodboard use actual image positions and retain separate source roles',async()=>{
    const p=payload(),snapshot=await resolveFinalRequest('seedance','video',p);
    assert.deepEqual(snapshot.references.map(r=>r.asset_id),['start','look']);
    assert.deepEqual(snapshot.references.map(r=>r.role),['first_frame','style']);
    assert.deepEqual(snapshot.references.map(r=>r.order),[1,2]);
    assert.equal(snapshot.references[1].moodboard_entry_id,'look-row');
});
test('equal bytes in different keyframe and plate roles retain both actual wire positions',async()=>{
    const p=payload(true),snapshot=await resolveFinalRequest('seedance','video',p);
    assert.equal(snapshot.references.length,2);
    assert.deepEqual(snapshot.references.map(r=>r.asset_id),['start','look']);
    assert.deepEqual(snapshot.references.map(r=>r.role),['first_frame','style']);
    assert.equal(snapshot.references[0].moodboard_entry_id,undefined);
});
test('a Moodboard instruction naming the wrong actual input position is refused',async()=>{
    const p=payload();p.prompt='Move forward. '+instruction(p.reference_images[0],1);
    await assert.rejects(()=>resolveFinalRequest('seedance','video',p),/influence instructions/);
});
