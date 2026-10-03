import { useState } from 'react';
import { legacy } from '../../lib/legacy.js';

/*
 * AI providers and models (this project) and API keys (this Mac), from GET /providers and
 * GET /projects/:id/providers. Same routes and bodies as the legacy page.
 *
 * Rules kept, each held by a test:
 *   - one key tile per ACCOUNT: an adapter that runs on another's key (sharesKeyWith) folds into that tile;
 *   - a stored placeholder is never shown as a working key ("too short to be a key");
 *   - the model menu follows the provider picked beside it, and a pinned model the provider does not offer
 *     is shown and flagged rather than dropped;
 *   - a provider left on Automatic is sent as null (unpin) only when the control offers Automatic; a model
 *     menu is sent blank to stop pinning;
 *   - a panel built for another project is never saved onto this one;
 *   - a quality tier is saved on the click.
 */
export const CAP_WORDS = { llm: 'Writing', image: 'Image', video: 'Video', music: 'Music', voice: 'Voice', sfx: 'Effects',
    ambient: 'Ambience', lipsync: 'Lip-sync', post: 'Upscale', model3d: '3D', world: 'World' };
export const CAP_LABELS = { llm: 'Writing', image: 'Image', video: 'Video', music: 'Music', voice: 'Voice', sfx: 'Sound effects', ambient: 'Ambience',
    lipsync: 'Lip-sync', post: 'Upscale and finish', model3d: '3D model', world: 'World' };
const CAP_HELP = { llm: 'Scene cards, descriptions and analysis.', image: 'Storyboard frames and reference plates.', model3d: 'Characters and props as meshes.',
    world: 'A location as a navigable world.', video: "A clip from each shot's board frame.", post: 'Clips brought to the delivery size.',
    lipsync: 'Mouths matched to the dialogue.', voice: "Each character's lines.", music: 'Score cues.', sfx: 'One-shot effects on a shot.', ambient: "A scene's room tone, looped." };
// Grouped by what they make; a capability not named here lands under Other, never dropped.
export const CAP_GROUPS = [
    { title: 'Pictures', note: 'Frames, plates, and places a camera can stand in', caps: ['image', 'model3d', 'world'] },
    { title: 'Motion', note: 'Clips, and what finishes them', caps: ['video', 'post', 'lipsync'] },
    { title: 'Sound', note: 'Dialogue, score, effects and room tone', caps: ['voice', 'music', 'sfx', 'ambient'] },
    { title: 'Writing', note: 'Scene cards, descriptions, analysis', caps: ['llm'] },
];

const keyIsSet = (p) => (!!(p.credentials && (p.credentials.set || p.credentials.connected)) && !(p.credentials && p.credentials.suspect)) || !!p.enabled;
const keyName = (p) => p.account || String(p.label || p.id).replace(/\s*\(.*\)\s*$/, '');

/** The tiles: one per account, riders folded in, set ones first. */
export function keyTiles(catalog) {
    const all = (catalog.providers || []).filter(p => p.requiresKey || p.connection);
    const ids = new Set(all.map(p => p.id));
    return all.filter(p => !(p.sharesKeyWith && ids.has(p.sharesKeyWith)))
        .map(p => {
            const riders = all.filter(r => r.sharesKeyWith === p.id);
            if (!riders.length) return p;
            return { ...p, capabilities: [...new Set([...(p.capabilities || []), ...riders.flatMap(r => r.capabilities || [])])] };
        })
        .sort((a, b) => (keyIsSet(b) - keyIsSet(a)) || String(a.account || a.label).localeCompare(String(b.account || b.label)));
}

/** What a model menu offers for a provider: Default, its models, and a pinned model it no longer offers, flagged. */
export function modelOptions(cap, menu, pinned, providerId) {
    const models = (menu && menu.models) || [];
    const known = models.some(m => m.id === pinned);
    const deflt = cap === 'image' ? 'Default (quality tier)' : (menu && menu.default_model ? `Default (${menu.default_model})` : 'Default');
    const out = [{ value: '', label: deflt }, ...models.map(m => ({ value: m.id, label: m.label && m.label !== m.id ? m.label + ' · ' + m.id : m.id }))];
    if (pinned && !known) out.push({ value: pinned, label: `${pinned} (not offered by ${providerId || 'this provider'})` });
    return { options: out, disabled: !models.length && !pinned, title: models.length ? '' : `${providerId || 'This provider'} offers no model choice for this.` };
}

export function KeysCard({ catalog, onChanged }) {
    const [typed, setTyped] = useState({}); // id or id/field -> what was typed; never a stored key
    const [checks, setChecks] = useState({});
    if (!catalog) return <div id="providerCredentials"></div>;
    const tiles = keyTiles(catalog);
    const serves = (p) => (p.capabilities || []).map(c => CAP_WORDS[c] || c).join(' · ');
    const type = (k) => (e) => { const v = e.target.value; setTyped(t => ({ ...t, [k]: v })); };
    const run = async (fn, ok) => { try { await fn(); legacy.setStatus(ok); onChanged(); } catch (err) { legacy.setStatus('Error: ' + err.message); } };

    const saveKey = (p) => {
        const key = (typed[p.id] || '').trim();
        if (!key) { legacy.setStatus('Enter an API key first'); return; }
        return run(() => legacy.api('/providers/' + p.id + '/credentials', { method: 'PUT', body: JSON.stringify({ api_key: key }) }), p.id + ' key saved')
            .then(() => setTyped(t => ({ ...t, [p.id]: '' })));
    };
    const saveFields = (p) => {
        const fields = {};
        for (const f of (p.connection && p.connection.fields) || []) { const v = (typed[p.id + '/' + f.key] || '').trim(); if (v) fields[f.key] = v; }
        if (!Object.keys(fields).length) { legacy.setStatus('Nothing to save'); return; }
        return run(() => legacy.api('/providers/' + p.id + '/credentials', { method: 'PUT', body: JSON.stringify({ fields }) }), p.id + ' settings saved');
    };
    const check = async (p) => {
        setChecks(c => ({ ...c, [p.id]: { text: 'Checking…' } }));
        try { const r = await legacy.api('/providers/' + p.id + '/check'); setChecks(c => ({ ...c, [p.id]: { ok: true, text: '✓ ' + (r.note || 'The key works.') } })); }
        catch (err) { setChecks(c => ({ ...c, [p.id]: { ok: false, text: '✗ ' + err.message } })); }
    };
    const connect = async (p) => {
        try {
            legacy.setStatus('Connecting ' + p.id + '…');
            const res = await legacy.api('/providers/' + p.id + '/connect');
            if (!res.authorize_url) { legacy.setStatus('Connect failed: no authorize URL'); return; }
            const popup = window.open(res.authorize_url, 'provider-oauth', 'width=520,height=680');
            const onMsg = (ev) => {
                if (ev.data && ev.data.type === 'provider-oauth') {
                    window.removeEventListener('message', onMsg);
                    legacy.setStatus(ev.data.ok ? p.id + ' connected' : p.id + ' connect failed');
                    setTimeout(onChanged, 500);
                }
            };
            window.addEventListener('message', onMsg);
            const iv = setInterval(() => { if (popup && popup.closed) { clearInterval(iv); onChanged(); } }, 1500); // the window was closed
        } catch (err) { legacy.setStatus('Connect error: ' + err.message); }
    };
    const release = (p) => {
        if (!window.confirm('Delete the OAuth client Film Engine registered with ' + p.id + '?\n\nThis frees a registration slot at the provider. You will need to connect again afterwards.')) return;
        return (async () => {
            try { const res = await legacy.api('/providers/' + p.id + '/release-client', { method: 'POST', body: '{}' }); legacy.setStatus(res.message || (p.id + ' client released')); onChanged(); }
            catch (err) { legacy.setStatus('Error: ' + err.message); }
        })();
    };
    const fieldInputs = (p, c) => (p.connection.fields || []).map(f => {
        const isSet = c.fields && c.fields[f.key];
        return (
            <div key={f.key} style={{ marginBottom: 6 }}>
                <label className="text-sm">{f.label || f.key}{isSet && <> <span className="tag" style={{ background: 'var(--gl-success,#166534)' }}>set</span></>}</label>
                <input type={f.type === 'password' ? 'password' : 'text'} id={`provfield-${p.id}-${f.key}`} style={{ width: '100%' }}
                    placeholder={isSet ? '•••••• (leave blank to keep)' : (f.placeholder || '')} value={typed[p.id + '/' + f.key] || ''} onChange={type(p.id + '/' + f.key)} />
            </div>
        );
    });

    return (
        <div id="providerCredentials" className="set-keys">
            {!tiles.length && <p className="text-sm text-muted">No providers require setup. (Gridlight uses a server-side env key.)</p>}
            {tiles.map(p => {
                const c = p.credentials || { set: false, fields: {} };
                const conn = p.connection || null;
                const instr = conn && conn.instructions && <p className="text-sm text-muted" style={{ margin: '4px 0 8px' }}>{conn.instructions}</p>;
                const servesLine = serves(p) && <div className="set-key-serves">{serves(p)}</div>;
                if (conn && conn.oauth) {
                    return (
                        <div key={p.id} className="set-key" data-provider={p.id}>
                            <label>{keyName(p)} <span className={'set-pill' + (c.connected ? ' ok' : '')}>{c.connected ? 'connected' : 'not connected'}</span></label>{servesLine}{instr}
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <button className="btn btn-primary btn-sm" onClick={() => connect(p)}>{c.connected ? 'Reconnect' : 'Connect ' + String(p.label || '').split(' ')[0]}</button>
                                {c.connected && <button className="btn btn-danger btn-sm" onClick={() => run(() => legacy.api('/providers/' + p.id + '/disconnect', { method: 'POST', body: '{}' }), p.id + ' disconnected')}>Disconnect</button>}
                                <button className="btn btn-secondary btn-sm" onClick={() => release(p)} data-tooltip="Delete the OAuth client Film Engine registered with this provider, freeing a registration slot. Use if connecting fails with a registration limit." data-tooltip-pos="bottom">Release registered client</button>
                            </div>
                            {Array.isArray(conn.fields) && conn.fields.length > 0 && (
                                <details style={{ marginTop: 8 }}>
                                    <summary className="text-sm text-muted" style={{ cursor: 'pointer' }}>Advanced: use an existing OAuth client</summary>
                                    <div style={{ marginTop: 6 }}>{fieldInputs(p, c)}<button className="btn btn-secondary btn-sm" onClick={() => saveFields(p)}>Save client</button></div>
                                </details>
                            )}
                        </div>
                    );
                }
                if (conn && Array.isArray(conn.fields) && conn.fields.length) {
                    return (
                        <div key={p.id} className="set-key" data-provider={p.id}>
                            <label>{keyName(p)}{p.enabled && <> <span className="set-pill ok">set</span></>}</label>{servesLine}{instr}{fieldInputs(p, c)}
                            <div className="set-key-btns">
                                {conn.helpUrl && <a className="btn btn-secondary btn-sm" href={conn.helpUrl} target="_blank" rel="noopener noreferrer">Get key &#8599;</a>}
                                <button className="btn btn-secondary btn-sm" onClick={() => saveFields(p)}>Save</button>
                                {p.checkable && <button className="btn btn-secondary btn-sm" onClick={() => check(p)} disabled={checks[p.id] && checks[p.id].text === 'Checking…'}
                                    title="Asks the provider whether the key works. Free: nothing is generated.">Check key</button>}
                            </div>
                            <div className="text-sm" id={`provcheck-${p.id}`} style={checks[p.id] && checks[p.id].ok !== undefined ? { color: checks[p.id].ok ? 'var(--gl-success, #22c55e)' : 'var(--gl-danger, #ef4444)' } : undefined}>
                                {checks[p.id] ? checks[p.id].text : ''}</div>
                        </div>
                    );
                }
                // A stored placeholder must not wear the same green badge as a working key.
                const pill = c.suspect ? <span className="set-pill warn">too short to be a key</span>
                    : c.set ? <span className="set-pill ok">set ••••{c.last4 || ''}</span>
                    : p.enabled ? <span className="set-pill ok" title="This provider runs on a key stored for another provider of the same account.">ready · shared key</span>
                    : <span className="set-pill">not set</span>;
                return (
                    <div key={p.id} className="set-key" data-provider={p.id}>
                        <label title={(conn && conn.instructions) || ''}>{keyName(p)} {pill}</label>{servesLine}
                        <input type="password" id={`provkey-${p.id}`} placeholder={c.set ? 'Replace key' : 'Enter API key'} value={typed[p.id] || ''} onChange={type(p.id)} />
                        <div className="set-key-btns">
                            {conn && conn.helpUrl && <a className="btn btn-secondary btn-sm" href={conn.helpUrl} target="_blank" rel="noopener noreferrer" title={(conn && conn.instructions) || "Opens the provider's key page"}>Get key &#8599;</a>}
                            <button className="btn btn-secondary btn-sm" onClick={() => saveKey(p)}>Save</button>
                            {c.set && <button className="btn btn-danger btn-sm" onClick={() => run(() => legacy.api('/providers/' + p.id + '/credentials', { method: 'DELETE' }), p.id + ' key cleared')}>Clear</button>}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/*
 * Which provider and model make each kind of thing for THIS project. `proj` is GET /projects/:id/providers;
 * `choice` holds the person's picks ({ cap: provider | '' } and { cap_model: model | '' }), seeded from the pins.
 */
export function CapabilityMap({ catalog, proj, choice, setChoice, onTier }) {
    if (!proj) return <div id="providerCapabilityMap"></div>;
    const caps = proj.capabilities || [];
    const supports = (cap) => (catalog.providers || []).filter(p => (p.capabilities || []).includes(cap));
    const tiers = proj.image_tiers || [];
    const currentTier = proj.image_quality || 'standard';
    const rows = caps.map(cap => {
        const opts = supports(cap);
        if (!opts.length) return null;
        const pinned = (proj.config && proj.config[cap]) || '';
        const effectiveId = (proj.effective && proj.effective[cap]) || '';
        const eff = (catalog.providers || []).find(p => p.id === effectiveId);
        // `enabled` is the engine's own answer: MuAPI images run on the key stored for Seedance.
        const noKey = eff && eff.requiresKey && !eff.enabled;
        const r = (proj.resolution || {})[cap];
        const fellThrough = !pinned && r && r.provider && !r.explicit;
        const vendor = (eff && eff.label) || effectiveId;
        const who = pinned ? 'Pinned for this project' : (effectiveId ? `Automatic → ${vendor}` : 'Automatic');
        const pick = choice[cap] ?? pinned;
        const menus = {};
        (((proj.generation || {})[cap] || {}).providers || []).forEach(p => { menus[p.id] = { models: p.models || [], default_model: p.default_model || null }; });
        const providerForMenu = pick || effectiveId;
        const pinnedModel = choice[cap + '_model'] ?? ((proj.config && proj.config[cap + '_model']) || '');
        const mo = modelOptions(cap, menus[providerForMenu], pinnedModel, providerForMenu);
        return { cap, el: (
            <div key={cap} className="set-cap" data-cap={cap}>
                <div><div className="set-cap-name">{CAP_LABELS[cap] || cap}</div>{CAP_HELP[cap] && <div className="set-cap-note">{CAP_HELP[cap]}</div>}</div>
                <label>Provider
                    <select id={`provcap-${cap}`} value={pick} onChange={(e) => {
                        const next = e.target.value;
                        const nextMenu = menus[next || effectiveId];
                        // A provider change keeps the model only if the new provider offers it.
                        const keep = nextMenu && (nextMenu.models || []).some(m => m.id === pinnedModel) ? pinnedModel : '';
                        setChoice(c => ({ ...c, [cap]: next, [cap + '_model']: keep }));
                    }}>
                        <option value="">Automatic{cap === 'image' ? ' (quality tier)' : ''}{effectiveId ? ' → ' + effectiveId : ''}</option>
                        {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                </label>
                {cap === 'llm'
                    ? <div className="set-cap-note">The connected agent (Claude or ChatGPT Desktop) is the model.</div>
                    : <label>Model<select id={`provmodel-${cap}`} value={pinnedModel} disabled={mo.disabled} title={mo.title}
                        onChange={(e) => { const v = e.target.value; setChoice(c => ({ ...c, [cap + '_model']: v })); }}>
                        {mo.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}
                {noKey ? <div className="set-cap-state warn">{who} · no key for {vendor} — add it under API keys</div>
                    : fellThrough ? <div className="set-cap-state warn" title={r.note || ''}>Nobody picked this: it falls to {vendor}, and spend goes there. Pick a provider to pin it.</div>
                    : <div className="set-cap-state">{who}</div>}
            </div>
        ) };
    }).filter(Boolean);
    const byCap = new Map(rows.map(r => [r.cap, r.el]));
    const named = new Set(CAP_GROUPS.flatMap(g => g.caps));
    const groups = CAP_GROUPS.concat([{ title: 'Other', note: '', caps: rows.map(r => r.cap).filter(c => !named.has(c)) }])
        .map(g => ({ ...g, cards: g.caps.filter(c => byCap.has(c)).map(c => byCap.get(c)) })).filter(g => g.cards.length);
    return (
        <div id="providerCapabilityMap">
            {tiers.length > 0 && <>
                <h4 className="set-h4">Image quality <span>&mdash; chooses the image provider and model when neither is pinned below</span></h4>
                <div className="set-tiers" title="Image quality: the tier chooses the provider and model when neither is pinned below.">
                    {tiers.map(t => (
                        <button key={t.id} type="button" className={'btn fe-tier' + (t.id === currentTier ? '' : ' btn-secondary')} id={`tierbtn-${t.id}`}
                            style={t.available ? undefined : { opacity: 0.55 }} title={`${t.why || ''} ${t.reason || ''}`} onClick={() => onTier(t.id)}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{t.label}</div>
                            <div className="text-sm" style={{ opacity: 0.75, fontWeight: 400 }}>{t.usd_per_image != null ? '$' + t.usd_per_image.toFixed(3) + ' per image' : (t.reason || '')}</div>
                        </button>
                    ))}
                    <button type="button" className={'btn fe-tier' + (currentTier === 'auto' ? '' : ' btn-secondary')} onClick={() => onTier('auto')}
                        title="Auto reads each request and lifts to Precision when a frame has to reconcile several references or edit an existing shot.">
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{currentTier === 'auto' ? '✓ ' : ''}Auto</div>
                        <div className="text-sm" style={{ opacity: 0.75, fontWeight: 400 }}>picks per request</div>
                    </button>
                </div>
            </>}
            {groups.map(g => (
                <section key={g.title} className="set-group">
                    <div><h4 className="set-group-h">{g.title}</h4>{g.note && <p className="set-group-note">{g.note}</p>}</div>
                    <div className="set-caps">{g.cards}</div>
                </section>
            ))}
            {proj.config && proj.config.image_model && <div className="set-cap-note" style={{ marginTop: 6 }}>A pinned image model overrides the quality tier; set it back to Default to let quality decide again.</div>}
        </div>
    );
}

/** The body PUT /projects/:id/providers receives: null unpins only where Automatic is offered; a model blank stops pinning. */
export function providerConfigBody(proj, catalog, choice, tier) {
    const config = {};
    const offered = (cap) => (catalog.providers || []).some(p => (p.capabilities || []).includes(cap));
    for (const cap of (catalog.capabilities || [])) {
        if (!(proj.capabilities || []).includes(cap) || !offered(cap)) continue;
        const v = choice[cap] ?? ((proj.config && proj.config[cap]) || '');
        config[cap] = v ? v : null;
    }
    if (tier) config.image_quality = tier;
    for (const cap of (catalog.capabilities || [])) {
        if (cap === 'llm' || !(proj.capabilities || []).includes(cap) || !offered(cap)) continue;
        const pinnedModel = choice[cap + '_model'] ?? ((proj.config && proj.config[cap + '_model']) || '');
        // A disabled menu (no models, nothing pinned) is not sent, as the legacy page did not send it.
        const pick = choice[cap] ?? ((proj.config && proj.config[cap]) || '');
        const prov = (((proj.generation || {})[cap] || {}).providers || []).find(p => p.id === (pick || (proj.effective || {})[cap]));
        if (!(prov && (prov.models || []).length) && !pinnedModel) continue;
        config[cap + '_model'] = String(pinnedModel).trim();
    }
    return config;
}
