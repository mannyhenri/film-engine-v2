import { useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';

/*
 * The Consistency Studio (Explore -> Lock -> Verify), as React. Replaces the legacy functions listed in
 * react.json: the same routes, bodies, markup (ids, classes) and status lines.
 */
// Fallback vocabulary; the API's ref_roles (backend consistency-context.js) overrides it. Order = truncation priority.
const FALLBACK_ROLES = ['canonical', 'face', 'front', 'side', 'back', 'full_body', 'expression', 'wide', 'detail', 'color'];
const IMG_TYPES = ['character_sheet', 'reference_sheet', 'reference_image', 'storyboard', 'keyframe'];
const VERIFY_COLOR = { ready: 'var(--gl-success,#166534)', warning: 'var(--gl-warning,#92400e)', blocked: 'var(--gl-danger,#7f1d1d)' };
const GREEN = { background: 'var(--gl-success,#166534)' };
const TABS = [['characters', 'Characters'], ['locations', 'Locations'], ['props', 'Props'], ['audit', 'Shot Audit'], ['verify', 'Verify']];
const ID_FIELD = { character: 'character_id', location: 'location_id', prop: 'prop_id' };
const PAGE_OF = { character: 'Characters', prop: 'Props', location: 'Locations' };
const parseObj = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const parseList = (val) => {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; } }
    return [];
};
const ofSubject = (a, field, id) => a[field] === id || parseObj(a.metadata)[field] === id;
const SECTION = { marginTop: 8, borderTop: '1px solid var(--gl-border-subtle)', paddingTop: 8 };

function VoiceRow({ char, voiceProf, act }) {
    const locked = voiceProf && voiceProf.status === 'locked';
    const hasVoice = !!char.voice_profile_id;
    return (
        <div style={{ marginTop: 6, borderTop: '1px solid var(--gl-border-subtle)', paddingTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="text-sm">Voice {locked ? <span className="tag" style={GREEN}>🔒 voice</span> : hasVoice ? <span className="tag">voice not locked</span> : <span className="tag">no voice profile</span>}</span>
            {locked ? <button className="btn btn-secondary btn-sm" onClick={() => act.unlockConsistency(voiceProf.id)}>Unlock</button>
                : hasVoice ? <button className="btn btn-secondary btn-sm" onClick={() => act.lockVoice(char.id)}>Lock voice</button>
                    : <button className="btn btn-secondary btn-sm" disabled title="Set a voice profile on the character first">Lock voice</button>}
        </div>
    );
}

/*
 * Multi-reference roles: a profile holds several role-tagged references (front / side / back / expression /
 * face / full_body) beyond the canonical image, passed to the generator as image[] / input_refs.
 */
function RefManager({ prof, type, subject, assets, roles, act }) {
    const [draft, setDraft] = useState({ asset: '', role: 'front', weight: '0.7' });
    const [weight, setWeight] = useState(null); // null: show the profile's own
    if (!prof) {
        return (
            <div style={SECTION}>
                <button className="btn btn-secondary btn-sm" onClick={() => act.startProfileForRefs(type, subject.id)}>+ Add reference roles</button>
                <div className="text-sm text-muted" style={{ marginTop: 4 }}>Attach front / side / back / expression / face references for stronger consistency.</div>
            </div>
        );
    }
    const refs = Array.isArray(prof.refs) ? prof.refs : [];
    const required = parseList(prof.required_roles);
    const used = new Set(refs.map(r => r.asset_id));
    const options = assets.filter(a => IMG_TYPES.includes(a.asset_type) && ofSubject(a, ID_FIELD[type], subject.id) && !used.has(a.id));
    const wt = prof.reference_weight != null ? prof.reference_weight : 0.7;
    const assetId = draft.asset || (options[0] && options[0].id) || '';
    return (
        <details className="ref-manager" style={SECTION}>
            <summary style={{ cursor: 'pointer', fontSize: 12 }}>References ({refs.length}) &middot; weight {wt} &middot; required roles</summary>
            <div style={{ marginTop: 6 }}>
                <div className="text-sm text-muted" style={{ marginBottom: 4 }}>Required roles (click to toggle):</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {roles.map(role => {
                        const on = required.includes(role);
                        return (
                            <button key={role} className="tag" title="Toggle whether this role is required" onClick={() => act.toggleRequiredRole(prof.id, role)}
                                style={{ cursor: 'pointer', border: '1px solid var(--gl-border-subtle)', ...(on ? { background: 'var(--gl-accent,#2563eb)', color: '#fff' } : { opacity: 0.6 }) }}>{role}</button>
                        );
                    })}
                </div>
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="text-sm text-muted">Default reference weight:</span>
                    <input id={'profWeight_' + prof.id} className="input input-sm" style={{ width: 72 }} type="number" step="0.05" min="0" max="1"
                        value={weight ?? String(wt)} onChange={e => setWeight(e.target.value)} title="Primary IP-Adapter / reference weight for this subject" />
                    <button className="btn btn-secondary btn-sm" onClick={() => act.setProfileWeight(prof.id, weight ?? String(wt))}>Save</button>
                </div>
                <div style={{ marginTop: 8 }}>
                    {refs.length ? refs.map(r => (
                        <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '3px 0' }}>
                            <span className="text-sm">
                                <span className="tag" style={{ background: 'var(--gl-accent-dim,#1e3a5f)' }}>{r.ref_role}</span>
                                {r.is_required ? <> <span title="required" style={{ color: 'var(--gl-warning,#f59e0b)' }}>★</span></> : null}
                                {' '}{!r.asset_id ? <span className="text-muted">(asset removed)</span> : (r.asset_file_name || r.asset_id)}
                                {' '}<span className="text-muted">w{r.weight != null ? r.weight : '0.7'}</span>
                            </span>
                            <button className="btn btn-secondary btn-sm" onClick={() => act.removeProfileRef(r.id)}>Remove</button>
                        </div>
                    )) : <div className="text-sm text-muted">Only the canonical reference so far.</div>}
                </div>
                {options.length ? (
                    <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <select id={'refAsset_' + prof.id} className="input input-sm" style={{ flex: 1, minWidth: 120 }} value={assetId} onChange={e => setDraft(d => ({ ...d, asset: e.target.value }))}>
                            {options.map(a => <option key={a.id} value={a.id}>{a.file_name || a.asset_type || a.id}</option>)}
                        </select>
                        <select id={'refRole_' + prof.id} className="input input-sm" style={{ width: 110 }} value={draft.role} onChange={e => setDraft(d => ({ ...d, role: e.target.value }))}>
                            {roles.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <input id={'refWeight_' + prof.id} className="input input-sm" style={{ width: 64 }} type="number" step="0.05" min="0" max="1" value={draft.weight}
                            onChange={e => setDraft(d => ({ ...d, weight: e.target.value }))} title="reference weight" />
                        <button className="btn btn-primary btn-sm" onClick={() => act.addProfileRef(prof.id, { asset: assetId, role: draft.role, weight: draft.weight })}>Add</button>
                    </div>
                ) : <div className="text-sm text-muted" style={{ marginTop: 6 }}>Generate more reference images for this {type} to attach additional roles.</div>}
            </div>
        </details>
    );
}

function SubjectGrid({ type, subjects, data, act }) {
    if (!subjects.length) {
        return (
            <div className="empty-state" style={{ gridColumn: '1/-1' }}><div className="icon">🔒</div><h3>No {type}s</h3>
                <p>Create {type}s first, then lock a canonical reference.</p></div>
        );
    }
    return subjects.map(s => {
        const prof = data.bySubject[type + ':' + s.id];
        const refAsset = data.assets.find(a => IMG_TYPES.includes(a.asset_type) && ofSubject(a, ID_FIELD[type], s.id));
        const locked = prof && prof.status === 'locked';
        return (
            <div className="entity-card" key={s.id} data-subject-id={s.id}>
                <div className="flex-between"><strong style={{ fontSize: 13 }}>{s.name}</strong>
                    {locked ? <span className="tag" style={GREEN}>🔒 locked</span> : prof ? <span className="tag">draft</span> : <span className="tag">not locked</span>}</div>
                {s.reference_image_url
                    ? <img src={legacy.API_BASE + s.reference_image_url} style={{ width: '100%', borderRadius: 6, marginTop: 8, maxHeight: 200, objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                    : <p className="text-sm text-muted" style={{ marginTop: 8 }}>No reference image yet — generate a reference image on the {PAGE_OF[type]} page to explore, then lock one here.</p>}
                <div style={{ marginTop: 8 }}>
                    {locked ? <button className="btn btn-secondary btn-sm" onClick={() => act.unlockConsistency(prof.id)}>Unlock</button>
                        : refAsset ? <button className="btn btn-primary btn-sm" onClick={() => act.lockConsistency(type, s.id, refAsset.id)}>Lock for production</button>
                            : <button className="btn btn-secondary btn-sm" disabled title="Generate a reference image/sheet first">Lock (needs reference)</button>}
                </div>
                {/* Keyed on the profile's revision: after a write the form shows the server's values, as the legacy redraw did. */}
                <RefManager key={prof ? [prof.id, prof.updated_at, prof.reference_weight, (prof.refs || []).length].join(':') : 'none'} prof={prof} type={type} subject={s} assets={data.assets} roles={data.roles} act={act} />
                {type === 'character' && <VoiceRow char={s} voiceProf={data.bySubject['voice:' + s.id]} act={act} />}
            </div>
        );
    });
}

function Audit({ audit }) {
    const shots = (audit && audit.shots) || [];
    if (!shots.length) return <p className="text-sm text-muted">No shots to audit yet.</p>;
    return (
        <table className="render-table"><tbody>
            <tr><th>Shot</th><th>Ready</th><th>Missing / Warnings</th></tr>
            {shots.map((s, i) => (
                <tr key={i}>
                    <td>{s.shot_code || s.shot_id}</td>
                    <td>{s.ready ? <span className="tag" style={GREEN}>ready</span> : <span className="tag" style={{ background: 'var(--gl-danger,#7f1d1d)' }}>not ready</span>}</td>
                    <td className="text-sm">{[...(s.missing || []), ...(s.warnings || [])].join(', ') || '—'}</td>
                </tr>
            ))}
        </tbody></table>
    );
}

function VerifySubject({ s }) {
    const score = typeof s.score === 'number' ? s.score : null;
    const st = s.status || (score == null ? '' : score >= 0.85 ? 'ready' : score >= 0.70 ? 'warning' : 'blocked');
    const pct = score == null ? 0 : Math.max(0, Math.min(100, Math.round(score * 100)));
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
            <span className="text-sm" style={{ minWidth: 120 }}>{s.subject_name || s.subject || s.profile_id || 'subject'}{s.role && <> <span className="text-muted">({s.role})</span></>}</span>
            {score == null ? <span className="text-muted">no score</span> : <>
                <span style={{ display: 'inline-block', width: 80, height: 8, borderRadius: 4, background: 'var(--gl-border-subtle,#333)', verticalAlign: 'middle', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: pct + '%', background: VERIFY_COLOR[st] || '#888' }} />
                </span> <span className="text-sm">{pct}%</span>
            </>}
        </div>
    );
}

/* Verify: the persisted checks the generator side writes when it scores output against locked references. */
function Verify({ verify }) {
    if (!verify) return null;
    if (verify.noProject) return <p className="text-sm text-muted">No project selected.</p>;
    if (verify.loading) return <p className="text-sm text-muted">Loading verification history…</p>;
    if (verify.error) return <p className="text-sm text-muted">Could not load verification checks: {verify.error}</p>;
    const checks = verify.data.checks || [];
    const counts = verify.data.counts || {};
    if (!checks.length) {
        return (
            <div className="empty-state"><div className="icon">🔍</div><h3>No verification runs yet</h3>
                <p>Verify measures whether generated output came back on-model. Once a shot is generated with locked references, its output is scored against the canonical reference and recorded here — flagging anything that drifted.</p></div>
        );
    }
    const shotName = (id) => {
        const s = (legacy.state.shots || []).find(x => x.id === id);
        return s ? (s.shot_code || s.name || id) : (id ? id.slice(0, 8) : '—');
    };
    return (
        <>
            <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
                <strong>Verification</strong>
                <span className="tag" style={{ background: VERIFY_COLOR.ready }}>{counts.ready || 0} ready</span>
                <span className="tag" style={{ background: VERIFY_COLOR.warning }}>{counts.warning || 0} warning</span>
                <span className="tag" style={{ background: VERIFY_COLOR.blocked }}>{counts.blocked || 0} blocked</span>
                <span className="text-sm text-muted">{checks.length} recent check(s)</span>
            </div>
            <table className="render-table"><tbody>
                <tr><th>Shot</th><th>Status</th><th>Subjects / notes</th><th>When</th></tr>
                {checks.map((c, i) => {
                    const details = c.details || {};
                    const subjects = Array.isArray(details.subjects) ? details.subjects : [];
                    const notes = [...(c.missing || []), ...(c.warnings || [])];
                    return (
                        <tr key={i}>
                            <td>{shotName(c.shot_id)}</td>
                            <td><span className="tag" style={{ background: VERIFY_COLOR[c.status] || '#555' }}>{c.status}</span>{details.scorer && <span className="text-muted"> · {details.scorer}</span>}</td>
                            <td>{subjects.length ? subjects.map((s, j) => <VerifySubject key={j} s={s} />) : <span className="text-sm text-muted">No per-subject scores.</span>}
                                {notes.length > 0 && <div className="text-sm text-muted" style={{ marginTop: 4 }}>{notes.join(' · ')}</div>}</td>
                            <td className="text-sm text-muted">{(c.created_at || '').replace('T', ' ').slice(0, 16)}</td>
                        </tr>
                    );
                })}
            </tbody></table>
        </>
    );
}

export default function ConsistencyPage() {
    const [tab, setTab] = useState('characters');
    const [data, setData] = useState(null); // { subjects, profiles, bySubject, assets, roles, audit }
    const [verify, setVerify] = useState(null);

    async function loadConsistency() {
        if (!legacy.state.currentProject) return;
        const pid = legacy.state.currentProject.id;
        legacy.setStatus('Loading consistency...');
        try {
            const [charsD, locsD, propsD, profD, assetsD, auditD] = await Promise.all([
                legacy.api('/projects/' + pid + '/characters').catch(() => ({ characters: [] })),
                legacy.api('/projects/' + pid + '/locations').catch(() => ({ locations: [] })),
                legacy.api('/projects/' + pid + '/props').catch(() => ({ props: [] })),
                legacy.api('/projects/' + pid + '/consistency/profiles').catch(() => ({ profiles: [] })),
                legacy.api('/projects/' + pid + '/assets').catch(() => ({ assets: [] })),
                legacy.api('/projects/' + pid + '/consistency/audit').catch(() => ({ ready: true, shots: [] })),
            ]);
            const profiles = profD.profiles || [];
            const bySubject = {}; profiles.forEach(p => { bySubject[p.profile_type + ':' + p.subject_id] = p; });
            const byId = {}; profiles.forEach(p => { byId[p.id] = p; });
            setData({
                subjects: { character: charsD.characters || [], location: locsD.locations || [], prop: propsD.props || [] },
                profiles: byId, bySubject, assets: assetsD.assets || [], audit: auditD,
                roles: Array.isArray(profD.ref_roles) && profD.ref_roles.length ? profD.ref_roles : FALLBACK_ROLES,
            });
            legacy.setStatus('Consistency: ' + profiles.filter(p => p.status === 'locked').length + ' locked');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    usePageLoader('loadConsistency', loadConsistency);

    async function loadConsistencyVerify() {
        if (!legacy.state.currentProject) { setVerify({ noProject: true }); return; }
        setVerify({ loading: true });
        try { setVerify({ data: await legacy.api('/projects/' + legacy.state.currentProject.id + '/consistency/checks?limit=100') }); }
        catch (err) { setVerify({ error: err.message }); }
    }

    function switchConsistencyTab(t) { setTab(t); if (t === 'verify') loadConsistencyVerify(); }

    /** Run a write, say the line, reload; a failure is said with the legacy prefix. */
    async function write(fn, ok, prefix) {
        try { await fn(); if (ok) legacy.setStatus(ok); loadConsistency(); }
        catch (err) { legacy.setStatus(prefix + err.message); }
    }
    const subjectOf = (type, id) => ((data?.subjects[type]) || []).find(x => x.id === id) || {};
    const pid = () => legacy.state.currentProject.id;
    const act = {
        // A draft profile, so references can be attached before locking. The name is looked up, never passed in.
        startProfileForRefs: (type, subjectId) => write(() => legacy.api('/projects/' + pid() + '/consistency/profiles', {
            method: 'POST', body: JSON.stringify({ profile_type: type, subject_id: subjectId, subject_name: subjectOf(type, subjectId).name || subjectId }),
        }), 'Draft profile ready — attach references', 'Error: '),
        addProfileRef: (profileId, { asset, role, weight }) => {
            if (!asset) { legacy.setStatus('Pick a reference asset first'); return; }
            const w = parseFloat(weight);
            return write(() => legacy.api('/consistency/profiles/' + profileId + '/refs', {
                method: 'POST', body: JSON.stringify({ asset_id: asset, ref_role: role || 'front', weight: Number.isFinite(w) ? w : 0.7 }),
            }), 'Reference added', 'Add reference error: ');
        },
        removeProfileRef: (refId) => write(() => legacy.api('/consistency/refs/' + refId, { method: 'DELETE' }), 'Reference removed', 'Remove error: '),
        setProfileWeight: (profileId, value) => {
            const w = parseFloat(value);
            if (!Number.isFinite(w) || w < 0 || w > 1) { legacy.setStatus('Weight must be 0–1'); return; }
            return write(() => legacy.api('/consistency/profiles/' + profileId, { method: 'PUT', body: JSON.stringify({ reference_weight: w }) }), 'Reference weight saved', 'Update error: ');
        },
        toggleRequiredRole: (profileId, role) => {
            const prof = data?.profiles[profileId];
            if (!prof) return;
            const roles = parseList(prof.required_roles);
            const next = roles.includes(role) ? roles.filter(r => r !== role) : roles.concat(role);
            return write(() => legacy.api('/consistency/profiles/' + profileId, { method: 'PUT', body: JSON.stringify({ required_roles: next }) }), null, 'Update error: ');
        },
        // Lock with BOTH the image anchor and a text contract prefilled from the subject's own descriptive fields.
        lockConsistency: (type, subjectId, assetId) => {
            const subj = subjectOf(type, subjectId);
            const name = subj.name || subjectId;
            const promptContract = type === 'character' ? (subj.appearance_prompt || subj.description || '')
                : type === 'prop' ? (subj.visual_prompt || subj.description || '')
                    : (subj.reference_prompt || subj.description || '');
            return write(async () => {
                const prof = await legacy.api('/projects/' + pid() + '/consistency/profiles', {
                    method: 'POST', body: JSON.stringify({ profile_type: type, subject_id: subjectId, subject_name: name, canonical_asset_id: assetId, prompt_contract: promptContract }),
                });
                // Ensure the contract is applied even if the profile already existed.
                if (promptContract && !prof.prompt_contract) {
                    await legacy.api('/consistency/profiles/' + prof.id, { method: 'PUT', body: JSON.stringify({ prompt_contract: promptContract, canonical_asset_id: assetId }) });
                }
                await legacy.api('/consistency/profiles/' + prof.id + '/lock', { method: 'POST', body: '{}' });
            }, name + ' locked for production', 'Lock error: ');
        },
        // A character's voice, snapshotted into a 'voice' profile.
        lockVoice: (subjectId) => {
            const subj = subjectOf('character', subjectId);
            if (!subj.voice_profile_id) { legacy.setStatus('No voice profile — set one on the character first'); return; }
            return write(async () => {
                const prof = await legacy.api('/projects/' + pid() + '/consistency/profiles', {
                    method: 'POST', body: JSON.stringify({ profile_type: 'voice', subject_id: subjectId, subject_name: subj.name || subjectId, settings: { voice_profile_id: subj.voice_profile_id } }),
                });
                await legacy.api('/consistency/profiles/' + prof.id + '/lock', { method: 'POST', body: '{}' });
            }, (subj.name || 'Character') + ' voice locked', 'Voice lock error: ');
        },
        unlockConsistency: (profileId) => write(() => legacy.api('/consistency/profiles/' + profileId + '/unlock', { method: 'POST', body: '{}' }), 'Unlocked', 'Error: '),
    };

    const audit = data?.audit;
    const locked = data ? Object.values(data.profiles).filter(p => p.status === 'locked').length : 0;
    const shotsReady = audit ? (audit.shots || []).filter(s => s.ready).length : 0;
    const grid = (t) => ({ display: tab === t ? 'grid' : 'none', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' });

    return (
        <div className="page" id="page-consistency">
            <div className="flex-between mb-16">
                <h2>Consistency Studio</h2>
                <button className="btn btn-secondary" onClick={() => loadConsistency()}>Refresh</button>
            </div>
            <p className="text-sm text-muted mb-8">Explore freely when creating. <strong>Lock</strong> one canonical reference per character/location so storyboards &amp; videos stay consistent. Locked references are injected into production generation.</p>
            <div id="consistencyReadiness" className="mb-16">{audit && (
                <div className="card" style={{ borderLeft: `4px solid ${audit.ready ? 'var(--gl-success,#22c55e)' : 'var(--gl-warning,#f59e0b)'}` }}>
                    <strong>{audit.ready ? '✓ Consistency ready' : '⚠ Consistency incomplete'}</strong>
                    <span className="text-sm text-muted"> — {locked} profile(s) locked{audit.shots && audit.shots.length ? ', ' + shotsReady + '/' + audit.shots.length + ' shots ready' : ''}.</span>
                    {audit.warnings && audit.warnings.length > 0 && <div className="text-sm text-muted" style={{ marginTop: 6 }}>{audit.warnings.join(' · ')}</div>}
                </div>
            )}</div>
            <div className="tab-bar mb-16" id="consistencyTabs">
                {TABS.map(([t, label]) => <button key={t} className={'tab-btn' + (tab === t ? ' active' : '')} data-ctab={t} onClick={() => switchConsistencyTab(t)}>{label}</button>)}
            </div>
            <div id="consistencyCharacters" className="consistency-tab entity-grid" style={grid('characters')}>{data && <SubjectGrid type="character" subjects={data.subjects.character} data={data} act={act} />}</div>
            <div id="consistencyLocations" className="consistency-tab entity-grid" style={grid('locations')}>{data && <SubjectGrid type="location" subjects={data.subjects.location} data={data} act={act} />}</div>
            <div id="consistencyProps" className="consistency-tab entity-grid" style={grid('props')}>{data && <SubjectGrid type="prop" subjects={data.subjects.prop} data={data} act={act} />}</div>
            <div id="consistencyAudit" className="consistency-tab" style={{ display: tab === 'audit' ? 'block' : 'none' }}>{data && <Audit audit={audit} />}</div>
            <div id="consistencyVerify" className="consistency-tab" style={{ display: tab === 'verify' ? 'block' : 'none' }}><Verify verify={verify} /></div>
        </div>
    );
}
