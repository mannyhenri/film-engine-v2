import { useState } from 'react';

export default function HiggsfieldCatalog({ models = [], modes = [] }) {
    const [query,setQuery] = useState('');
    const [type,setType] = useState('all');
    const visible=models.filter(m=>(type==='all'||m.output===type)&&`${m.label} ${m.id} ${m.provider_name}`.toLowerCase().includes(query.toLowerCase()));
    return <details className="ps-catalog">
        <summary>Full Higgsfield catalog ({models.length} models)</summary>
        <label>Find a Higgsfield model <input value={query} onChange={e=>setQuery(e.target.value)} type="search" /></label>
        <label>Output <select value={type} onChange={e=>setType(e.target.value)}>{['all','video','image','audio','3d'].map(t=><option key={t} value={t}>{t}</option>)}</select></label>
        <p className="ps-muted">Website credits and API dollars use separate balances. Quotes below are checked samples with their settings; confirm the final total on Higgsfield.</p>
        {visible.map(m=><div key={m.id} data-website-model={m.id} className="ps-catalog-model">
            <a href={m.url} target="_blank" rel="noreferrer">{m.label}</a> · {m.provider_name} · {m.output}
            <small>{m.id}</small><p>{m.description}</p>
            <small>{m.duration_range ? `${m.duration_range.min}–${m.duration_range.max}s · ` : m.durations?.length ? `${m.durations.join('/')}s · ` : ''}{m.aspects.join(', ')}</small>
            <details><summary>Settings and checked cost</summary>
                {m.parameters.map(p=><p key={p.name}><b>{p.name}</b>: {p.options?.join(', ') || p.type}{p.required==='required'?' (required)':''}{p.default!==undefined?` · default ${p.default}`:''}</p>)}
                <p>{m.cost?.available?`${m.cost.credits} website credits · sample quote`:'Quote required on Higgsfield'}</p>
                {m.cost?.parameters && <small>{Object.entries(m.cost.parameters).filter(([k])=>!['prompt','model','use_unlim','count'].includes(k)).map(([k,v])=>`${k}: ${v}`).join(' · ')}</small>}
                {!m.cost?.available && <p className="ps-muted">{m.cost?.reason}</p>}
            </details>
        </div>)}
        <details><summary>Public API modes ({modes.length})</summary>
            {modes.map(m=><div key={m.id} data-api-mode={m.id} className="ps-catalog-model"><a href={m.url} target="_blank" rel="noreferrer">{m.label}</a>
                <small>{m.id}</small>{m.reason && <p>{m.reason}</p>}
                {m.pricing.options.map((o,i)=><small key={i}>{Object.entries(o.configuration).filter(([,v])=>v!=null).map(([k,v])=>`${k}: ${v}`).join(' · ')} — ${o.original_amount??o.amount}/{o.unit} list{o.original_amount?` · $${o.amount} promotional`:''}</small>)}
            </div>)}
        </details>
    </details>;
}
