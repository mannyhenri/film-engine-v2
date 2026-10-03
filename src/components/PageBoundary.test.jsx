import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useState } from 'react';
import PageBoundary from './PageBoundary.jsx';
import { usePageLoader } from '../lib/usePageLoader.js';

/*
 * One page's render error stays that page's: the user's "the previous project is opened, and then no projects
 * load" was a storyboard render error unmounting the whole app (sidebar, project list, every page).
 */
// Broken the way a late answer is: every render of loaded data throws while the condition holds (React retries a
// failed render once, so a one-shot throw would not reach the boundary at all).
let broken = false;
function Fragile() {
    const [n, setN] = useState(0);
    usePageLoader('loadFragile', () => setN(x => x + 1));
    if (n > 0 && broken) throw new Error('drawn against no project');
    return <div className="page" id="page-fragile">fragile {n}</div>;
}
const Sibling = () => <div id="sidebar">still here</div>;
afterEach(() => { broken = false; delete window.state; delete window.navigateTo; vi.restoreAllMocks(); });

describe('PageBoundary', () => {
    it('a page that throws while drawing is remounted fresh; its siblings stay; its loader is registered again', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<><Sibling /><PageBoundary name="page fragile" pageId="fragile"><Fragile /></PageBoundary></>);
        broken = true;
        act(() => { window.loadFragile(); });
        expect(screen.getByText('still here')).toBeTruthy();
        expect(screen.getByText('fragile 0')).toBeTruthy();              // its own empty first render
        expect(typeof window.loadFragile).toBe('function');               // core can still call it
        broken = false;
        act(() => { window.loadFragile(); });
        expect(screen.getByText('fragile 1')).toBeTruthy();
    });

    it('the page on screen is shown and loaded again after the remount', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        window.state = { currentPage: 'fragile' };
        window.navigateTo = vi.fn();
        render(<PageBoundary name="page fragile" pageId="fragile"><Fragile /></PageBoundary>);
        broken = true;
        act(() => { window.loadFragile(); });
        expect(window.navigateTo).toHaveBeenCalledWith('fragile');
    });

    it('a page that keeps failing says so, under its own id, and can be tried again', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        window.state = { currentPage: 'fragile' };
        window.navigateTo = vi.fn();
        render(<><Sibling /><PageBoundary name="page fragile" pageId="fragile"><Fragile /></PageBoundary></>);
        broken = true;
        for (let i = 0; i < 3; i++) act(() => { window.loadFragile(); });
        const page = document.getElementById('page-fragile');
        expect(page.classList.contains('active')).toBe(true);
        expect(page.textContent).toContain('This page could not be drawn');
        expect(page.textContent).toContain('drawn against no project');
        expect(screen.getByText('still here')).toBeTruthy();
        broken = false;
        act(() => { screen.getByRole('button', { name: 'Try again' }).click(); });
        expect(screen.getByText('fragile 0')).toBeTruthy();
    });
});
