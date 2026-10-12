import { legacy } from '../../lib/legacy.js';

let current = () => null;
let repaint = async () => {};
export function configureExpressions(getSheet, render) { current = getSheet; repaint = render; }
const esc = value => legacy.esc(value);
const arg = value => legacy.jsAttr(value);
async function refresh(id) { if (current()?.id === id) await repaint(); }
function target(id,slotId,revision,expectedSheet) {
    const sheet = current();
    const slot = sheet?.expressions?.find(s => s.slot_id === slotId);
    if ((expectedSheet && sheet!==expectedSheet) || sheet?.id !== id || !slot || slot.revision !== revision) throw new Error('Expression slot changed. Reload it before continuing.');
    return {...slot,sheet};
}
async function action(work) { try { await work(); } catch (error) { legacy.setStatus(error.message); } }
export function expressionSlotsHtml(id,slots,error) {
    if (error) return `<div class="cs-expressions"><p role="alert">Could not load expression references: ${esc(error)}</p></div>`;
    return `<section class="cs-expressions" aria-label="Facial expression references">
      <div class="cs-label"><span>Facial expressions</span><span class="rule"></span><span class="note">face only · selected per storyboard shot</span></div>
      <div class="cs-expression-grid">${(slots || []).map(s => {
        const args = `${arg(id)},${arg(s.slot_id)},${s.revision}`;
        return `<article class="cs-expression-slot" data-expression-slot="${esc(s.slot_id)}">
          ${s.image_url ? `<img src="${esc(legacy.plateSrc(s.image_url,320))}" alt="${esc(s.label)} face reference" onclick="openPlateViewer(${arg(legacy.csImg(s.image_url))},${arg(s.label)})">` : `<div class="cs-expression-empty">${s.missing_reference?'Reference missing':'No face reference'}</div>`}
          <strong>${esc(s.label)}</strong><p>${esc(s.direction)}</p>
          <div class="cs-expression-actions"><button class="btn btn-sm" onclick="customizeExpression(${args})">Customize</button>
          <button class="btn btn-sm" onclick="generateExpression(${args})">Generate</button>
          <label class="btn btn-sm">Upload<input type="file" accept="image/png,image/jpeg" onchange="uploadExpression(${args},this.files[0])" hidden></label>
          <button class="btn btn-sm" onclick="chooseExpressionReference(${args})">Choose image</button></div>
          <label>Version<select aria-label="${esc(s.label)} reference version" onchange="selectExpressionVersion(${args},this.value)"><option value="">No selection</option>
            ${(s.versions || []).map(v => `<option value="${esc(v.id)}" ${v.id===s.active_asset_id?'selected':''} ${v.file_exists?'':'disabled'}>v${v.version} · ${esc(v.metadata?.expression_label || s.label)}${v.file_exists?'':' · missing'}</option>`).join('')}</select></label>
        </article>`;
      }).join('')}</div>
      <p class="text-sm text-muted">Each Generate reviews one image. Upload or choose an existing face image to avoid a generation. Versions stay in the gallery. Choose an expression explicitly in a storyboard request; body identity and scene references keep their slots.</p>
    </section>`;
}
export async function customizeExpression(id,slotId,revision) {
    return action(async () => {
        const s=target(id,slotId,revision);
        const label=window.prompt('Expression label — adapt it to this character or creature',s.label);
        if (label===null) return;
        const direction=window.prompt('Exact facial expression direction',s.direction || '');
        if (direction===null) return;
        target(id,slotId,revision);
        await legacy.api(`/characters/${id}/expressions/${slotId}`,{method:'PUT',body:JSON.stringify({revision,label,direction})});
        await refresh(id);
    });
}
export async function selectExpressionVersion(id,slotId,revision,assetId) {
    return action(async () => {
        target(id,slotId,revision);
        await legacy.api(`/characters/${id}/expressions/${slotId}`,{method:'PUT',body:JSON.stringify({revision,asset_id:assetId || null})});
        await refresh(id);
    });
}
export async function uploadExpression(id,slotId,revision,file) {
    if (!file) return;
    return action(async () => {
        const captured=target(id,slotId,revision);
        if(file.size>20*1024*1024) throw new Error('Expression image exceeds 20 MB');
        const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Could not read this image'));r.readAsDataURL(file);});
        target(id,slotId,revision,captured.sheet);
        await legacy.api(`/characters/${id}/expressions/${slotId}/import`,{method:'POST',body:JSON.stringify({revision,data,name:file.name})});
        await refresh(id);
    });
}
export async function chooseExpressionReference(id,slotId,revision) {
    return action(async () => {
        const captured=target(id,slotId,revision);
        const gallery=await legacy.api(`/characters/${id}/gallery`);
        target(id,slotId,revision,captured.sheet);
        const items=(gallery.items || []).filter(a=>a.image_url && a.file_exists!==false);
        if(!items.length) throw new Error('No existing character images. Upload a face reference first.');
        const choice=window.prompt('Select an existing face image by number. Its original remains in the gallery.\n'+items.map((a,i)=>`${i+1}. ${a.note || a.view || a.id}`).join('\n'),'');
        if(choice===null) return;
        const selected=items[Number(choice)-1];
        if(!selected || !/^[1-9][0-9]*$/.test(choice)) throw new Error('Choose a listed image number');
        target(id,slotId,revision,captured.sheet);
        await legacy.api(`/characters/${id}/expressions/${slotId}/import`,{method:'POST',body:JSON.stringify({revision,source_asset_id:selected.id})});
        await refresh(id);
    });
}
export async function generateExpression(id,slotId,revision) {
    return action(async () => {
        const s=target(id,slotId,revision);
        const key=`${id}:${slotId}`;
        if(busy.has(key)) return;
        busy.add(key);
        legacy.setStatus(`Reviewing ${s.label} face reference…`,true);
        try {
            // api's existing final-request bridge resolves, reviews and explicitly approves before any provider call.
            const result=await legacy.api(`/characters/${id}/expressions/${slotId}/generate`,{method:'POST',body:JSON.stringify({revision})});
            legacy.setStatus(result.manual_handoff?'ChatGPT handoff saved — generate manually, then import the result into this expression slot':result.pending?`Expression generation pending — collect job ${result.job_id}`:result.activated?'Expression version selected':'Expression saved in history; a newer slot selection was preserved');
        } finally { busy.delete(key); await refresh(id); }
    });
}
const busy=new Set();
