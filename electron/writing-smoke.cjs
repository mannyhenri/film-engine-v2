// Exercised only by the existing isolated --smoke CLI, never against a live editor.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
module.exports = async function writingSmoke(win, js, project) {
    const output = process.env.FE_SMOKE_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'film-writing-smoke-'));
    fs.mkdirSync(output, {recursive: true});
    const wait = async (read, label) => {
        for (let i = 0; i < 100; i++) {
            const value = await read(); if (value) return value;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw Error('Writing smoke did not reach ' + label);
    };
    await js(`document.querySelector('[data-rail="askai"]').click(); true`);
    await wait(() => js(`!!document.querySelector('[role="dialog"][aria-label="Ask AI"] select') && !document.querySelector('[role="dialog"][aria-label="Ask AI"] [role="alert"]')`), 'authenticated Ask AI');
    fs.writeFileSync(path.join(output, 'ask-ai.png'), (await win.webContents.capturePage()).toPNG());
    await js(`document.querySelector('[role="dialog"][aria-label="Ask AI"] header button').click(); true`);
    await js(`toggleAIChat(); true`);
    await wait(() => js(`!!document.querySelector('[role="dialog"][aria-label="Film Engine AI workspace"] textarea') && !document.querySelector('[role="dialog"][aria-label="Film Engine AI workspace"] [role="alert"]')`), 'authenticated project writer');
    await js(`document.querySelector('[role="dialog"][aria-label="Film Engine AI workspace"] header button').click(); setViewMode('cards'); true`);
    await wait(() => js(`document.querySelectorAll('#indexCardsGrid .index-card').length`), 'scene cards');
    const before = await js(`api('/projects/${project}/script/cards')`);
    fs.writeFileSync(path.join(output, 'index-cards.png'), (await win.webContents.capturePage()).toPNG());
    let preview;
    const created = child => {preview = child;};
    win.webContents.once('did-create-window', created);
    try {
        await js(`printIndexCards(); true`);
        await wait(() => Promise.resolve(preview && !preview.isDestroyed()), 'card print window');
        await wait(() => preview.webContents.executeJavaScript(`document.documentElement.dataset.cardsReady === 'true'`), 'measured print layout');
        const layout = await preview.webContents.executeJavaScript(`({sheets:document.querySelectorAll('.sheet').length,slots:document.querySelectorAll('.card').length,overflow:[...document.querySelectorAll('.card')].filter(c=>c.scrollHeight>c.clientHeight+1).length,font:getComputedStyle(document.querySelector('.prose')).fontSize,maxSlots:Math.max(...[...document.querySelectorAll('.sheet')].map(s=>s.children.length))})`);
        if (layout.overflow || layout.maxSlots > 4 || layout.font !== '16px') throw Error('Scene-card print layout overflowed or reduced text size.');
        const pdf = await preview.webContents.printToPDF({printBackground: true, preferCSSPageSize: true});
        if (pdf.subarray(0, 5).toString() !== '%PDF-') throw Error('Scene-card PDF export failed.');
        fs.writeFileSync(path.join(output, 'from-the-mist-scene-cards.pdf'), pdf);
        fs.writeFileSync(path.join(output, 'print-preview.png'), (await preview.webContents.capturePage()).toPNG());
        const after = await js(`api('/projects/${project}/script/cards')`);
        if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Writing smoke changed screenplay card metadata.');
        const result = {project, version: before.version, script_hash: before.script_hash, cards: before.cards.length, missing: before.cards.filter(c=>!c.summary).length, stale: before.cards.filter(c=>c.stale).length, layout, no_metadata_change: true, provider_inference_submitted: false, output};
        fs.writeFileSync(path.join(output, 'writing-smoke.json'), JSON.stringify(result, null, 2) + '\n');
        return result;
    } finally {
        win.webContents.removeListener('did-create-window', created);
        if (preview && !preview.isDestroyed()) preview.close();
    }
};
