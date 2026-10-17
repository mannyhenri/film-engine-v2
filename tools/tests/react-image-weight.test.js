// Every picture a React page or component paints asks the server for a size, or is named here with why
// it may not: the React half of the backend's image-weight.test.js. That test reads <img src="${…}">
// template strings in the assembled page, so each converted page leaves its scan (its "is not blind"
// floor is skipped in SKIPPED-SUBTESTS.json and held here). A plate is 668KB to 1.2MB; a card that paints
// one at 48px must not download it. Set-based over every src={…} in React source, read from the files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FILES = ['src/pages', 'src/components', 'src/lib'].flatMap(d => fs.readdirSync(path.join(ROOT, d), { recursive: true })
    .filter(f => /\.jsx?$/.test(f) && !f.includes('.test.')).map(f => path.join(d, f)));

/** Every src={…} on an <img>, or on a component that renders one (a capitalised tag), its expression balanced. */
function srcSites() {
    const out = [];
    for (const f of FILES) {
        const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
        for (const m of text.matchAll(/\bsrc=\{/g)) {
            // The element it belongs to: a <video>, <iframe> or <source> is not a picture and has no thumbnail.
            const tag = (/<([A-Za-z][\w.]*)[^<]*$/.exec(text.slice(Math.max(0, m.index - 400), m.index)) || [])[1] || '';
            if (tag !== 'img' && !/^[A-Z]/.test(tag)) continue;
            let depth = 1, i = m.index + m[0].length;
            for (; i < text.length && depth; i++) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; }
            let expr = text.slice(m.index + m[0].length, i - 1).trim();
            // A bare name is read from where the file defines it.
            if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
                const def = new RegExp(`(?:const|let)\\s+${expr}\\s*=([^;]*);`).exec(text);
                if (def) expr = `${expr} = ${def[1].trim()}`;
            }
            out.push({ file: f, line: text.slice(0, m.index).split('\n').length, expr });
        }
    }
    return out;
}

// A sized request: plateSrc/frameSrc take a width; ?w= asks the server for one; a sized helper of the file's own.
const SIZED = /plateSrc\(|frameSrc\(|[?&]w=|\bshotImg\(|thumbnail_path/;
/*
 * Sites that paint at full size on purpose, each with why (matched on file and expression, never on a
 * pattern alone, so the next site that gets it wrong is not excused by accident). A wrapper whose src is a
 * prop (`src = props`) is exempt because its CALLERS are sites too, and each is checked here.
 */
const EXEMPT = [
    { file: /UpscaleFrameDialog\.jsx$/, expr: /^preview = source\?\.data/, why: 'single upscale approval displays the immutable source bytes included in the authoritative review snapshot; resizing a mutable URL would conceal what is approved' },
    { file: /FinalRequestReview\.jsx$/, expr: /^previewOf\(ref\)$/, why: 'final provider review displays immutable reference bytes already included in its snapshot; a thumbnail of the current mutable file would not show the approved content' },
    { file: /StyleBookPage\.jsx$/, expr: /^src( =|$)|style-book\/media/, why: 'style-book media: an author-supplied reference, served whole by design' },
    { file: /MarketingPage\.jsx$/, expr: /marketingImgSrc\(/, why: 'posters are judged at full size' },
    { file: /Gallery\.jsx$/, expr: /^src = gallerySrc\(/, why: 'the gallery tile hands its own src to the full-size plate viewer' },
    { file: /ShotBoardPage\.jsx$/, expr: /^src$/, why: 'HideOnError / HideOnErrorOr render a src prop; their callers are checked' },
    { file: /studio\/DirectStudio\.jsx$/, expr: /^r\.uri$/, why: 'a draft reference is shown as the exact bytes the starter composed (a data URI already in memory); nothing is downloaded' },
    { file: /ReferenceCompare\.jsx$/, expr: /^src\(/, why: 'the drift comparison aligns the board and the reference pixel for pixel; a resized picture would misplace every landmark' },
];

test('the scan sees the React pictures (not blind)', () => {
    const sites = srcSites();
    assert.ok(sites.length >= 12, `found ${sites.length} src={…} sites in React source: the scan is not reading it`);
});

test('every React picture asks for a size, or is named with why it may not', () => {
    const offenders = srcSites().filter(s => !SIZED.test(s.expr) && !EXEMPT.some(e => e.file.test(s.file) && e.expr.test(s.expr)))
        .map(s => `${s.file}:${s.line}  src={${s.expr.replace(/\s+/g, ' ').slice(0, 90)}}`);
    assert.deepStrictEqual(offenders, [], 'these download a full-resolution picture to paint a card');
});

test('each exemption still matches a site (a stale one excuses nothing and hides that it is stale)', () => {
    const sites = srcSites();
    const stale = EXEMPT.filter(e => !sites.some(s => e.file.test(s.file) && e.expr.test(s.expr))).map(e => e.why);
    assert.deepStrictEqual(stale, []);
});
