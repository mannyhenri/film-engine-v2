const test=require('node:test'),assert=require('node:assert/strict');
const {backendId,matchesWritingBackend}=require('../lib/backend-identity');
test('desktop reuse requires V2 identity and both application writing capabilities',()=>{
 const h={service:'film-engine',version:'1.0.1',backend_id:backendId,capabilities:{ai_connections:1,application_ai_workspace:1}};
 assert.equal(matchesWritingBackend(h,'1.0.1'),true);
 for(const old of [null,{...h,backend_id:'legacy'},{...h,version:'1.0.0'},{...h,capabilities:undefined},{...h,capabilities:{ai_connections:1}}])assert.equal(matchesWritingBackend(old,'1.0.1'),false);
});
