/**
 * Strings that are exactly a file's bytes, and what the filesystem said about that file.
 *
 * Measured on The Glass Harbour: opening Production spent ~1.5s per load in the staleness walk,
 * and almost none of it was the walk. An image payload inlines every reference plate as a data
 * URI (~6MB of JSON per keyframe, ~16MB per clip), and the fingerprint is the hash of that
 * payload, so each load re-encoded and re-hashed the same megabytes for every shot; the
 * generation revision beside it re-read and re-hashed every reference file once per shot.
 *
 * The hashes must not change (a different formula would mark every stamped artefact stale), so
 * this only remembers work. Every key is `path|size|mtimeMs`, never the path alone: plates are
 * overwritten in place, and a path-keyed cache would let a regenerated plate fingerprint as its
 * old self. Bounded, because a server runs for days.
 *
 * No requires beyond node's own: reference-images, capability-payloads, generation-revision and
 * artefact-fingerprint all read it, and it must never be the far end of a require cycle.
 */
const crypto = require('crypto');
const fs = require('fs');

function statKey(filePath) {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return null;
    return `${filePath}|${st.size}|${st.mtimeMs}`;
}

/** Bounded LRU, by entry count and (for strings) total length. */
function lru(maxEntries, maxChars = Infinity) {
    const m = new Map();
    let chars = 0;
    const len = v => (typeof v === 'string' ? v.length : 0);
    return {
        get(k) { const v = m.get(k); if (v !== undefined) { m.delete(k); m.set(k, v); } return v; },
        set(k, v) {
            if (m.has(k)) { chars -= len(m.get(k)); m.delete(k); }
            m.set(k, v); chars += len(v);
            while (m.size > maxEntries || chars > maxChars) {
                const [old, ov] = m.entries().next().value; m.delete(old); chars -= len(ov);
                if (typeof ov === 'string') FILE_OF.delete(ov);
            }
        },
        clear() { m.clear(); chars = 0; },
        get size() { return m.size; },
    };
}

/*
 * uri -> statKey, for every data URI a cache below (or reference-images' own) holds. A Map keyed by
 * string compares by value, but V8 keeps a string's hash on the string, and a cache hit hands back
 * the same instance, so looking one up again costs nothing.
 */
const FILE_OF = new Map();
const FILE_OF_MAX = 56;   // reference-images' 24 plates + the 32 below
function noteFileString(uri, key) {
    if (typeof uri !== 'string' || !key) return;
    FILE_OF.delete(uri);
    FILE_OF.set(uri, key);
    while (FILE_OF.size > FILE_OF_MAX) FILE_OF.delete(FILE_OF.keys().next().value);
}
/** The statKey a string was read from, or undefined when it is not (or no longer) a known file's bytes. */
function fileOfString(s) { return FILE_OF.get(s); }

const DATA_URIS = lru(32, 192 * 1024 * 1024);
/** `data:<mime>;base64,…` of a file, read once per version of the file. Throws as readFileSync does. */
function readDataUri(filePath, mime) {
    const key = statKey(filePath);
    const k = key && `${key}|${mime}`;
    const hit = k && DATA_URIS.get(k);
    if (hit !== undefined && hit !== null) return hit;
    const uri = `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
    if (k) { DATA_URIS.set(k, uri); noteFileString(uri, k); }
    return uri;
}

const DIGESTS = lru(4096);
/** sha256 hex of a file's bytes, read once per version of the file. Throws as readFileSync does. */
function fileSha256(filePath) {
    const key = statKey(filePath);
    const hit = key && DIGESTS.get(key);
    if (hit) return hit;
    const d = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    if (key) DIGESTS.set(key, d);
    return d;
}

/** Tests, and anything that needs a cold read. */
function clearFileStrings() { FILE_OF.clear(); DATA_URIS.clear(); DIGESTS.clear(); }

module.exports = { statKey, noteFileString, fileOfString, readDataUri, fileSha256, clearFileStrings };
