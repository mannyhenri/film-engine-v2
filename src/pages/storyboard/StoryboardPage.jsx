import { useLayoutEffect, useState } from 'react';
import { legacy, setLegacy } from '../../lib/legacy.js';
import * as E from './engine.js';
import { usePageLoader } from '../../lib/usePageLoader.js';

/*
 * The Storyboard, as React: the board of frames, one card per shot.
 *
 * What React owns: loading the board, the grid of cards, each card's ratio guide and protect overlay,
 * the per-shot ratio picker, and the annotation-feedback switch. Everything else on a card is SHARED with
 * the frame viewer, the Production graph and the directing panels, and stays in core, reached through
 * `legacy`: the anchor, Direct, Regen, 4 angles, Refine, Import, versions, play-from-here, + Shot, the
 * facet tags, the dialogue, and the markup toolbar. Those helpers return core's own markup, rendered as
 * given, because a second copy of a control is how two surfaces come to disagree about what it does.
 *
 * Core also writes INTO this page by element id, and those ids are kept: img-<shot> (the regenerate veil,
 * the viewer), annot-<shot> (markup canvases), [data-facets] (drift and impact marks repainted when the
 * reports land), #boardBanners, #anchorChip, #annotFeedbackToggle/Text, #boardLockBtn, the progress bar,
 * #useReferencesToggle (read by Generate All) and #boardProtectRatio (its options are rewritten by core's
 * refreshProtectOptions, so React renders it once and never controls it).
 */
export const RATIO_CHOICES = ['', '9:16', '4:5', '1:1', '16:9'];

/** The frame the NEXT generation covers, drawn over the picture: the shot's own ratio, else the project's. */
export function ratioOf(frame, project) {
    const chosen = frame.aspect_ratio || (project || {}).aspect_ratio || '';
    const m = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(String(chosen).trim());
    return m ? { chosen, w: m[1], h: m[2], own: !!frame.aspect_ratio } : null;
}

const Html = ({ html, as: Tag = 'span', ...rest }) => <Tag {...rest} dangerouslySetInnerHTML={{ __html: html }} />;

export const ENGINE = Object.entries(E).filter(([, v]) => typeof v === 'function');

export default function StoryboardPage() {
    const [board, setBoard] = useState(null); // { pid, list }: the frames, and whose project they are
    const [protect, setProtect] = useState('');

    async function loadStoryboard() {
        E.loadBoardLock();
        if (!legacy.state.currentProject) return;
        legacy.setStatus('Loading storyboard...');
        const pid = legacy.state.currentProject.id;
        try {
            const data = await legacy.api('/projects/' + pid + '/storyboard');
            // An answer for a project you have since left draws nothing and writes nothing: it would paint A's frames
            // under B, and write A's anchor and annotation setting onto B (or, with no project open, crash the render).
            if (!legacy.state.currentProject || legacy.state.currentProject.id !== pid) return;
            const list = data.frames || [];
            // Read from the payload that drew the frames, not a second request that could answer differently.
            const p = legacy.state.currentProject;
            if (p) {
                p.annotation_feedback = data.annotation_feedback ? 1 : 0;
                p.anchor_shot_id = data.anchor_shot_id || null;
                const a = data.anchor_shot_id ? list.find(f => f.shot_id === data.anchor_shot_id) : null;
                setLegacy('BOARD_ANCHOR', a ? { shot_id: a.shot_id, shot_code: a.shot_code } : null);
            }
            E.ANCHOR.frames = list;
            legacy.FRAME_VIEWER.frames = list; // so the viewer can step between shots without the grid
            setBoard({ pid, list });
            E.renderAnnotationFeedbackToggle();
            E.renderAnchorChip();
            legacy.setStatus(list.length + ' storyboard frame(s)');
            // The warnings, after the pictures: additive, and seconds slower on a real project.
            E.loadBoardBanners();
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    usePageLoader('loadStoryboard', loadStoryboard);
    // What only the board reaches of core, moved into engine.js: on window while mounted, because the HTML core and the
    // engine draw (cards' shared parts, the frame viewer, the background picker and frame versions dialogs) calls it by name.
    useLayoutEffect(() => {
        const prior = {};
        for (const [name, fn] of ENGINE) { prior[name] = window[name]; window[name] = fn; }
        return () => { for (const [name] of ENGINE) { if (prior[name] === undefined) delete window[name]; else window[name] = prior[name]; } };
    }, []);

    async function setAnnotationFeedback(on) {
        if (!legacy.state.currentProject) return;
        try {
            const p = await legacy.api('/projects/' + legacy.state.currentProject.id, { method: 'PUT', body: JSON.stringify({ annotation_feedback: on ? 1 : 0 }) });
            legacy.state.currentProject = { ...legacy.state.currentProject, ...p };
            E.renderAnnotationFeedbackToggle();
            // Said plainly, because it is the part that surprises people: a mark is not consumed by the generation that acts on it.
            legacy.setStatus(on
                ? 'Marks carrying a note now steer this shot’s prompt, and keep doing so until deleted.'
                : 'Marks are notation only again. Nothing in generation reads them.');
            for (const shotId of Object.keys(legacy.MARKUP.cache)) legacy.markupPaintAll(shotId); // every badge is now wrong
        } catch (err) {
            legacy.setStatus('Could not change that: ' + err.message);
            E.renderAnnotationFeedbackToggle();
        }
    }

    // Drawn only for the project that is open: after you leave it (or with none open) the board is empty, so no
    // re-render calls core's frame helpers, which read the open project, against another one or none.
    const open = board ? legacy.state.currentProject : null; // board only exists once core has loaded
    const frames = board && open && board.pid === open.id ? board.list : null;
    const project = (frames && open) || {};
    return (
        <div className="page" id="page-storyboard">
            <div className="flex-between mb-16">
                <h2>Storyboard</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* The protect frame: what a vertical or square placement would keep, drawn over every tile. */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}
                        title="Draw what a vertical or square placement would keep, over every tile">
                        Protect
                        <select id="boardProtectRatio" defaultValue="" style={{ width: 'auto', display: 'inline-block', minWidth: 90 }}
                            onChange={(e) => setProtect(e.target.value)}>
                            <option value="">off</option><option value="9:16">9:16</option><option value="4:5">4:5</option>
                            <option value="1:1">1:1</option><option value="16:9">16:9</option>
                        </select>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" id="useReferencesToggle" style={{ cursor: 'pointer' }} />
                        Use References
                    </label>
                    {/* Off by default; the label says which of two things markup currently is. Core keeps it in step. */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }} id="annotFeedbackLabel"
                        title="When on, every mark carrying a note is added to this shot's prompt each time it is generated, until you delete the mark.">
                        <input type="checkbox" id="annotFeedbackToggle" style={{ cursor: 'pointer' }} onChange={(e) => setAnnotationFeedback(e.target.checked)} />
                        <span id="annotFeedbackText">Marks are notes only</span>
                    </label>
                    {/* The frame currently being shot from. Shown by core only while an anchor is set. */}
                    <span id="anchorChip" style={{ display: 'none', alignItems: 'center', gap: 6, fontSize: 13, padding: '3px 8px', borderRadius: 999, border: '1px solid var(--gl-brand-pink,#ec4899)' }}>
                        <span id="anchorChipText"></span>
                        <button className="btn btn-sm" style={{ padding: '0 6px' }} onClick={() => E.clearAnchor()}
                            title="Put the anchor down — shots go back to generating from their plates">clear</button>
                    </span>
                    <button className="btn btn-primary" onClick={() => legacy.generateAllStoryboards()}>Generate All</button>
                    <button className="btn btn-secondary" id="boardLockBtn" onClick={() => legacy.toggleBoardLock()}
                        title="Lock the board when you are happy with it — nothing that replaces a frame will run until you unlock">Lock board</button>
                </div>
            </div>
            <div id="storyboardProgress" style={{ display: 'none' }} className="card mb-16">
                <div className="flex-between mb-8">
                    <span id="storyboardProgressLabel">Generating storyboards...</span>
                    <span id="storyboardProgressPct">0%</span>
                </div>
                <div style={{ background: 'var(--gl-border-subtle)', borderRadius: 4, height: 8, overflow: 'hidden', marginBottom: 8 }}>
                    <div id="storyboardProgressBar" style={{ background: 'linear-gradient(90deg,#e91e63,#2196f3)', height: '100%', width: '0%', transition: 'width 0.3s ease', borderRadius: 4 }}></div>
                </div>
                <div id="storyboardImageProgress" style={{ display: 'none' }}>
                    <div className="flex-between" style={{ fontSize: 12, color: 'var(--gl-text-muted)', marginBottom: 4 }}>
                        <span id="storyboardImageLabel">Loading model...</span>
                        <span id="storyboardImageStep"></span>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                        <div id="storyboardImageBar" style={{ width: '0%', height: '100%', background: 'linear-gradient(90deg,#7c4dff,#ab47bc)', borderRadius: 4, transition: 'width 0.2s ease' }}></div>
                    </div>
                </div>
            </div>
            {/* Banners OUTSIDE the grid (a grid child takes a frame's cell); filled by core when the reports land. */}
            <div id="boardBanners"></div>
            <div id="storyboardGrid" className="entity-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))' }}>
                {frames && !frames.length && (
                    <div className="empty-state" style={{ gridColumn: '1/-1' }}>
                        <div className="icon">&#128444;</div>
                        <h3>No storyboard frames</h3>
                        <p>Click "Generate All" to create storyboard frames from your scene cards.</p>
                    </div>
                )}
                {(frames || []).map(f => <FrameCard key={f.shot_id} f={f} project={project} protect={protect} />)}
            </div>
        </div>
    );
}

function FrameCard({ f, project, protect }) {
    const [aspect, setAspect] = useState(null); // the picture's own shape, once it has loaded
    const [hidden, setHidden] = useState(false);
    const guide = ratioOf(f, project);
    const ratios = protect ? legacy.protectSelection(protect) : [];
    return (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ position: 'relative', background: 'var(--surface-alt,var(--gl-bg-surface))', minHeight: 160 }}>
                <img id={'img-' + f.shot_id} loading="lazy" src={legacy.frameSrc(f, 640)} alt=""
                    style={{ width: '100%', display: hidden ? 'none' : 'block', cursor: 'zoom-in' }} title="Open full screen"
                    onClick={() => legacy.openFrameViewer(f.shot_id)}
                    onError={() => setHidden(true)}
                    onLoad={(e) => { setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight); E.storyboardDrawAnnotations(f.shot_id); }} />
                <canvas id={'annot-' + f.shot_id} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}></canvas>
                {/* What the placement keeps, and (dimmed) what it throws away; readable only against the whole frame. */}
                <Html as="div" className="board-protect" data-shot={f.shot_id}
                    style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: ratios.length && aspect ? 'block' : 'none' }}
                    html={ratios.length && aspect ? legacy.protectOverlayHTML(aspect, ratios) : ''} />
                {guide && <>
                    <div className={'board-ratio ' + (guide.own ? 'own' : 'project')} style={{ aspectRatio: `${guide.w}/${guide.h}` }}
                        title={`${guide.chosen} — the frame this shot generates at`}></div>
                    <span className={'board-ratio-tag ' + (guide.own ? 'own' : 'project')}>{guide.chosen}{guide.own ? '' : ' (project)'}</span>
                </>}
            </div>
            <div style={{ padding: 10 }}>
                <strong>Sc{f.scene_number} / {f.shot_code}</strong>
                {/* Shoot this one at its own ratio: a 9:16 crop keeps a third of the width. Blank inherits the project's. */}
                <select data-field="aspect_ratio" title="Generate this shot at its own ratio" defaultValue={f.aspect_ratio || ''}
                    onChange={(e) => E.setShotAspect(f.shot_id, e.target.value)}
                    style={{ width: 'auto', display: 'inline-block', marginLeft: 8, fontSize: 11 }}>
                    {RATIO_CHOICES.map(r => <option key={r} value={r}>{r || 'project ratio'}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                    <Html style={{ display: 'contents' }} html={E.anchorButton(f)} />
                    <button className="btn btn-secondary btn-sm" onClick={() => legacy.directShot(f.shot_id)} title="Who and what is in this shot, and where the camera is">Direct</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => legacy.regenerateStoryboard(f.shot_id)}
                        title={f.image_url ? 'Generate this frame again from the card — shows you the prompt first' : 'This shot has no frame yet — generate its first one. You will see the prompt before anything is spent.'}>
                        {f.image_url ? 'Regen' : 'Generate'}</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => legacy.exploreAngles(f.shot_id)} title="Explore four angles: four separate images, one camera each, at the project resolution. Pick one and it becomes the frame.">4 angles</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => legacy.refineFrame(f.shot_id)} title="Keep this picture and change one thing about it">Refine</button>
                    <Html style={{ display: 'contents' }} html={E.storyboardImportButton(f)} />
                    <button className="btn btn-secondary btn-sm" onClick={() => E.openFrameVersions(f.shot_id)} title={E.frameVersionTitle(f)}>{E.frameVersionLabel(f)}</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => E.playFromShot(f.shot_id)} title="Watch the cut starting from this shot">&#9654;</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => E.insertShotAfter(f.shot_id)} title="Add a new shot immediately after this one, in the same scene">+ Shot</button>
                </div>
                {/* Its own target, so the drift and impact marks are painted in by core when those reports land. */}
                <Html as="div" data-facets={f.shot_id} html={E.storyboardFacetTags(f)} />
                {f.description && <p className="text-sm" style={{ marginTop: 6, lineHeight: 1.45 }}>{f.description}</p>}
                <Html as="div" html={legacy.storyboardDialogueHtml(f.dialogue)} />
                <Html as="div" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }} html={legacy.markupToolbar(f.shot_id, 'annot-' + f.shot_id, 'img-' + f.shot_id)} />
            </div>
        </div>
    );
}
