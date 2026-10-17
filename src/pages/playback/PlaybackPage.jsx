import { useLayoutEffect } from 'react';
import { usePageLoader } from '../../lib/usePageLoader.js';
import * as P from './player.js';
import Lists from './lists.jsx';

/*
 * Playback, as React: the page is rendered once, and the engine (player.js, moved verbatim from the legacy
 * chunk) drives the media through the elements' ids — the video, the dialogue and the two beds, the scrub,
 * the playlist, the timecode. Nothing here re-renders while the cut plays; the controls are uncontrolled and
 * the engine reads them (the Dialogue / Camera move / Music / Ambient switches, the note fields).
 *
 * Every engine function is also put on window at mount, as the chunk had them: the engine renders HTML with
 * inline handlers (the playlist's rows, the note list) that call them by name.
 */
export const ENGINE = Object.entries(P).filter(([, v]) => typeof v === 'function');

export default function PlaybackPage() {
    usePageLoader('loadPlayback', P.loadPlayback);
    useLayoutEffect(() => {
        const prior = {};
        for (const [name, fn] of ENGINE) { prior[name] = window[name]; window[name] = fn; }
        window.addEventListener('keydown', P.pbKeydown); // it acts only while this page is on screen
        return () => {
            window.removeEventListener('keydown', P.pbKeydown);
            for (const [name] of ENGINE) { if (prior[name] === undefined) delete window[name]; else window[name] = prior[name]; }
        };
    }, []);
    return (
        <div className="page" id="page-playback">
            <Lists />
            <div className="page-header"><h2>Playback</h2></div>
            <div className="flex-between mb-16">
                <div className="text-sm text-muted" id="playbackSummary">Loading timeline…</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }} title="Draw what a vertical or square placement would keep, over the cut">
                        Protect
                        {/* Its options are written by core's refreshProtectOptions, so React renders it once. */}
                        <select id="pbProtectRatio" defaultValue="" onChange={() => P.renderPlaybackProtect()} style={{ width: 'auto', display: 'inline-block', minWidth: 110 }}>
                            <option value="">off</option>
                        </select>
                    </label>
                    <button className="btn btn-secondary btn-sm" onClick={() => P.loadPlayback()}>Refresh</button>
                </div>
            </div>

            <div id="playbackEmpty" className="glossary-empty hidden">
                No shots yet. Create shots on the Shot Board, then generate video — the assembled cut appears here.
            </div>

            <div id="playbackMain" className="hidden">
                <div className="pb-stage">
                    <video id="pbVideo" className="pb-video" preload="metadata" playsInline></video>
                    {/* The protect frame over the CUT, sized in script against the video's own pixels. */}
                    <div id="pbProtect" style={{ position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: 3 }}></div>
                    {/* The shot's dialogue, heard not seen; its transport is the timeline's. */}
                    <audio id="pbAudio" preload="auto" style={{ display: 'none' }}></audio>
                    {/* The scene's score and its ambient bed: separate levels, and not restarted at each cut. */}
                    <audio id="pbMusic" preload="auto" style={{ display: 'none' }}></audio>
                    <audio id="pbAmbient" preload="auto" style={{ display: 'none' }}></audio>
                    <div id="pbStill" className="pb-still hidden"></div>
                    <div id="pbGap" className="pb-gap hidden">
                        <div>
                            <div className="pb-gap-title">No picture for this shot</div>
                            <div className="text-sm text-muted" id="pbGapDetail"></div>
                        </div>
                    </div>
                </div>

                {/* Scrub bar across the WHOLE cut, with note markers. */}
                <div className="pb-scrub-wrap">
                    <div className="pb-scrub" id="pbScrub" onClick={(e) => P.pbSeekFromClick(e.nativeEvent)}>
                        <div className="pb-scrub-fill" id="pbScrubFill"></div>
                        <div className="pb-shot-ticks" id="pbShotTicks"></div>
                        <div className="pb-note-markers" id="pbNoteMarkers"></div>
                        <div className="pb-mark-range" id="pbMarkRange" style={{ display: 'none' }}></div>
                    </div>
                    <div className="flex-between mt-8">
                        <div className="pb-transport">
                            <button className="btn btn-secondary btn-sm" onClick={() => P.pbTogglePlay()} id="pbPlayBtn">Play</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => P.pbFrameStep(-1)} title="One frame back (←)">&#8249;|</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => P.pbFrameStep(1)} title="One frame forward (→)">|&#8250;</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => P.pbMarkIn()} title="Mark the point a repair starts from (I)">Mark in</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => P.pbMarkOut()} title="Mark the point a repair must arrive at">Mark out</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => P.pbClearMarks()} id="pbClearMarksBtn" style={{ display: 'none' }}>Clear marks</button>
                            <button className="btn btn-primary btn-sm" onClick={() => P.pbRunRepair()} id="pbRepairBtn" style={{ display: 'none' }}>Repair this</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => P.pbStep(-1)} title="Previous shot">&#9664;&#9664;</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => P.pbStep(1)} title="Next shot">&#9654;&#9654;</button>
                            <label className="text-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8, cursor: 'pointer' }} title="Play each shot's dialogue as its shot comes up">
                                <input type="checkbox" id="pbDialogue" defaultChecked onChange={() => P.pbDialogueToggled()} /> Dialogue
                            </label>
                            <label className="text-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} title="Play each shot's camera move over its storyboard frame">
                                <input type="checkbox" id="pbMotion" defaultChecked onChange={() => P.pbMotionToggled()} /> Camera move
                            </label>
                            <label className="text-sm" id="pbScoreLabel" style={{ display: 'none', alignItems: 'center', gap: 6, cursor: 'pointer' }} title="Play each scene's music under its shots">
                                <input type="checkbox" id="pbScore" defaultChecked onChange={() => P.pbBedsToggled()} /> Music
                            </label>
                            <label className="text-sm" id="pbAmbientLabel" style={{ display: 'none', alignItems: 'center', gap: 6, cursor: 'pointer' }} title="Play each scene's ambient bed under its shots">
                                <input type="checkbox" id="pbAmbient2" defaultChecked onChange={() => P.pbBedsToggled()} /> Ambient
                            </label>
                            {/* THE ONE CONTROL HERE THAT SPENDS MONEY: set apart and marked. Everything left of it changes what you HEAR; this changes what EXISTS. */}
                            <span className="pb-sep" aria-hidden="true"></span>
                            <button className="btn btn-warning btn-sm" onClick={() => P.pbRegenerateDialogue()}
                                title="Buy a fresh take of this scene's dialogue — after a rewrite, a recast, or a change of delivery direction. Costs credits.">&#127908; Redo dialogue</button>
                            <span id="pbMoveLabel" className="text-sm text-muted"></span>
                            <span id="pbBedLabel" className="text-sm text-muted"></span>
                        </div>
                        <div className="pb-timecode">
                            <span id="pbTimecode">00:00:00:00</span>
                            <span className="text-muted"> / </span>
                            <span id="pbTotalTimecode" className="text-muted">00:00:00:00</span>
                        </div>
                    </div>
                </div>

                <div className="pb-columns">
                    <div>
                        <div className="section-label">Shot list</div>
                        <div id="pbPlaylist" className="pb-playlist"></div>
                    </div>
                    <div>
                        {/* The note is pinned to wherever the playhead is. */}
                        <div className="section-label">Note at this moment</div>
                        <div className="pb-note-box">
                            <div className="text-sm mb-8">Pinning to <strong id="pbNoteTarget">—</strong></div>
                            <select id="pbNoteType" className="mb-8" defaultValue="general">
                                {['general', 'direction', 'revision', 'camera', 'lighting', 'performance', 'continuity', 'vfx', 'color', 'audio'].map(t =>
                                    <option key={t} value={t}>{t === 'vfx' ? 'VFX' : t[0].toUpperCase() + t.slice(1)}</option>)}
                            </select>
                            <textarea id="pbNoteText" rows={3} placeholder="What is wrong at this frame?" defaultValue="" />
                            <button className="btn btn-primary btn-sm mt-8" onClick={() => P.pbAddNote()}>Add note here</button>
                            <div id="pbNoteStatus" className="text-sm text-muted mt-8"></div>
                        </div>
                        <div className="section-label mt-16">Timecoded notes</div>
                        <div id="pbNoteList" className="pb-note-list"></div>
                    </div>
                </div>
            </div>
        </div>
    );
}
