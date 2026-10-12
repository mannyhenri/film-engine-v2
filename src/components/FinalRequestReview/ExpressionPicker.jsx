import {useEffect,useState} from 'react';
export default function ExpressionPicker({review,request,onApply,disabled}) {
    const [characters,setCharacters]=useState([]),[selected,setSelected]=useState({}),[error,setError]=useState('');
    useEffect(()=>{
        let active=true;
        request(`/final-request-review/${review.id}/expressions`).then(data=>{if(active){setCharacters(data.characters || []);setError('');}}).catch(e=>{if(active)setError(e.message);});
        const selections=review.route_request?.body?.expression_references || [];
        setSelected(Object.fromEntries(selections.map(s=>[s.character_id,s.asset_id])));
        return ()=>{active=false;};
    },[review.id,request]);
    function apply() {
        const selections=[];
        for(const ch of characters) {
            const slot=ch.slots.find(s=>s.active_asset_id===selected[ch.id] && s.image_url);
            if(slot)selections.push({character_id:ch.id,slot_id:slot.slot_id,asset_id:slot.active_asset_id,revision:slot.revision});
        }
        onApply(selections);
    }
    return <fieldset><legend>Facial expression references for this shot</legend>
        <p>Optional: one selected face reference per character. Identity, scene anchor, location and style references keep their slots. An over-budget selection is refused before generation.</p>
        {characters.map(ch=><label key={ch.id}>{ch.name}<select aria-label={`${ch.name} expression reference`} disabled={disabled} value={selected[ch.id] || ''} onChange={e=>setSelected(s=>({...s,[ch.id]:e.target.value}))}>
            <option value="">No expression reference</option>{ch.slots.filter(s=>s.image_url).map(s=><option key={s.slot_id} value={s.active_asset_id}>{s.label} · {s.slot_id}</option>)}
        </select></label>)}
        <button disabled={disabled || !characters.length} onClick={apply}>Apply expressions and refresh final review</button>
        {error&&<p role="alert">{error}</p>}
    </fieldset>;
}
