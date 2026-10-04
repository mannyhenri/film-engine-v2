import { useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import * as E from './engine.js'; // what a video shot card does that only this page uses, moved from core

/*
 * Video Shots, as React. Replaces the legacy functions listed in react.json: the
 * same routes, bodies, markup and status lines. The card actions (generate,
 * dialogue, coverage, lip-sync, upscale, background, stitch) are shared with the
 * board and stay in core; the sequence LIST is still legacy (core's
 * loadSequences fills #sequenceList, which React never renders into).
 * state.videoShots / state.videoAssetsByShot are kept filled: setClipCoverage reads them.
 * The upload controls are core's mediaUploadControl, rendered as built (see Legacy below).
 */
const TAG = { ready: { background: 'var(--gl-success,#166534)' }, failed: { background: 'var(--gl-danger,#7f1d1d)' } };
const hide = (e) => { e.currentTarget.style.display = 'none'; };
/*
 * core's own upload control (mediaUploadControl): the file picker, the device or iPhone camera
 * beside it, the size check, the route per capability, and `after` (the loader core calls by name
 * once the file is stored). Rendered as core builds it, as Marketing renders uploadControl.
 */
const Legacy = ({ html }) => <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />;

function ShotCard({ s, job, media, pid }) {
    const playable = media.video_final || media.video_synced || media.video_raw;
    const done = !!media.video_raw || (job && job.status === 'complete');
    const failed = job && job.status === 'failed';
    const longShot = s.duration_ms && s.duration_ms > 5000;
    const videoUrl = playable && playable.url
        ? legacy.API_BASE + playable.url
        : legacy.API_BASE + '/film/video/' + pid + '/' + encodeURIComponent(s.shot_code) + '.mp4';
    const supplied = [media.audio_dialogue && 'dialogue', media.audio_sfx && 'SFX', media.video_synced && 'synced video', media.video_final && 'final video'].filter(Boolean);
    const busy = (fn) => (e) => fn(s.id, e.currentTarget);
    return (
        <div className="entity-card" data-shot-id={s.id}>
            <div style={{ position: 'relative', background: 'var(--gl-bg-surface)', borderRadius: 6, overflow: 'hidden', marginBottom: 8, minHeight: 120 }}>
                {done
                    ? <video src={videoUrl} controls preload="metadata" style={{ width: '100%', display: 'block' }} onError={hide} />
                    : <img src={legacy.API_BASE + '/film/storyboards/' + pid + '/' + s.shot_code + '.png?w=480'} style={{ width: '100%', display: 'block' }}
                        onError={e => { hide(e); e.currentTarget.parentNode.style.minHeight = '120px'; }} />}
            </div>
            <div className="flex-between">
                <strong style={{ fontSize: 13 }}>Sc{s.scene_number} / {s.shot_code}</strong>
                {done ? <span className="tag" style={TAG.ready}>video ready</span>
                    : failed ? <span className="tag" style={TAG.failed}>failed</span>
                        : job && job.status === 'generating' ? <span className="tag">generating</span>
                            : <span className="tag">no video</span>}
            </div>
            <div className="shot-meta text-sm text-muted">{s.location || ''}{s.duration_ms ? ' · ' + (s.duration_ms / 1000).toFixed(1) + 's' : ''}</div>
            {supplied.length > 0 && <div className="text-sm text-muted" style={{ marginTop: 5 }}>Available: {supplied.join(', ')}</div>}
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" onClick={busy(E.generateVideoFor)}>{done ? 'Regenerate' : 'Generate Video'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => legacy.generateVoiceForShot(s.id, s.shot_code)} title="The dialogue take that ships — registered against this shot, unlike an audition">Dialogue</button>
                <Legacy html={legacy.mediaUploadControl('video', 'video', 'shot', s.id, { after: 'loadVideoShots', label: 'Upload clip' })} />
                {(media.video_raw || media.video_final || media.video_synced) && (
                    <button className="btn btn-secondary btn-sm" onClick={busy(E.setClipCoverage)}
                        title="If this one clip contains several shots, say which — those shots stop playing their own frames">Covers&hellip;</button>
                )}
                <Legacy html={legacy.mediaUploadControl('voice', 'audio', 'shot', s.id, { after: 'loadVideoShots', label: 'Upload dialogue' })} />
                <Legacy html={legacy.mediaUploadControl('sfx', 'audio', 'shot', s.id, { after: 'loadVideoShots', label: 'Upload SFX' })} />
                <Legacy html={legacy.mediaUploadControl('lipsync', 'video', 'shot', s.id, { after: 'loadVideoShots', label: 'Upload synced' })} />
                <Legacy html={legacy.mediaUploadControl('post', 'video', 'shot', s.id, { after: 'loadVideoShots', label: 'Upload final' })} />
                {done && <>
                    <a className="btn btn-secondary btn-sm" href={videoUrl} target="_blank" rel="noopener">Download</a>
                    <button className="btn btn-secondary btn-sm" onClick={busy(E.lipsyncShot)} title="Sync to dialogue audio (needs generated voice)">Lip-sync</button>
                    <button className="btn btn-secondary btn-sm" onClick={busy(E.postShot)} title="Upscale / enhance">Upscale</button>
                    <button className="btn btn-secondary btn-sm" onClick={busy(E.replaceBackground)} title="Keep the performance, put it somewhere else">Background&hellip;</button>
                    {longShot && <button className="btn btn-secondary btn-sm" onClick={busy(E.stitchShot)} title="Split >5s shot into sub-clips and stitch">Stitch</button>}
                </>}
            </div>
        </div>
    );
}

export default function VideoShotsPage() {
    const [view, setView] = useState(null); // null: not loaded; { shots, jobByShot, assetsByShot, provider, pid }
    const [picked, setPicked] = useState([]); // press order IS play order
    const [seqName, setSeqName] = useState('');
    const [seqDesc, setSeqDesc] = useState('');
    const [progress, setProgress] = useState(null); // { pct, label } while a batch runs

    async function loadVideoShots() {
        if (!legacy.state.currentProject) return;
        legacy.setStatus('Loading video shots...');
        const pid = legacy.state.currentProject.id;
        try {
            const [shotData, videoData, provData] = await Promise.all([
                legacy.api('/projects/' + pid + '/shotlist').catch(() => ({ shots: [] })),
                legacy.api('/projects/' + pid + '/video').catch(() => ({ jobs: [] })),
                legacy.api('/projects/' + pid + '/providers').catch(() => ({ effective: {} })),
            ]);
            const shots = shotData.shots || [];
            // shot_id -> latest job status.
            const jobByShot = {};
            (videoData.jobs || []).forEach(j => { if (!jobByShot[j.shot_id]) jobByShot[j.shot_id] = j; });
            // Imported footage has no fake job: the asset slot is the source of truth for media present.
            const assetsByShot = {};
            (videoData.assets || []).forEach(a => {
                if (!a.shot_id) return;
                (assetsByShot[a.shot_id] ||= {})[a.asset_type] ||= a;
            });
            // The sequence picker reads the SAME shots and asset map (and core's setClipCoverage does too).
            legacy.state.videoShots = shots;
            legacy.state.videoAssetsByShot = assetsByShot;
            setView({ shots, jobByShot, assetsByShot, pid, provider: (provData.effective && provData.effective.video) || 'gridlight' });
            legacy.loadSequences();
            if (!shots.length) { legacy.setStatus('No shots'); return; }
            const readyCount = shots.filter(s => assetsByShot[s.id] && assetsByShot[s.id].video_raw).length;
            legacy.setStatus(shots.length + ' shot(s), ' + readyCount + ' with video');
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    usePageLoader('loadVideoShots', loadVideoShots);

    function toggleSequenceShot(id) {
        setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
    }

    async function createSequence() {
        if (!legacy.state.currentProject) return;
        if (!picked.length) return legacy.setStatus('Pick the shots the move travels through first.');
        try {
            await legacy.api(`/projects/${legacy.state.currentProject.id}/sequences`, {
                method: 'POST', body: JSON.stringify({ name: seqName, description: seqDesc, shot_ids: picked }),
            });
            setPicked([]); setSeqName(''); setSeqDesc('');
            legacy.setStatus('Sequence created. Preview it before generating — the preview is free.');
            legacy.loadSequences();
        } catch (err) { legacy.setStatus('Could not create the sequence: ' + err.message); }
    }

    async function generateAllVoices() {
        if (!legacy.state.currentProject) return;
        if (!window.confirm('Generate dialogue for EVERY shot that has any?\n\n'
            + 'This SPENDS on each line, and registers each take against its shot. '
            + 'Cast your characters first, or uncast ones will speak in the provider default voice.')) return;
        legacy.setStatus('Generating all dialogue…');
        try {
            const res = await legacy.api(`/projects/${legacy.state.currentProject.id}/voice/batch`, { method: 'POST', body: '{}' });
            legacy.setStatus(`Dialogue: ${res.generated || res.total || 0} line(s).`);
        } catch (err) { legacy.setStatus('Batch failed: ' + err.message); }
    }

    /*
     * A paid action states its cost before it spends. A batch sends a DIFFERENT prompt per shot,
     * so one is shown as a REPRESENTATIVE and labelled as one.
     */
    async function generateAllVideos() {
        if (!legacy.state.currentProject) return;
        let sample = null;
        const shots = legacy.state.shots || [];
        const first = shots.find(sh => sh.has_keyframe || sh.image_url) || shots[0];
        if (first) { try { sample = await legacy.api(`/shots/${first.id}/video/preview`); } catch { sample = null; } }
        if (!window.confirm('Generate video for EVERY shot that has a keyframe?\n\n'
            + 'This is one paid generation per shot and is the largest single spend in the app. '
            + 'Generate one shot first to check the look before buying the whole board.'
            + (sample && sample.prompt
                ? `\n\nEach shot sends its own prompt. ${first.shot_code || 'The first'} would send:\n\n` + String(sample.prompt).slice(0, 400)
                : ''))) return;
        generateAllVideosRun();
    }

    function generateAllVideosRun() {
        if (!legacy.state.currentProject) return;
        let total = 1, done = 0;
        setProgress({ pct: 0, label: 'Starting video generation...' });
        legacy.streamSSEPost('/projects/' + legacy.state.currentProject.id + '/video/batch/stream', {},
            (ev) => {
                if (ev.type === 'status' && ev.total_shots) total = ev.total_shots || 1;
                else if (ev.type === 'shot_start') setProgress(p => ({ ...p, label: 'Generating ' + (ev.shot_code || ev.shot_id || '...') }));
                else if (ev.type === 'shot_complete' || ev.type === 'shot_failed') {
                    done++;
                    setProgress({ pct: Math.round((done / total) * 100), label: done + '/' + total + ' processed' });
                }
            },
            () => {
                setProgress(p => ({ ...p, label: 'Done' }));
                legacy.setStatus('Video batch complete');
                setTimeout(() => setProgress(null), 1500);
                loadVideoShots();
            },
            (err) => { legacy.setStatus('Error: ' + (err ? err.message : 'stream failed')); setProgress(null); },
        );
    }

    const shots = view?.shots || [];
    const framed = (s) => !!(s.keyframe_url || s.has_keyframe || (view?.assetsByShot[s.id] && (view.assetsByShot[s.id].storyboard || view.assetsByShot[s.id].keyframe)));
    const FIELD = { padding: 8, borderRadius: 6, background: 'var(--gl-bg-surface)', color: 'inherit', border: '1px solid var(--gl-border-default,#333)' };

    return (
        <div className="page" id="page-videoshots">
            <div className="flex-between mb-16">
                <h2>Video Shots</h2>
                <div>
                    <button className="btn btn-secondary" onClick={() => legacy.downloadExport('premiere')} style={{ marginRight: 8 }} data-tooltip="Export a Premiere Pro XML timeline (File → Import in Premiere)" data-tooltip-pos="bottom">Send to Premiere</button>
                    <button className="btn btn-primary" onClick={generateAllVideos}>Generate All Videos</button>
                    <button className="btn btn-secondary" onClick={generateAllVoices} title="Every line in the film, in each character's cast voice">Generate All Dialogue</button>
                </div>
            </div>
            <div id="videoshotsProgress" style={{ display: progress ? 'block' : 'none' }} className="mb-16">
                <div className="text-sm text-muted mb-8" id="videoshotsProgressLabel">{progress ? progress.label : 'Starting...'}</div>
                <div style={{ background: 'var(--gl-bg-surface)', borderRadius: 'var(--gl-radius-md)', height: 10, overflow: 'hidden' }}>
                    <div id="videoshotsProgressBar" style={{ height: '100%', width: (progress ? progress.pct : 0) + '%', background: 'var(--gl-accent,#6366f1)', transition: 'width .2s' }} />
                </div>
            </div>
            {/* SEQUENCES: several shots, one continuous move, between frames the director already approved. */}
            <div className="card mb-16" id="sequenceSection">
                <h3 className="card-toggle">Sequences
                    <span className="card-toggle-hint">several shots, one move</span></h3>
                <p className="text-sm text-muted" style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
                    Select the shots a move travels through, in order, and describe the whole thing.
                    Each pair of neighbouring shots becomes one clip that starts on the first frame
                    and ends on the second &mdash; so the movement is between pictures you have
                    already approved, not a guess from a single still. You can also drop in a clip
                    you generated somewhere else.
                </p>
                <div id="sequenceShotPicker" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {view && !shots.length && <span className="text-sm text-muted">No shots yet.</span>}
                    {shots.map(s => {
                        const ok = framed(s);
                        const order = picked.indexOf(s.id);
                        return (
                            <button key={s.id} className={'btn btn-sm ' + (order >= 0 ? 'btn-primary' : 'btn-secondary')} disabled={!ok}
                                title={ok ? 'Add to the sequence, in the order you press them' : 'This shot has no keyframe yet — generate one before it can be part of a move'}
                                onClick={() => toggleSequenceShot(s.id)}>
                                {order >= 0 && <><strong>{order + 1}.</strong> </>}{s.shot_code || ''}
                            </button>
                        );
                    })}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <input id="sequenceName" placeholder="Name (e.g. The crossing)" style={{ ...FIELD, flex: '0 0 200px' }} value={seqName} onChange={e => setSeqName(e.target.value)} />
                    <textarea id="sequenceDescription" rows="2" value={seqDesc} onChange={e => setSeqDesc(e.target.value)}
                        placeholder="Details for the scene — the light, the weather, the lens, what is happening across the whole move. This reaches every clip in the sequence."
                        style={{ ...FIELD, flex: '1 1 340px', minWidth: 260, resize: 'vertical' }} />
                    <button className="btn btn-primary" onClick={createSequence} style={{ height: 38 }}>Create sequence</button>
                </div>
                {/* Filled by core's loadSequences (still legacy); React renders nothing inside it. */}
                <div id="sequenceList" style={{ marginTop: 14 }} />
            </div>

            <div className="entity-grid" id="videoshotsGrid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
                {view && (
                    <div style={{ gridColumn: '1/-1', background: 'var(--gl-bg-surface)', border: '1px solid var(--gl-border-subtle)', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="text-sm text-muted">Video provider: <strong style={{ color: 'var(--gl-text-primary)' }}>{view.provider}</strong></span>
                        <a className="text-sm" style={{ cursor: 'pointer', color: 'var(--gl-accent,#818cf8)' }} onClick={() => legacy.navigateTo('settings')}>Change in Settings →</a>
                    </div>
                )}
                {view && !shots.length && (
                    <div className="empty-state" style={{ gridColumn: '1/-1' }}><div className="icon">🎥</div><h3>No shots</h3>
                        <p>Create shots (Shot Board) first, then generate video clips from their storyboard keyframes.</p></div>
                )}
                {shots.map(s => <ShotCard key={s.id} s={s} job={view.jobByShot[s.id]} media={view.assetsByShot[s.id] || {}} pid={view.pid} />)}
            </div>
        </div>
    );
}
