import { Component, useLayoutEffect } from 'react';

/*
 * One page's error stays that page's.
 *
 * React unmounts the WHOLE root on an uncaught render error. Every page and the shell share one root, so a
 * page that threw while drawing (a late answer for the project you just left, rendered against no project)
 * took the sidebar, the project list and every other page with it: "the previous project is opened, and then
 * no projects load". Each page and each boot-mounted component is wrapped in one of these.
 *
 * On an error the page is REMOUNTED fresh, not replaced by a message: unmounting a page unregisters its loader
 * (usePageLoader), so a fallback would leave core calling a loader that is gone on the next visit. A fresh
 * mount is the page's own empty first render with every name it provides registered again; if it is the page
 * on screen, it is shown and loaded again (navigateTo, which core uses for every visit). Only a page that keeps
 * failing (3 times in 10s) shows the error instead, still under its own id so navigation can show it.
 */
export default class PageBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { generation: 0, crashed: false, failed: null };
        this.recent = [];
    }

    static getDerivedStateFromError() { return { crashed: true }; }

    componentDidCatch(error) {
        const now = Date.now();
        this.recent = [...this.recent.filter(t => now - t < 10000), now];
        console.error(`[${this.props.name}] render error; remounted fresh:`, error, '\n' + String((error && error.stack) || '').split('\n').slice(0, 6).join('\n'));
        if (this.recent.length >= 3) this.setState({ crashed: false, failed: String((error && error.message) || error) });
        else this.setState(s => ({ crashed: false, generation: s.generation + 1 }));
    }

    render() {
        const { crashed, failed, generation } = this.state;
        const { pageId, children } = this.props;
        if (failed && pageId) {
            const active = window.state && window.state.currentPage === pageId;
            return (
                <div className={'page' + (active ? ' active' : '')} id={'page-' + pageId}>
                    <div className="empty-state"><h3>This page could not be drawn</h3><p>{failed}</p>
                        <button className="btn btn-secondary" onClick={() => { this.recent = []; this.setState(s => ({ failed: null, generation: s.generation + 1 })); }}>Try again</button></div>
                </div>
            );
        }
        if (crashed || failed) return null;
        return <Generation key={generation} generation={generation} pageId={pageId}>{children}</Generation>;
    }
}

/** A mount of the page; after a remount, the page on screen is shown and loaded again. */
function Generation({ generation, pageId, children }) {
    useLayoutEffect(() => {
        if (!generation || !pageId || !window.state || window.state.currentPage !== pageId) return;
        // After the page's own layout effects (children run first), so its loader is registered again.
        if (typeof window.navigateTo === 'function') window.navigateTo(pageId);
    }, [generation, pageId]);
    return children;
}
