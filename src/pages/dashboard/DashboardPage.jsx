import { useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';

/*
 * The home page, as React: what was I doing, what needs me, where is the film, what is running, and the
 * plan-and-shoot panels. Replaces the legacy functions listed in react.json: the same routes, markup
 * (ids, classes) and lines. Every block carries its own way in.
 */

/*
 * Plan & Shoot, on the page you land on. Every panel CARRIES ITS WAY IN (`go`); a panel with no destination
 * does not belong here (the conform panel is reached from Export, where the delivery actions are).
 */
const HOME_PANELS = [
    { id: 'run-plan', title: 'Run plan', render: p => `${p.total_items} item(s) in ${p.strips.length} strip(s) · ${p.model_switches} model switch(es) · $${(p.projected_cost || 0).toFixed(2)}${p.refused ? ' · REFUSED (over budget)' : ''}`, go: 'pipeline' },
    { id: 'staleness', title: 'Staleness', render: p => `${p.summary.stale} stale · ${p.summary.fresh} current · ${p.summary.unknown} unknown`, go: 'storyboard' },
    { id: 'dood', title: 'Day out of days', render: p => `${p.characters.length} character(s) · ${p.needs_plate.length} still need a plate`, go: 'characters' },
    { id: 'sides', title: 'Sides', render: p => `${p.speaking} speaking · ${p.non_speaking.length} non-speaking`, go: 'screenplay' },
    { id: 'elements-list', title: 'Elements', render: p => `${p.elements.characters.length} characters · ${p.elements.locations.length} locations · ${p.elements.props.length} props · ${p.undescribed.length} undescribed`, go: 'props' },
    { id: 'breakdown-summary', title: 'Breakdown', render: p => `${p.totals.scenes} scene(s) · ${p.totals.shots} shot(s) · ${p.totals.dialogue_lines} line(s)`, go: 'scenes' },
    { id: 'setups', title: 'Setups', render: p => `${p.setups.length} setup(s) · ${p.reused_shots} shot(s) reuse another’s conditioning`, go: 'shotboard' },
    { id: 'board-groups', title: 'Board', render: p => `${p.groups.length} group(s) by ${p.axis}`, go: 'storyboard' },
    { id: 'run-report', title: 'Runs', render: p => `${p.summary.total} run(s) · ${p.summary.failed} failed · $${(p.spend.recorded || 0).toFixed(2)} spent`, go: 'jobsqueue' },
];
const go = (page) => (e) => { if (e) e.preventDefault(); legacy.navigateTo(page); };
const capitalise = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const JOBS_LINK = { color: '#6690ff', fontSize: 12.5 };

function Greeting({ g }) {
    if (!g) return null;
    // The name is the app author, the one place a name is recorded; without one it does not pretend to know you.
    const bits = [g.project_title, `${plural(g.shot_count, 'shot')} across ${plural(g.scene_count, 'scene')}`];
    if (g.last_opened) bits.push(`last opened ${g.last_opened}`);
    return <><h1>{g.name ? `${g.salutation}, ${g.name}` : g.salutation}</h1><p>{bits.join(' · ')}</p></>;
}

function Resume({ r, onResume }) {
    if (!r) return <><div className="k">Pick up where you left off</div><div className="home-empty">Nothing worked on yet.</div></>;
    const src = r.has_keyframe && legacy.state.currentProject
        ? `${legacy.API_BASE}/film/storyboards/${legacy.state.currentProject.id}/${encodeURIComponent(r.shot_code)}.png` : '';
    return (
        <>
            <div className="k">Pick up where you left off</div>
            <div className="home-resume-body home-resume">
                {src ? <img className="home-thumb" src={src} onError={e => { e.currentTarget.style.visibility = 'hidden'; }} /> : <div className="home-thumb" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h3>{r.headline}</h3>
                    <p className="text-sm text-muted" style={{ margin: '0 0 12px', lineHeight: 1.5 }}>{r.summary}</p>
                    <p className="text-sm text-muted" style={{ margin: '0 0 12px' }}>{r.state}{r.when ? ' · ' + r.when : ''}</p>
                    <button className="btn btn-primary btn-sm" onClick={() => onResume(r.shot_id)}>Resume</button>
                    {' '}<button className="btn btn-secondary btn-sm" onClick={go('storyboard')}>Open board</button>
                </div>
            </div>
        </>
    );
}

/* Every line carries the page that fixes it: an item with no destination is a to-do list. */
function Needs({ items }) {
    if (!items || !items.length) return <><div className="k">Needs you</div><div className="home-empty">Nothing is blocking the film.</div></>;
    return <><div className="k">Needs you</div>{items.map((n, i) => (
        <div className="home-need" key={i}><span className="dot" /><span>{n.label}</span>
            <a href="#" onClick={go(n.page)}>{capitalise(n.phase || 'Open')}</a></div>
    ))}</>;
}

function Phases({ phases }) {
    return (phases || []).map(p => {
        const pct = p.of > 0 ? Math.round((p.done / p.of) * 100) : 0;
        return (
            <button className="home-phase" key={p.page + p.label} onClick={go(p.page)}>
                <div className="row"><span className="name">{p.label}</span><span className="frac">{p.done}/{p.of}</span></div>
                <div className="bar"><div className="fill" style={{ width: pct + '%' }} /></div>
                <div className="note">{p.note}</div>
            </button>
        );
    });
}

function Activity({ items }) {
    if (!items || !items.length) return <><div className="k">Recent activity</div><div className="home-empty">Nothing generated yet.</div></>;
    return <><div className="k">Recent activity</div>{items.map((a, i) => (
        <div className="home-line" key={i}><span className="t">{String(a.when || '')}</span><span>{a.what}</span></div>
    ))}</>;
}

function Running({ jobs }) {
    const link = <a href="#" style={JOBS_LINK} onClick={go('jobsqueue')}>Open job queue &rarr;</a>;
    // Empty is a real answer here, not a missing one.
    if (!jobs || !jobs.length) return <><div className="k">Running now</div><div className="home-empty">Nothing is generating.</div>{link}</>;
    return <><div className="k">Running now</div>{jobs.map((j, i) => (
        <div className="home-run" key={i}>
            <div className="row"><span>{j.kind}{j.shot_code ? ' — ' + j.shot_code : ''}</span><span className="text-muted text-sm">{j.status}</span></div>
            <div className="bar"><div className="fill" style={{ width: (j.status === 'running' ? 60 : 15) + '%' }} /></div>
        </div>
    ))}{link}</>;
}

function Panels({ results }) {
    if (!results) return null;
    if (results === 'loading') return <div className="text-muted">Loading…</div>;
    return results.map(({ panel, body, ok }) => (
        <div className="card home-panel" key={panel.id} onClick={go(panel.go)} title={'Open ' + panel.go}>
            <div className="flex-between"><strong>{panel.title}</strong>
                <button className="btn btn-sm" onClick={e => { e.stopPropagation(); legacy.navigateTo(panel.go); }}>Open</button></div>
            <p className={'text-sm ' + (ok ? '' : 'text-muted')} style={{ marginTop: 6 }}>{body}</p>
        </div>
    ));
}

export default function DashboardPage() {
    const [home, setHome] = useState(null);
    const [panels, setPanels] = useState(null);

    /*
     * The panels: AFTER the rest of home and not awaited by it, fetched CONCURRENTLY (nine local SQLite reads;
     * in series they measured 8.9s). A panel that cannot load says so: nine silent empties would read as
     * "nothing to report", which is a different claim.
     */
    async function loadHomePanels() {
        if (!legacy.state.currentProject) return;
        setPanels('loading');
        const pid = legacy.state.currentProject.id;
        setPanels(await Promise.all(HOME_PANELS.map(panel =>
            legacy.api(`/projects/${pid}/${panel.id}`)
                .then(data => ({ panel, body: panel.render(data), ok: true }))
                .catch(err => ({ panel, body: err.message || 'unavailable', ok: false })))));
    }

    /* Every block reads home.<field> from one payload, and carries its own way in. */
    async function loadDashboard() {
        if (!legacy.state.currentProject) return;
        let data;
        try { data = await legacy.api('/projects/' + legacy.state.currentProject.id + '/home'); }
        catch (err) { legacy.setStatus('Could not load home: ' + err.message); return; }
        setHome(data);
        legacy.setStatus(`${data.greeting.project_title} · ${data.greeting.shot_count} shots`);
        loadHomePanels();
    }
    usePageLoader('loadDashboard', loadDashboard);

    /* Pick up where you left off: go to the board AND open the frame (closing it leaves you where you work). */
    async function resumeShot(shotId) {
        legacy.navigateTo('storyboard');
        await legacy.openFrameViewer(shotId);
    }

    return (
        <div className="page" id="page-dashboard">
            <div id="homeGreeting" className="home-greeting">{home && <Greeting g={home.greeting} />}</div>
            <div className="home-row-2">
                <div className="home-card" id="homeResume">{home && <Resume r={home.resume} onResume={resumeShot} />}</div>
                <div className="home-card" id="homeNeeds">{home && <Needs items={home.needs} />}</div>
            </div>
            <div className="home-kicker">The whole film, phase by phase</div>
            <div id="homePhases" className="home-phases">{home && <Phases phases={home.phases} />}</div>
            <div className="home-kicker">Plan &amp; shoot</div>
            <div id="homePanels" className="home-panels"><Panels results={panels} /></div>
            <div className="home-row-2">
                <div className="home-card" id="homeActivity">{home && <Activity items={home.activity} />}</div>
                <div className="home-card" id="homeRunning">{home && <Running jobs={home.running} />}</div>
            </div>
        </div>
    );
}
