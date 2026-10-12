import {useEffect,useState} from 'react';
export function handoffEligible(review) {
    const p=review.editable?.provenance || {};
    return review.snapshot?.capability==='image' && !p.sequence_id && !p.inbetween_id && p.station_index===undefined && !p.world_version_id && !p.run_id && !p.node_id && !p.pipeline_task && !p.pipeline_run_id
        && Boolean(p.shot_id || (['character','location','prop'].includes(p.subject_kind)&&p.subject_id));
}
export function useDesktopAvailability() {
    const [availability,setAvailability]=useState({available:false,browser_available:typeof window!=='undefined' && !!navigator.clipboard?.writeText && window.isSecureContext,reason:'ChatGPT Desktop handoff requires the Film Engine macOS app.'});
    useEffect(()=>{
        let active=true;
        window.__feImageHandoff?.availability().then(result=>{if(active)setAvailability(result);}).catch(error=>{if(active)setAvailability({available:false,reason:error.message});});
        return ()=>{active=false;};
    },[]);
    return availability;
}
export async function copyHandoff(handoff,destination='chatgpt') {
    if(window.__feImageHandoff)return window.__feImageHandoff.copyAndOpen(handoff.id,destination==='browser'?'browser':'desktop');
    if(destination!=='browser')throw new Error('ChatGPT Desktop handoff requires the Film Engine macOS app.');
    if(!navigator.clipboard?.writeText || !window.isSecureContext)throw new Error('Clipboard access is unavailable. Download the package and copy prompt.txt yourself.');
    await navigator.clipboard.writeText(handoff.prompt);
    const opened=window.open('https://chatgpt.com/','_blank');
    if(opened)opened.opener=null;
    return {copied:true,opened:!!opened,note:'Prompt copied. Paste it in ChatGPT web and attach the exported references yourself.',...(!opened?{error:'Prompt copied. Browser popup blocked; open ChatGPT using the link below.'}:{})};
}
export function ImageHandoffResult({handoff,request,onImported,onFinish}) {
    const [error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
    const t=handoff.target || {};
    const availability=useDesktopAvailability();
    async function copyAgain() {
        setError('');setBusy(true);
        try {const out=await copyHandoff(handoff,availability.available?'chatgpt':'browser');if(!out.copied || !out.opened)throw new Error(out.error || out.reason);setNotice(out.note);}
        catch(e){setError(e.message);}finally{setBusy(false);}
    }
    async function download() {
        setError('');setBusy(true);
        try {
            const out=await request(`/final-request-review/handoffs/${handoff.id}/package`);
            const a=document.createElement('a');a.href=out.data;a.download=out.file_name;a.click();
            setNotice('Package downloaded. Unzip it, paste prompt.txt, then attach the numbered reference files in order.');
        }catch(e){setError(e.message);}finally{setBusy(false);}
    }
    async function importImage(file) {
        if(!file)return;
        setError('');setBusy(true);
        try {
            if(file.size>20*1024*1024)throw new Error('Result image exceeds 20 MB');
            const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Could not read result image'));r.readAsDataURL(file);});
            const result=await request(`/final-request-review/handoffs/${handoff.id}/import`,{data,name:file.name});
            onImported(result);
        }catch(e){setError(e.message);}finally{setBusy(false);}
    }
    return <section aria-label="Saved ChatGPT image handoff">
        <h3>ChatGPT Desktop — manual image handoff</h3>
        <p>Saved target: {t.kind} {t.shot_id || t.subject_id} {t.slot_id || t.view || ''}. Paste with Cmd-V, attach the exported references, and generate in ChatGPT yourself.</p>
        <p>Film Engine sends no API generation and charges no API generation for this handoff. ChatGPT uses its own available models and may interpret the prompt, references and settings differently.</p>
        <details><summary>Saved exact prompt and target</summary><pre>{handoff.prompt}</pre><code>{JSON.stringify(t)}</code></details>
        <button disabled={busy||!(availability.available||availability.browser_available)} onClick={copyAgain}>Copy saved prompt & open ChatGPT</button>
        <a href="https://chatgpt.com/" target="_blank" rel="noreferrer">Open ChatGPT web</a>
        <button disabled={busy} onClick={download}>Download prompt, ordered references and settings</button>
        <label className="btn">Import ChatGPT result as a new version<input aria-label="Import ChatGPT result" type="file" accept="image/png,image/jpeg" disabled={busy} onChange={e=>importImage(e.target.files[0])}/></label>
        {onFinish&&<button disabled={busy} onClick={onFinish}>Keep handoff open for later import</button>}
        {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
    </section>;
}
