/**
 * The parts of three film-engine screenplay sub-tests that still read correctly from the page source, kept here
 * because each original also reads something the React Screenplay page no longer has as text. Those originals are
 * skipped in SKIPPED-SUBTESTS.json, each pointing here and to where the rest is held. v2 only; declared in
 * tools/port-plan.json backendLocalChanges.
 *
 *   screenplay-focus.test.js "focus mode covers the page…": every assertion but the two that read
 *     onclick="toggleWriterFocus()" / onclick="toggleTypewriterSound()" out of the HTML. Those buttons are held by
 *     src/pages/screenplay/ScreenplayControls.test.jsx (each calls the same function with the same arguments).
 *   title-page-and-print.test.js "the title page is clickable on screen…": every assertion but the one that reads
 *     id="titlePageCard" … onclick="openTitlePageModal()". The card's click is held by ScreenplayControls.test.jsx.
 *   title-page-and-print.test.js "the printed script is a shooting script…": verbatim, except that the timing the
 *     marks read may be written legacy.SCRIPT_TIMING. SCRIPT_TIMING is a core `let` the Screenplay engine reads
 *     through the bridge (src/pages/screenplay/engine.js), the one rewrite tools/tests/engine-verbatim.test.js allows.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'index.html'), 'utf8');
const SPA = HTML;

// screenplay-focus.test.js's own helper, verbatim.
function fnSrc(name) {
    const i = HTML.indexOf(`function ${name}(`);
    assert.ok(i > 0, `${name} missing`);
    let j = HTML.indexOf(')', i); j = HTML.indexOf('{', j);
    for (let d = 0, k = j; k < HTML.length; k++) {
        if (HTML[k] === '{') d++;
        else if (HTML[k] === '}' && --d === 0) return HTML.slice(i, k + 1);
    }
    return '';
}

// title-page-and-print.test.js's own helper, verbatim.
/** A function's source, bounded by brace depth from its declaration. */
function fnSource(name) {
    const at = SPA.search(new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`));
    assert.ok(at >= 0, `${name} is not defined`);
    let i = SPA.indexOf('(', at), depth = 0;
    for (; i < SPA.length; i++) { if (SPA[i] === '(') depth++; else if (SPA[i] === ')' && --depth === 0) break; }
    i = SPA.indexOf('{', i);
    depth = 0;
    const start = at;
    for (; i < SPA.length; i++) {
        if (SPA[i] === '{') depth++;
        else if (SPA[i] === '}' && --depth === 0) return SPA.slice(start, i + 1);
    }
    throw new Error(`${name} never closes`);
}

test('focus mode covers the page, hides the chrome, and every way out ends it (all but the two button reads)', () => {
    assert.ok(/body\.sp-focus #editorViewContainer \{[^}]*position: fixed !important/.test(HTML),
        'the editor is not lifted over the page, or loses to the gutter\'s inline position');
    assert.ok(/body\.sp-focus \.fe-top, body\.sp-focus \.fe-panel, body\.sp-focus #statusBar \{ display: none !important; \}/.test(HTML),
        'the app\'s chrome is not hidden');
    const key = fnSrc('onEditorKeydown');
    assert.ok(/'Escape'[\s\S]*toggleWriterFocus\(false\)/.test(key), 'Esc does not leave focus');
    assert.ok(/shiftKey[\s\S]*'f'[\s\S]*toggleWriterFocus\(\)/.test(key), 'Ctrl+Shift+F does not toggle focus');
    assert.ok(/typewriterKey\(event\)/.test(key), 'the editor does not sound its keys');
    assert.ok(/fullscreenchange[\s\S]{0,200}toggleWriterFocus\(false\)/.test(HTML), 'leaving full screen leaves focus');
    assert.ok(/sp-focus[\s\S]{0,120}toggleWriterFocus\(false\)/.test(fnSrc('navigateTo')), 'another page keeps the chrome hidden');
});

test('the title page is clickable on screen, outside the editable page (all but the click read)', () => {
    const card = SPA.indexOf('id="titlePageCard"');
    const editor = SPA.indexOf('id="screenplayEditor"');
    assert.ok(card > 0 && card < editor, 'the card is not placed before the editor');
    assert.match(fnSource('normalizeEditor'), /renderTitlePageCard\(\)/, 'the card is not refreshed when the editor changes');
});

test('the printed script is a shooting script: scene numbers in both margins, eighths on the right', () => {
    const exp = fnSource('exportToPDF');
    assert.match(exp, /await loadScriptTiming\(\)/, 'the export does not read the numbers and eighths of the draft it prints');
    assert.match(exp, /paginateInto\(printable\);\s*shootingScriptMarks\(printable, (?:legacy\.)?SCRIPT_TIMING\);\s*toPrintSheets\(printable\);/);
    assert.ok(exp.indexOf("window.open('', '_blank')") < exp.indexOf('await loadScriptTiming'),
        'the print window is opened after an await, so the pop-up blocker refuses it');
    const marks = fnSource('shootingScriptMarks');
    assert.match(marks, /timingRowsForHeadings\(timing\)/, 'the marks do not use the shared heading rule');
    for (const cls of ['shoot-num-left', 'shoot-num-right', 'shoot-eighths']) {
        assert.match(marks, new RegExp(cls), `${cls} is never drawn`);
        assert.match(fnSource('generatePrintHTML'), new RegExp(`\\.${cls}`), `${cls} has no print style`);
    }
});
