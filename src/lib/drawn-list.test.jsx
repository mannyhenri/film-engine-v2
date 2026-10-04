import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import DrawnListControls from './drawn-list.jsx';

/*
 * A page mounts BEFORE the legacy core script runs (index.html: the module, then the deferred core), so the rows a
 * drawn list reads (core's state, PG, pb, MW) can throw at mount. That must cost nothing: no error out of the page,
 * no bar until the engine draws, and the bar once it does.
 */
const SURFACE = { id: 'probe', noun: 'things', search: ['name'], sorts: [], why: 'the order is the content here', filters: [] };

describe('a drawn list before the core exists', () => {
    it('rows that throw at mount: nothing thrown, no bar; the first draw after the core arrives brings the bar', async () => {
        let core = null;
        const rows = () => { if (!core) throw new Error('legacy.state: the core has not defined it'); return core; };
        const box = document.createElement('div');
        box.id = 'probeList';
        document.body.appendChild(box);
        expect(() => render(<DrawnListControls surface={SURFACE} container="probeList" item=":scope > p" rows={rows} />)).not.toThrow();
        expect(document.querySelector('[data-list-controls="probe"]')).toBeNull();
        core = [{ name: 'one' }, { name: 'two' }];
        await act(async () => { box.innerHTML = '<p>one</p><p>two</p>'; await new Promise(r => setTimeout(r, 0)); });
        expect(document.querySelector('[data-list-controls="probe"]')).toBeTruthy();
        box.remove();
    });
});
