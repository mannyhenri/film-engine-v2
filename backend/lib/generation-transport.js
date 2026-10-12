'use strict';
/** Receipts cover creative dispatch only. Uploads, downloads and polling are not generations. */
const requests=new WeakMap();
const sha=bytes=>require('./final-request-review').hash(bytes);
const canonical=value=>require('./final-request-review').canonical(value);
function attach(request,context){requests.set(request,{...context,hosted:new Map()});return request;}
function hosted(request,source,url){
 const context=requests.get(request);if(!context)throw new Error('Hosted media needs an approved request');
 const ref=context.snapshot.references.find(r=>r.data===source);
 if(!ref)throw new Error('Uploaded bytes were not part of this approved request');
 const values=context.hosted.get(ref.sha256)||new Set();values.add(url);context.hosted.set(ref.sha256,values);
}
function hostedList(request,sources,urls){sources.forEach((source,index)=>hosted(request,source,urls[index]));}
function valueAt(body,ref){
 if(body.encoding==='multipart')return body.fields[ref.wire_index ?? body.fields.findIndex(f=>f.name===ref.wire_role && f.data)];
 return String(ref.wire_role||ref.role).replace(/\[(\d+)\]/g,'.$1').split('.').filter(Boolean).reduce((v,key)=>v?.[key],body);
}
function bytesOf(value){
 if(typeof value==='string' && /^data:[^;,]+;base64,/s.test(value))return Buffer.from(value.slice(value.indexOf(',')+1),'base64');
 if(value?.data_base64)return Buffer.from(value.data_base64,'base64');
 if(value?.data && typeof value.data==='string')return Buffer.from(value.data,'base64');
 return null;
}
function transportReferences(context,body){return(context.snapshot.references||[]).map(ref=>{
 const value=valueAt(body,ref),bytes=bytesOf(value);
 let representation;
 if(bytes && sha(bytes)===ref.sha256 && canonical(value)===canonical(valueAt(context.snapshot.body,ref)))representation='inline_bytes';
 else if(typeof value==='string' && context.hosted.get(ref.sha256)?.has(value))representation='adapter_upload';
 else throw new Error(`The actual transport cannot prove approved reference bytes/role/order at ${ref.wire_role||ref.role}`);
 return {...ref,transport_value:value,representation,...(representation==='adapter_upload'?{remote_content:'not_verified'}:{})};
});}
function assertApprovedSemantics(context,body){
 const normalized=JSON.parse(JSON.stringify(body));
 for(const ref of context.snapshot.references||[]){
  if(normalized.encoding==='multipart')continue;
  const keys=String(ref.wire_role||ref.role).replace(/\[(\d+)\]/g,'.$1').split('.').filter(Boolean),last=keys.pop();
  const parent=keys.reduce((value,key)=>value?.[key],normalized);
  if(parent)parent[last]=valueAt(context.snapshot.body,ref);
 }
 if(canonical(normalized)!==canonical(context.snapshot.body))throw new Error('Creative prompt, model or settings changed after approval; prepare a new review');
}
async function serialize(url,init){
 if(init.body instanceof FormData){
  const fields=[];for(const[name,value]of init.body.entries())fields.push(typeof value==='string'?{name,value}:{name,mime:value.type,filename:value.name,data:Buffer.from(await value.arrayBuffer()).toString('base64')});
  // Send this same encoded body, including its boundary. Serializing another
  // FormData would create a different boundary and would not be an exact receipt.
  const encoded=new Request(url,{method:init.method,body:init.body}),bytes=Buffer.from(await encoded.arrayBuffer());
  const headers=new Headers(init.headers);headers.set('Content-Type',encoded.headers.get('Content-Type'));
  return{body:{encoding:'multipart',fields},bytes,serialized_body:null,serialized_base64:bytes.toString('base64'),init:{...init,headers,body:bytes}};
 }
 if(typeof init.body!=='string')throw new Error('Creative transport needs an explicit serialized body');
 return{body:JSON.parse(init.body),bytes:Buffer.from(init.body),serialized_body:init.body,serialized_base64:null,init};
}
function redactMediaCredentials(value,redactions,path='body'){
 if(Array.isArray(value))return value.map((v,i)=>redactMediaCredentials(v,redactions,`${path}[${i}]`));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redactMediaCredentials(v,redactions,`${path}.${k}`)]));
 if(typeof value==='string' && /^https?:\/\//i.test(value)){
  const url=new URL(value);let changed=false;
  if(url.username||url.password){url.username='redacted';url.password='redacted';changed=true;}
  for(const key of [...url.searchParams.keys()])if(/^(?:key|api[_-]?key|token|access[_-]?token|authorization|auth|secret|credential|signature|sig|policy|key-pair-id)$|(?:secret|auth[_-]?token|api[_-]?key|x-amz-|x-goog-)/i.test(key)){url.searchParams.set(key,'redacted');changed=true;}
  if(changed){redactions.push(path);return url.toString();}
 }
 return value;
}
async function dispatch(request,url,init){
 const context=requests.get(request);if(!context)throw new Error('Creative dispatch needs a claimed approved request');
 require('./manual-generation').assertSendable(context.snapshot.provider,context.snapshot.capability);
 if(url!==context.snapshot.endpoint)throw new Error('Provider endpoint changed after approval');
 const encoded=await serialize(url,init),references=transportReferences(context,encoded.body);
 assertApprovedSemantics(context,encoded.body);
 const redactions=[],safeBody=redactMediaCredentials(encoded.body,redactions),safeReferences=redactMediaCredentials(references,redactions,'references');
 const id=context.store.recordTransport(context.reviewId,{endpoint:url,method:String(init.method||'POST').toUpperCase(),body:safeBody,serialized_body:redactions.length?null:encoded.serialized_body,serialized_base64:redactions.length?null:encoded.serialized_base64,serialization_exact:!redactions.length,redactions,body_sha256:sha(encoded.bytes),references:safeReferences,sent_at:new Date().toISOString()});
 // Failure to persist above stops before paid dispatch. Once attempted, a
 // bookkeeping failure must not hide an accepted provider response.
 try{const response=await fetch(url,encoded.init);try{context.store.settleTransport(id,'http_response',response.status);}catch(_){}return response;}
 catch(error){try{context.store.settleTransport(id,'acceptance_unknown',null);}catch(_){}throw error;}
}
module.exports={attach,hosted,hostedList,dispatch};
