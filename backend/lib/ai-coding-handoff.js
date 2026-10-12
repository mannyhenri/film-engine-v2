const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const TARGET=path.join(os.homedir(),'code','film-engine-v2');
// This control can create and inspect a checkout. It cannot run model text,
// tests, commits, pushes or write the running checkout. Host execution is a
// separate authorization which Film's text relay does not possess.
function createCodingHandoff({target=TARGET,root=path.join(process.env.FILM_DATA_DIR||path.join(os.homedir(),'.gridlight/film-engine/data'),'ai-coding')}={}) {
 const git=(cwd,args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-C',cwd,...args],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024,shell:false,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();
 function inspectTarget(){try{const real=fs.realpathSync(target),top=fs.realpathSync(git(real,['rev-parse','--show-toplevel']));if(real!==top)throw Error('Configured V2 target must be its repository root');return {target:real,head:git(real,['rev-parse','HEAD']),available:true};}catch(e){return {target,available:false,error:'Canonical V2 checkout unavailable: '+e.message};}}
 function dispatch(id,proposal){if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid task-owned checkout identity');const t=inspectTarget();if(!t.available)throw Error(t.error);if(t.head!==proposal.base_commit||t.target!==proposal.target)throw Object.assign(Error('Canonical V2 revision changed. Review a new coding proposal.'),{status:409});fs.mkdirSync(root,{recursive:true});const checkout=path.join(root,id);if(fs.existsSync(checkout))throw Object.assign(Error('This task already has a checkout; use its controlled handoff.'),{status:409});git(t.target,['worktree','add','--detach',checkout,t.head]);fs.writeFileSync(path.join(root,id+'.json'),JSON.stringify({task_id:id,target:t.target,base_commit:t.head,checkout,proposal:proposal.text,execution:'requires_authorized_host',tests:'not_run',commit:'review_required'},null,2));return {kind:'coding',state:'handoff_ready',target:t.target,base_commit:t.head,checkout,manifest:path.join(root,id+'.json'),execution:'requires_authorized_host',tests:'not_run',commit:'review_required'};}
 function review(a){if(a.kind!=='coding'||!a.checkout||path.dirname(a.checkout)!==path.resolve(root))throw Error('No task-owned coding checkout');return {...a,diff:git(a.checkout,['diff',a.base_commit,'--']),status:git(a.checkout,['status','--short']),head:git(a.checkout,['rev-parse','HEAD']),message:'An authorized host must implement and test here. Review the visible diff and test evidence before any commit. Film does not execute assistant instructions or commit changes.'};}
 return {inspectTarget,dispatch,review};
}
module.exports={createCodingHandoff};
