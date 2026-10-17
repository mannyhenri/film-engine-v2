'use strict';
/**
 * ONE QUESTION TO THE DIRECTOR'S CONNECTED AI.
 *
 * Film Engine's inference runs on the account the director signed in under AI connections (Claude Code or Codex,
 * their own subscription), the one Ask AI uses. The project's API providers (Anthropic, OpenAI language) are blocked
 * behind the final request review, so a feature that asks them gets "Exact final request review is not supported"
 * and never an answer.
 *
 * This asks once, through the dedicated isolated runner (lib/ai-cli-runner.js: no tools, no shell, no resumed
 * session, read-only, the director's own CLI sign-in): Claude first, else Codex, whichever is connected. Text in,
 * text out; nothing is saved here.
 */
const { createCLIRunner } = require('./ai-cli-runner');

let runner = null;
const PREFERRED = ['claude', 'codex'];

/** The runner in use; tests pass one in, null restores the real one. */
function useRunner(r) { runner = r || null; }
function current() { return runner || (runner = createCLIRunner()); }

/**
 * @returns {Promise<{ok: true, answer: string, provider: string} | {ok: false, error: string}>}
 */
async function askConnectedAI(question, { timeoutMs = 180000 } = {}) {
    const r = current();
    let list;
    try { list = await r.providersAsync(); } catch (err) { return { ok: false, error: `could not check AI connections: ${err.message}` }; }
    const provider = PREFERRED.find(id => (list || []).some(p => p.id === id && p.available));
    if (!provider) return { ok: false, error: 'no AI account is connected: sign in to Claude or Codex under Setup → AI connections' };
    return new Promise(resolve => {
        let done = false, handle = null;
        const finish = (out) => { if (!done) { done = true; clearTimeout(timer); resolve(out); } };
        const timer = setTimeout(() => { if (handle) handle.cancel(); finish({ ok: false, error: `${provider} did not answer within ${Math.round(timeoutMs / 1000)}s` }); }, timeoutMs);
        if (timer.unref) timer.unref();
        try {
            handle = r.start({ provider, payload: String(question) }, {
                event() {}, partial() {},
                complete: (text) => finish({ ok: true, answer: String(text || ''), provider }),
                error: (e) => finish({ ok: false, error: String(e || `${provider} failed`) }),
                cancelled: () => finish({ ok: false, error: `${provider} was cancelled` }),
                closed() {},
            });
        } catch (err) { finish({ ok: false, error: err.message }); }
    });
}

module.exports = { askConnectedAI, useRunner };
