/**
 * Plain-text extraction from .docx, with no third-party dependency.
 *
 * A .docx is a ZIP archive whose `word/document.xml` holds the prose. Node has
 * zlib but no ZIP reader, so this parses the archive structure directly. That
 * is a deliberate trade: the project runs on exactly one dependency
 * (better-sqlite3), and pulling in a document-conversion library to read one
 * XML file out of a zip would be the largest dependency in the tree.
 *
 * Scope is prose, which is all the screenplay converter needs. Images and
 * comments are ignored rather than mangled; the main document, footnotes,
 * endnotes, headers, and footers are read. Tracked-change deletions are dropped
 * so text the author removed does not silently reappear in the screenplay.
 */

const zlib = require('zlib');

// ZIP signatures, little-endian.
const SIG_EOCD = 0x06054b50;       // end of central directory
const SIG_CENTRAL = 0x02014b50;    // central directory file header
const SIG_LOCAL = 0x04034b50;      // local file header

const DOCUMENT_PATH = 'word/document.xml';
const EXTRA_TEXT_PART_RE = /^word\/(?:footnotes|endnotes|header\d+|footer\d+)\.xml$/;

// A .docx that inflates far beyond this is either corrupt or hostile; refuse
// rather than let a small upload expand until the process dies.
const MAX_INFLATED_BYTES = 80 * 1024 * 1024;

/**
 * Locate the end-of-central-directory record.
 * It sits at the end of the file but may be followed by a variable-length
 * comment, so scan backwards for the signature.
 */
function findEndOfCentralDirectory(buf) {
    const minPos = Math.max(0, buf.length - 22 - 0xffff);
    for (let i = buf.length - 22; i >= minPos; i--) {
        if (buf.readUInt32LE(i) === SIG_EOCD) return i;
    }
    return -1;
}

/**
 * Walk the central directory and return the local-header offset for `name`.
 * Reading the central directory rather than scanning for local headers means
 * filenames appearing inside compressed data cannot produce a false match.
 */
function findEntryOffset(buf, name) {
    const eocd = findEndOfCentralDirectory(buf);
    if (eocd < 0) return -1;

    const entryCount = buf.readUInt16LE(eocd + 10);
    let pos = buf.readUInt32LE(eocd + 16);

    for (let i = 0; i < entryCount; i++) {
        if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== SIG_CENTRAL) return -1;
        const nameLen = buf.readUInt16LE(pos + 28);
        const extraLen = buf.readUInt16LE(pos + 30);
        const commentLen = buf.readUInt16LE(pos + 32);
        const localOffset = buf.readUInt32LE(pos + 42);
        const entryName = buf.toString('utf8', pos + 46, pos + 46 + nameLen);

        if (entryName === name) return localOffset;
        pos += 46 + nameLen + extraLen + commentLen;
    }
    return -1;
}

function listEntryOffsets(buf, predicate) {
    const eocd = findEndOfCentralDirectory(buf);
    if (eocd < 0) return [];

    const entryCount = buf.readUInt16LE(eocd + 10);
    let pos = buf.readUInt32LE(eocd + 16);
    const entries = [];

    for (let i = 0; i < entryCount; i++) {
        if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== SIG_CENTRAL) return entries;
        const nameLen = buf.readUInt16LE(pos + 28);
        const extraLen = buf.readUInt16LE(pos + 30);
        const commentLen = buf.readUInt16LE(pos + 32);
        const localOffset = buf.readUInt32LE(pos + 42);
        const entryName = buf.toString('utf8', pos + 46, pos + 46 + nameLen);

        if (predicate(entryName)) entries.push({ name: entryName, offset: localOffset });
        pos += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

/** Read and decompress one entry, given its local-header offset. */
function readEntry(buf, localOffset, remainingInflatedBytes) {
    if (localOffset < 0 || localOffset + 30 > buf.length) return null;
    if (buf.readUInt32LE(localOffset) !== SIG_LOCAL) return null;

    const method = buf.readUInt16LE(localOffset + 8);
    let compressedSize = buf.readUInt32LE(localOffset + 18);
    const nameLen = buf.readUInt16LE(localOffset + 26);
    const extraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + nameLen + extraLen;

    // Streamed entries write sizes to a trailing descriptor, leaving the local
    // header zeroed. Inflate to the end of the buffer and let zlib stop at the
    // stream's own terminator.
    const dataEnd = compressedSize > 0
        ? Math.min(dataStart + compressedSize, buf.length)
        : buf.length;
    const data = buf.subarray(dataStart, dataEnd);

    const bounded = remainingInflatedBytes !== undefined;
    const inflatedLimit = bounded
        ? Math.min(MAX_INFLATED_BYTES, remainingInflatedBytes)
        : MAX_INFLATED_BYTES;
    const limitError = () => new Error('DOCX inflated content exceeds the bounded extraction limit.');

    if (method === 0) {
        if (bounded && data.length > inflatedLimit) throw limitError();
        return data;                                    // stored
    }
    if (method !== 8) return null;                       // only deflate is used by .docx
    if (bounded && inflatedLimit <= 0) throw limitError();

    try {
        return zlib.inflateRawSync(data, { maxOutputLength: inflatedLimit });
    } catch (error) {
        // A bounded supplemental part must fail the extraction rather than be
        // silently skipped and reported as a complete document.
        if (bounded && error.code === 'ERR_BUFFER_TOO_LARGE') throw limitError();
        return null;
    }
}

/** Decode the five XML predefined entities plus numeric references. */
function decodeEntities(text) {
    return text
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');   // last, so &amp;lt; yields &lt; not <
}

function safeCodePoint(code) {
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
    try { return String.fromCodePoint(code); } catch (_) { return ''; }
}

/**
 * Convert WordprocessingML to plain text.
 *
 * Paragraphs become newlines, which is what matters here: the screenplay
 * converter reads prose paragraph by paragraph, so losing those boundaries
 * would turn a scene into one unbroken block.
 */
function xmlToText(xml, maxTextCharacters) {
    let s = String(xml);

    // Drop tracked-change deletions before extracting runs, so removed text
    // does not come back. <w:delText> lives inside <w:del>.
    s = s.replace(/<w:del\b[\s\S]*?<\/w:del>/g, '');

    // Structural whitespace.
    s = s.replace(/<w:br\b[^>]*\/?>/g, '\n');
    s = s.replace(/<w:tab\b[^>]*\/?>/g, '\t');
    s = s.replace(/<w:cr\b[^>]*\/?>/g, '\n');
    // Paragraph and table-row ends. Self-closing <w:p/> counts too — Word uses
    // it for an empty paragraph, which is a deliberate blank line in prose and
    // the main way an author separates paragraphs.
    s = s.replace(/<w:p\b[^>]*\/>/g, '\n');
    s = s.replace(/<\/w:p>/g, '\n');
    s = s.replace(/<\/w:tr>/g, '\n');
    // Table cells read better separated than run together.
    s = s.replace(/<\/w:tc>/g, '\t');

    // Keep only the text runs, then drop every remaining tag.
    const pieces = [];
    let characters = 0;
    const runRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|(\n|\t)/g;
    let m;
    while ((m = runRe.exec(s)) !== null) {
        const piece = m[1] !== undefined ? m[1] : m[2];
        characters += piece.length;
        // Limit the text runs before joining them. This also bounds the
        // intermediate entity-encoded text before whitespace normalization.
        if (maxTextCharacters !== undefined && characters > maxTextCharacters) {
            throw new Error('DOCX text exceeds the bounded extraction limit.');
        }
        pieces.push(piece);
    }

    let text = decodeEntities(pieces.join(''));

    // Word emits a lot of empty paragraphs; collapse runs of blank lines to a
    // single blank so paragraph breaks survive but padding does not.
    text = text.replace(/\r\n?/g, '\n')
        .split('\n')
        .map(line => line.replace(/[ \t]+$/g, ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return text;
}

/**
 * Extract plain text from a .docx buffer.
 * Optional limits bound aggregate inflated XML bytes and text materialized
 * during member extraction. Without limits, existing converter behavior is
 * retained. Text limits include intermediate entity-encoded runs/whitespace.
 * @returns {{ ok: boolean, text?: string, error?: string, paragraphs?: number, characters?: number }}
 */
function extractDocxText(buffer, { maxInflatedBytes, maxTextCharacters } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return { ok: false, error: 'Empty or unreadable file.' };
    }
    // Every .docx begins with a local file header. Catch .doc and renamed files
    // here, where the message can be useful, rather than failing deep in the zip.
    if (buffer.readUInt32LE(0) !== SIG_LOCAL) {
        return {
            ok: false,
            error: 'This is not a .docx file. Older .doc files are a different format — open it in Word and use Save As to create a .docx, or save as plain text.',
        };
    }

    const entries = listEntryOffsets(buffer, name => name === DOCUMENT_PATH || EXTRA_TEXT_PART_RE.test(name));
    entries.sort((a, b) => {
        if (a.name === DOCUMENT_PATH) return -1;
        if (b.name === DOCUMENT_PATH) return 1;
        return a.name.localeCompare(b.name);
    });

    if (!entries.some(e => e.name === DOCUMENT_PATH)) {
        return { ok: false, error: 'No document body found inside the .docx (word/document.xml is missing).' };
    }

    const pieces = [];
    const filesRead = [];
    let inflatedBytes = 0;
    let textCharacters = 0;
    for (const entry of entries) {
        let xml, text;
        try {
            xml = readEntry(buffer, entry.offset, maxInflatedBytes === undefined
                ? undefined : maxInflatedBytes - inflatedBytes);
            if (xml) {
                inflatedBytes += xml.length;
                text = xmlToText(xml.toString('utf8'), maxTextCharacters === undefined
                    ? undefined : maxTextCharacters - textCharacters - (pieces.length ? 2 : 0));
            }
        } catch (error) {
            return { ok: false, error: error.message };
        }
        if (!xml) {
            if (entry.name === DOCUMENT_PATH) {
                return { ok: false, error: 'The document body could not be decompressed. The file may be corrupt or password-protected.' };
            }
            continue;
        }
        if (text) {
            textCharacters += text.length + (pieces.length ? 2 : 0);
            pieces.push(text);
            filesRead.push(entry.name);
        }
    }

    const text = pieces.join('\n\n').trim();
    if (!text) {
        return { ok: false, error: 'The document contains no readable text. Images and text boxes are not extracted.' };
    }

    return {
        ok: true,
        text,
        paragraphs: text.split(/\n\s*\n/).filter(Boolean).length,
        characters: text.length,
        files_read: filesRead,
    };
}

module.exports = {    extractDocxText,
    // Exported for tests.
    xmlToText,
    decodeEntities,
    findEntryOffset,};
