/** Lossless storage adaptation for large native exports: identical buffer views
 * share bytes. View/accessor/node/material IDs and all scene JSON are retained.
 * Never changes the existing asset-size ceiling or simplifies the geometry. */
const crypto = require('crypto');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function deduplicateBuffers(input) {
    const b = Buffer.from(input), chunks = [];
    if (b.length < 20 || b.toString('ascii', 0, 4) !== 'glTF' || b.readUInt32LE(4) !== 2) throw new Error('Not a binary glTF 2 scene');
    for (let offset = 12; offset + 8 <= b.length;) {
        const size = b.readUInt32LE(offset), type = b.readUInt32LE(offset + 4);
        if (offset + 8 + size > b.length) throw new Error('Truncated GLB');
        chunks.push({ type, bytes: b.subarray(offset + 8, offset + 8 + size) });
        offset += 8 + size;
    }
    const jsonChunk = chunks.find(c => c.type === 0x4e4f534a), binary = chunks.find(c => c.type === 0x004e4942);
    if (!jsonChunk || !binary || chunks.length !== 2) throw new Error('This large GLB needs a standard JSON and BIN export');
    const g = JSON.parse(jsonChunk.bytes.toString('utf8').replace(/[\s\0]+$/, ''));
    if (g.buffers?.length !== 1 || g.buffers[0].uri || (g.bufferViews || []).some(v => v.extensions)) throw new Error('Large compressed or external-buffer GLBs need a plain native export');
    const pieces = [], reused = new Map(); let size = 0;
    for (const v of g.bufferViews || []) {
        const start = v.byteOffset || 0, end = start + v.byteLength;
        if (v.buffer !== 0 || start < 0 || end > binary.bytes.length) throw new Error('Invalid GLB buffer view');
        const bytes = binary.bytes.subarray(start, end), key = sha(bytes);
        let offset = reused.get(key);
        if (offset == null) {
            offset = size; pieces.push(bytes); size += bytes.length;
            if (size % 4) { const padding = Buffer.alloc(4 - size % 4); pieces.push(padding); size += padding.length; }
            reused.set(key, offset);
        }
        v.byteOffset = offset;
    }
    g.buffers[0].byteLength = size;
    let json = Buffer.from(JSON.stringify(g));
    if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - json.length % 4, 0x20)]);
    const bin = Buffer.concat(pieces), header = Buffer.alloc(12), jc = Buffer.alloc(8), bc = Buffer.alloc(8);
    header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + bin.length, 8);
    jc.writeUInt32LE(json.length); jc.writeUInt32LE(0x4e4f534a, 4);
    bc.writeUInt32LE(bin.length); bc.writeUInt32LE(0x004e4942, 4);
    const bytes = Buffer.concat([header, jc, json, bc, bin]);
    return { bytes, evidence: { method: 'lossless-identical-buffer-sharing', original_sha256: sha(b), stored_sha256: sha(bytes), original_bytes: b.length, stored_bytes: bytes.length } };
}
module.exports = { deduplicateBuffers };
