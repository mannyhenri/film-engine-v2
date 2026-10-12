import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {installLegacy} from '../test/setup.js';

const token = 'c'.repeat(64);
let aiAPI;
beforeEach(async () => {vi.resetModules(); ({aiAPI} = await import('./ai-api.js'));});
afterEach(() => {delete window.__filmAI; delete window.__feDesktop;});

describe('AI capability transport', () => {
    it('adds desktop capability and JSON headers through legacy.api, preserving its options and errors', async () => {
        const {fake} = installLegacy(); fake.API_BASE = window.API_BASE = 'http://127.0.0.1:3100';
        const bridge = vi.fn(async () => ({apiBase: fake.API_BASE, capability: token}));
        window.__filmAI = {getCapability: bridge};
        fake.api.mockResolvedValue({ok: true});
        const options = {method: 'POST', body: '{"owner":"fixture"}', refresh: false, keepalive: true, headers: {'X-Request-Id': 'fixture'}};
        expect(await aiAPI('/ai-connections/attach', options)).toEqual({ok: true});
        expect(fake.api).toHaveBeenCalledWith('/ai-connections/attach', {...options, headers: {'Content-Type': 'application/json', 'X-Request-Id': 'fixture', 'X-Film-AI-Capability': token}});
        const error = Object.assign(Error('Owned request failed'), {status: 409}); fake.api.mockRejectedValueOnce(error);
        await expect(aiAPI('/projects/p1/ai-workspace/tasks/t1/execute', {method: 'POST'})).rejects.toBe(error);
        expect(bridge).toHaveBeenCalledTimes(1);
    });

    it('bootstraps localhost web development once in memory using the same legacy transport', async () => {
        const {fake} = installLegacy(); fake.API_BASE = window.API_BASE = 'http://localhost:3100';
        fake.api.mockImplementation(async path => path === '/ai-capability' ? {capability: token} : {ok: true});
        await aiAPI('/ai-workspace'); await aiAPI('/ai-connections');
        expect(fake.api.mock.calls.map(c => c[0])).toEqual(['/ai-capability', '/ai-workspace', '/ai-connections']);
        expect(fake.api.mock.calls[0][1]).toEqual({refresh: false});
        expect(fake.api.mock.calls[1][1].headers['X-Film-AI-Capability']).toBe(token);
        expect(localStorage.getItem('film-ai-capability')).toBeNull();
    });

    it('rejects foreign API destinations and a desktop capability for a different backend before sending', async () => {
        const {fake} = installLegacy(); window.__filmAI = {getCapability: vi.fn(async () => ({apiBase: 'http://localhost:3100', capability: token}))};
        for (const base of ['http://192.168.1.4:3100', 'http://evil.test:3100', 'http://localhost.evil.test:3100', 'http://user:password@localhost:3100']) {
            fake.API_BASE = window.API_BASE = base;
            await expect(aiAPI('/ai-workspace')).rejects.toThrow(/local Film/);
        }
        expect(window.__filmAI.getCapability).not.toHaveBeenCalled(); expect(fake.api).not.toHaveBeenCalled();
        fake.API_BASE = window.API_BASE = 'http://127.0.0.1:3101';
        await expect(aiAPI('/ai-workspace')).rejects.toThrow(/backend/);
        expect(fake.api).not.toHaveBeenCalled();
    });

    it('does not bypass desktop auth when its preload is absent, and retries only later calls after bootstrap failure', async () => {
        const {fake} = installLegacy(); fake.API_BASE = window.API_BASE = 'http://localhost:3100'; window.__feDesktop = {platform: 'darwin'};
        await expect(aiAPI('/ai-workspace')).rejects.toThrow(/Reopen Film/); expect(fake.api).not.toHaveBeenCalled();
        delete window.__feDesktop;
        const error = Object.assign(Error('Untrusted origin'), {status: 403}); fake.api.mockRejectedValueOnce(error);
        await expect(aiAPI('/ai-workspace')).rejects.toBe(error);
        fake.api.mockImplementation(async path => path === '/ai-capability' ? {capability: token} : {ok: true});
        await expect(aiAPI('/ai-workspace')).resolves.toEqual({ok: true});
        expect(fake.api.mock.calls.map(c => c[0])).toEqual(['/ai-capability', '/ai-capability', '/ai-workspace']);
    });

    it('keeps old application API calls unchanged', async () => {
        const {fake} = installLegacy(); fake.api.mockResolvedValue({saved: true});
        const options = {method: 'POST', body: '{}'};
        expect(await aiAPI('/projects/p1/script', options)).toEqual({saved: true});
        expect(fake.api).toHaveBeenCalledWith('/projects/p1/script', options);
    });

    it('does not leak a resolved capability after Settings changes the API while setup is pending', async () => {
        const {fake} = installLegacy(); fake.API_BASE = window.API_BASE = 'http://localhost:3100';
        let finish; window.__filmAI = {getCapability: () => new Promise(resolve => {finish = resolve;})};
        const pending = aiAPI('/ai-workspace');
        fake.API_BASE = window.API_BASE = 'http://foreign.test:3100';
        finish({apiBase: 'http://localhost:3100', capability: token});
        await expect(pending).rejects.toThrow(/local Film/); expect(fake.api).not.toHaveBeenCalled();
    });
});
