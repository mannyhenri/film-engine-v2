const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {processOutput,readChunks,hashFile}=require('../lib/depth-media');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'film-media-boundary-'));
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('generic media runner closes stdin and forces encoder interactive input off',async()=>{
 const executable=path.join(root,'ffmpeg');fs.writeFileSync(executable,'#!'+process.execPath+'\nlet bytes=0;process.stdin.on("data",b=>bytes+=b.length);process.stdin.on("end",()=>console.log(JSON.stringify({args:process.argv.slice(2),bytes})));');fs.chmodSync(executable,0o700);
 const output=JSON.parse(await processOutput(executable,['-v','error','-nostdin','sample']));assert.deepEqual(output,{args:['-nostdin','-v','error','sample'],bytes:0});
 const controller=new AbortController();controller.abort();await assert.rejects(processOutput(path.join(root,'missing'),[],{signal:controller.signal}),/Cancelled/);
});
test('bounded file reads preserve every byte and cancellation closes the file',async()=>{
 const file=path.join(root,'bytes');const data=Buffer.from(Array.from({length:77},(_,i)=>i));fs.writeFileSync(file,data);
 const chunks=[];for await(const chunk of readChunks(file,{chunkSize:16}))chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),data);
 assert.equal(await hashFile(file),require('node:crypto').createHash('sha256').update(data).digest('hex'));
 const controller=new AbortController();const reader=readChunks(file,{signal:controller.signal,chunkSize:16});await reader.next();controller.abort();await assert.rejects(reader.next(),/Cancelled/);fs.renameSync(file,path.join(root,'closed'));
});
