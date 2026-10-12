import {legacy} from './legacy.js';

const capabilities = new Map(); // Ephemeral promises only; never app/browser storage.
const isAIPath = path => /^\/(?:ai-connections|ai-workspace)(?:\/|$)/.test(path)
    || /^\/projects\/[^/]+\/ai-workspace(?:\/|$)/.test(path);

function localAPIBase(value) {
    try {
        const url = new URL(value);
        if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
            && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) return url.origin;
    } catch {}
    throw Error('AI connections require the local Film backend.');
}

function capabilityFor(base) {
    if (!capabilities.has(base)) {
        const pending = (async () => {
            let data;
            if (window.__filmAI?.getCapability) {
                data = await window.__filmAI.getCapability();
                if (localAPIBase(data?.apiBase) !== base) throw Error('Film AI capability belongs to a different backend. Reopen Film.');
            } else {
                if (window.__feDesktop) throw Error('Reopen Film to activate its AI capability bridge.');
                // The backend issues this only for explicit trusted localhost dev origins.
                data = await legacy.api('/ai-capability', {refresh: false});
            }
            if (!/^[0-9a-f]{64}$/i.test(data?.capability || '')) throw Error('The updated Film AI capability backend is not active yet.');
            return data.capability;
        })().catch(error => {capabilities.delete(base); throw error;});
        capabilities.set(base, pending);
    }
    return capabilities.get(base);
}

/** Keep legacy.api's busy controls, error mapping and write-refresh behavior. */
export async function aiAPI(path, options = {}) {
    if (!isAIPath(path)) return legacy.api(path, options);
    const base = localAPIBase(legacy.API_BASE), capability = await capabilityFor(base);
    if (localAPIBase(legacy.API_BASE) !== base) throw Error('Film backend changed during AI setup. Reopen the AI workspace.');
    return legacy.api(path, {...options, headers: {'Content-Type': 'application/json', ...options.headers, 'X-Film-AI-Capability': capability}});
}
