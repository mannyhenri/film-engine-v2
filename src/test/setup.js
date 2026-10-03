/*
 * A fake of the legacy core, for React page tests: every name in LEGACY_GLOBALS,
 * so a page under test reaches exactly what it reaches in the app. api() is a
 * route table the test fills; showModal/closeModal behave like the real stack
 * (the `open` class on the overlay by id).
 */
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { LEGACY_GLOBALS } from '../lib/legacy.js';

export function installLegacy({ routes = {}, project = { id: 'p1' } } = {}) {
    const calls = [];
    const status = [];
    const fake = {
        api: vi.fn(async (path, opts = {}) => {
            const method = opts.method || 'GET';
            calls.push({ method, path, body: opts.body ? JSON.parse(opts.body) : undefined });
            const handler = routes[`${method} ${path}`];
            if (!handler) throw new Error(`no fake route for ${method} ${path}`);
            return typeof handler === 'function' ? handler(opts.body ? JSON.parse(opts.body) : undefined) : handler;
        }),
        setStatus: vi.fn((text) => status.push(text)),
        state: { currentProject: project, currentPage: null },
        esc: (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
        showModal: vi.fn((id) => document.getElementById(id)?.classList.add('open')),
        closeModal: vi.fn((id) => document.getElementById(id)?.classList.remove('open')),
        navigateTo: vi.fn(),
    };
    const missing = LEGACY_GLOBALS.filter(n => !(n in fake));
    if (missing.length) throw new Error('the test fake lacks ' + missing.join(', ') + ' (src/test/setup.js)');
    Object.assign(window, fake);
    return { calls, status, fake };
}

afterEach(() => { cleanup(); for (const n of LEGACY_GLOBALS) delete window[n]; });
