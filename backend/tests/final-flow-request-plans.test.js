'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('module');
const original=Module._load,calls=[];
Module._load=function(id,parent,...args){
 if(parent?.filename.endsWith('/final-flow-request-plans.js')&&id==='./flow-executor')return {
  resolveNodeInputs(graph,id,outputs){const result={};for(const e of graph.edges.filter(e=>e.to===id))result[e.toPort]=outputs[e.from]?.[e.fromPort];return result;},
  async executeNode(node,inputs,ctx){calls.push(node.id);assert.equal(ctx.finalRequestPreview,true);if(node.type==='in.prompt')return {ok:true,outputs:{text:{value:node.config.text}}};return {ok:true,previewRequests:[{provider:'runway',capability:'image',payload:{prompt:inputs.text?.value||node.id},provenance:{node_id:node.id}}]};}
 };
 return original.call(this,id,parent,...args);
};
const {planGraph}=require('../lib/final-flow-request-plans');
test.after(()=>{Module._load=original;});
const edge=(from,to,fromPort='text',toPort='text')=>({from,to,fromPort,toPort});
test('independent generators prepare every actual node after local inputs in graph order',async()=>{
 calls.length=0;const graph={nodes:[{id:'prompt',type:'in.prompt',config:{text:'exact'}},{id:'a',type:'gen.image'},{id:'b',type:'gen.image'}],edges:[edge('prompt','a'),edge('prompt','b')]};
 const result=await planGraph(graph,{});assert.deepEqual(result.items.map(x=>x.payload.prompt),['exact','exact']);assert.deepEqual(calls,['prompt','a','b']);
});
test('future generated reference pauses planning after the first ready generation phase',async()=>{
 calls.length=0;const graph={nodes:[{id:'a',type:'gen.image'},{id:'b',type:'gen.video'}],edges:[edge('a','b','image','image')]};
 const planned=await planGraph(graph,{});assert.equal(planned.items.length,1);assert.deepEqual(calls,['a']);
});
test('branch/control execution requires staged review and never runs during prepare',async()=>{
 calls.length=0;const graph={nodes:[{id:'branch',type:'ctl.fanout',config:{count:2}},{id:'a',type:'gen.image'}],edges:[]};
 await assert.rejects(planGraph(graph,{}));assert.deepEqual(calls,[]);
});
