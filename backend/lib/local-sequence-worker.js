const {spawn}=require('node:child_process');
const {fail}=require('./depth-media');
function runOwnedWorker(bin,request,{env,signal,onProgress=()=>{},outputDir,timeoutMs=20*60*1000,label='Sequence'}){
 if(signal?.aborted)return Promise.reject(fail('Cancelled',409));
 return new Promise((resolve,reject)=>{
  const child=spawn(bin,['--run'],{cwd:outputDir,env,stdio:['pipe','pipe','pipe'],shell:false});
  let result=null,pending='',failure=null,total=0,killTimer;
  const terminate=reason=>{if(failure)return;failure=fail(reason,409);child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),3000);};
  const abort=()=>terminate('Cancelled');signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timeout=setTimeout(()=>terminate(label+' worker timed out'),timeoutMs);
  child.stdout.on('data',bytes=>{total+=bytes.length;if(total>1024*1024)return terminate(label+' worker output exceeds its protocol limit');pending+=bytes.toString();
   let at;while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);if(!line.trim())continue;
    try{const event=JSON.parse(line);if(event.type==='progress'){if(Number.isFinite(event.progress)&&event.progress>=0&&event.progress<=1)onProgress(event.progress,String(event.phase||'Processing').slice(0,160));}
     else if(event.type==='result'){if(result)throw Error('Multiple worker results');result=event;}
     else if(event.type==='error')terminate(String(event.message||label+' worker failed').slice(0,200));
     else throw Error('Unknown worker event');
    }catch(e){terminate('Invalid '+label.toLowerCase()+' worker protocol: '+e.message);}
   }
  });
  child.stderr.on('data',()=>{});child.on('error',e=>{failure=fail(label+' worker could not start: '+e.code,503);});
  child.on('close',code=>{clearTimeout(timeout);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);if(failure)return reject(failure);if(code!==0||!result||pending.trim())return reject(fail(label+' worker exited without one complete result'));resolve(result);});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({...request,output_dir:outputDir})+'\n');
 });
}
module.exports={runOwnedWorker};
