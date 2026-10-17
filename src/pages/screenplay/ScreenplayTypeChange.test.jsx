import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import ScreenplayPage from './ScreenplayPage.jsx';
import * as E from './engine.js';

/*
 * Changing an element's type is an edit, and an edit is saved.
 *
 * The Glass Harbour script had an all-caps line saved as a forced heading
 * (`.ONE SHOT. NO CUTS. ...`). Changing it to Action from the dropdown changed
 * the block on screen, but nothing scheduled the auto-save — only typing did —
 * so the stored version still held the heading, and the next load put it back.
 */
const FOUNTAIN = [
    'INT. THE GLASS HARBOUR DINER - LATE AFTERNOON #1#',
    '',
    '.ONE SHOT. NO CUTS. FIVE MINUTES, ONE BREATH. #2#',
    '',
    'A 1941 diner, empty but for two.',
].join('\n');

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// jsdom has no innerText, and the editor reads it everywhere: without it every
// block looks empty and the empty-block sweep removes the whole script.
Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() { return this.textContent; },
    set(v) { this.textContent = v; },
});
// Nor scrollIntoView, which the scene navigator calls on the current scene.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};

function caretIn(block) {
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

describe('Screenplay: changing an element type', () => {
    it('saves the change, so an all-caps line changed to Action stays Action when the script is loaded again', async () => {
        let saved = null;
        const { fake } = installLegacy({
            routes: {
                'GET /projects/p1/scripts/15': () => ({ version: 15, fountain_content: saved ?? FOUNTAIN }),
                'PUT /projects/p1/script/15': (body) => { saved = body.fountain_content; return { ok: true }; },
            },
        });
        fake.escapeHtml.mockImplementation(fake.esc);   // the fake is a bare vi.fn(); the editor needs the text
        render(<ScreenplayPage />);
        vi.useFakeTimers();
        await act(async () => { await E.loadScriptVersion(15); });

        const editor = document.getElementById('screenplayEditor');
        const line = () => [...editor.querySelectorAll('[data-element-type]')].find(b => b.textContent.includes('ONE SHOT'));
        expect(line().dataset.elementType).toBe('scene-heading');

        caretIn(line());
        fireEvent.change(document.getElementById('elementTypeSelector'), { target: { value: 'action' } });
        expect(line().dataset.elementType).toBe('action');

        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(saved, 'the type change was never saved').not.toBeNull();
        expect(saved).toContain('\nONE SHOT. NO CUTS. FIVE MINUTES, ONE BREATH.\n');
        expect(saved).not.toContain('.ONE SHOT');

        await act(async () => { await E.loadScriptVersion(15); });
        expect(line().dataset.elementType).toBe('action');
    });
});
