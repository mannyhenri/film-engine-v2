'use strict';
async function handleImageHandoff(req,res,parts) {
    try {
        const store=require('../lib/image-handoff').store(),id=parts[2]==='handoffs'?parts[3]:parts[2],action=parts[2]==='handoffs'?parts[4]:parts[3];
        let result;
        if(req.method==='POST' && action==='handoff')result=store.create(id,req.body || {});
        else if(req.method==='GET' && action==='expressions') {
            const review=require('../lib/final-request-review').store().get(id),p=review.editable.provenance;
            if(!p.shot_id || review.snapshot.capability!=='image')throw Object.assign(new Error('Expression selection needs a storyboard image request'),{status:400});
            const ctx=require('../lib/capability-payloads').loadShotContext(p.shot_id);
            const matched=require('../lib/shot-references').matchCharacters(ctx.sceneCard.characters,ctx.characters);
            result={characters:matched.map(ch=>({id:ch.id,name:ch.name,slots:require('../lib/character-expressions').store().list(ch.id)}))};
        }
        else if(req.method==='GET' && !action)result=store.get(id);
        else if(req.method==='GET' && action==='package')result=store.packageFor(id);
        else if(req.method==='POST' && action==='import')result=store.importResult(id,req.body || {});
        else throw Object.assign(new Error('Method not allowed'),{status:405});
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
    }catch(error){res.writeHead(error.status || 400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
}
module.exports={handleImageHandoff};
