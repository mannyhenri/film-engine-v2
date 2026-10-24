'use strict';
/**
 * SECRETS THAT MUST NOT SIT IN THE DATABASE.
 *
 * Provider keys live in film_provider_credentials as plain text, which is a
 * SQLite file anyone with the disk can read. A signed-in account (an OAuth
 * access and refresh token) is worth more than a key -- it is the person's
 * whole Higgsfield login, plan credits included -- so it goes to the macOS
 * Keychain instead, under one generic-password item per provider.
 *
 * The secret travels on the `security` tool's STDIN (`security -i`), never on
 * its argv, where any process on the machine could read it from `ps`. It is
 * base64 on the way in so the interactive parser never sees a quote.
 *
 * Elsewhere (Linux, Windows, or a test run) it falls back to memory for tests
 * and to the database row for a real install off macOS, and says which it
 * used, so a caller never believes a secret is protected when it is not.
 */
const { spawnSync } = require('child_process');

const SERVICE = 'Film Engine';
const memory = new Map();

function backend() {
    const forced = process.env.FILM_SECRET_STORE;
    if (forced === 'memory' || forced === 'keychain' || forced === 'database') return forced;
    // A test run must never write the real login keychain.
    if (process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test') return 'memory';
    return process.platform === 'darwin' ? 'keychain' : 'database';
}

const account = id => `provider:${String(id)}`;

function keychainGet(id) {
    const r = spawnSync('security', ['find-generic-password', '-s', SERVICE, '-a', account(id), '-w'], { encoding: 'utf8' });
    if (r.status !== 0) return null;          // 44: no such item
    try { return JSON.parse(Buffer.from(String(r.stdout).trim(), 'base64').toString('utf8')); } catch (_) { return null; }
}

function keychainSet(id, value) {
    const b64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
    const r = spawnSync('security', ['-i'], {
        input: `add-generic-password -U -s "${SERVICE}" -a "${account(id)}" -w ${b64}\n`, encoding: 'utf8',
    });
    if (r.status !== 0 || /error|could not/i.test(String(r.stderr || ''))) {
        throw new Error(`Could not save to the macOS Keychain: ${String(r.stderr || '').trim() || 'security exited ' + r.status}`);
    }
}

function keychainDelete(id) {
    spawnSync('security', ['delete-generic-password', '-s', SERVICE, '-a', account(id)], { encoding: 'utf8' });
}

/* The database fallback: one row per provider, its secrets in their own JSON column-free row. */
const db = () => require('../db/database').db;
const dbKey = id => `__secret__:${id}`;
function databaseGet(id) {
    const row = db().prepare('SELECT meta FROM film_provider_credentials WHERE provider = ?').get(dbKey(id));
    try { return row ? JSON.parse(row.meta || 'null') : null; } catch (_) { return null; }
}
function databaseSet(id, value) {
    db().prepare(`INSERT INTO film_provider_credentials (provider, api_key, meta, updated_at) VALUES (?, '', ?, datetime('now'))
        ON CONFLICT(provider) DO UPDATE SET meta = excluded.meta, updated_at = datetime('now')`).run(dbKey(id), JSON.stringify(value));
}
function databaseDelete(id) { db().prepare('DELETE FROM film_provider_credentials WHERE provider = ?').run(dbKey(id)); }

/** The stored secret object for a provider, or null. */
function get(id) {
    const b = backend();
    if (b === 'memory') return memory.has(id) ? JSON.parse(JSON.stringify(memory.get(id))) : null;
    return b === 'keychain' ? keychainGet(id) : databaseGet(id);
}

/** Replace the stored secret object. Throws when the store refuses, so a token is never thought saved when it was not. */
function set(id, value) {
    const b = backend();
    if (b === 'memory') memory.set(id, JSON.parse(JSON.stringify(value)));
    else if (b === 'keychain') keychainSet(id, value);
    else databaseSet(id, value);
    return { stored_in: b };
}

/** Merge fields into the stored secret object. */
function merge(id, fields) { return set(id, { ...(get(id) || {}), ...fields }); }

function remove(id) {
    const b = backend();
    if (b === 'memory') memory.delete(id);
    else if (b === 'keychain') keychainDelete(id);
    else databaseDelete(id);
}

/** Where secrets go on this install, said in words for a settings screen. */
function where() {
    return { memory: 'memory (test run)', keychain: 'the macOS Keychain', database: 'the Film Engine database (no system keychain on this platform)' }[backend()];
}

module.exports = { get, set, merge, remove, where, backend, SERVICE };
