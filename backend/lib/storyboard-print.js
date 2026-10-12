'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { selectedFrame } = require('./selected-frame');
const { orderBySql } = require('./running-order');
const { imagePixels } = require('./asset-pixel-dimensions');

const PAPERS = { letter: { css: 'letter', width_in: 11, height_in: 8.5 }, a4: { css: 'A4', width_in: 297 / 25.4, height_in: 210 / 25.4 } };
const NORMAL_LINES = 6, CONTINUATION_LINES = 17, LINE_WIDTH_UNITS = 24;
const WIDE_GRAPHEME = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u200D\u20E3\u1100-\u115F\u2329\u232A\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF01-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]/u;
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const textOf = value => typeof value === 'string' ? value : JSON.stringify(value);
const present = value => value !== null && value !== undefined && value !== '';

function mimeOf(bytes) {
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
    if (/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}

function originalImage(db, shot) {
    const asset = selectedFrame(db, shot.id);
    const identity = { asset_id: asset?.id || null, version: asset?.version ?? shot.current_frame_version ?? null,
        file_name: asset?.file_name || null, status: 'selection_missing', data_uri: null, pixels: null,
        byte_length: null, sha256: null };
    if (!asset) return { ...identity, note: shot.current_frame_version == null ? 'No selected original recorded' : 'Selected version has no original asset' };
    try {
        if (!asset.file_path || !fs.statSync(asset.file_path).isFile()) throw Error('not a regular file');
        const bytes = fs.readFileSync(asset.file_path), mime = mimeOf(bytes);
        if (!mime) return { ...identity, status: 'unsupported', note: 'Selected original is not a supported raster image' };
        return { ...identity, status: 'ready', mime_type: mime, data_uri: `data:${mime};base64,${bytes.toString('base64')}`,
            pixels: imagePixels(asset.file_path), byte_length: bytes.length,
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'), note: 'Selected original bytes' };
    } catch (_) { return { ...identity, status: 'offline', note: 'Selected original unavailable' }; }
}

function shotFields(shot) {
    let card, metadata_status = 'recorded';
    try {
        card = JSON.parse(shot.scene_card_yaml || '{}');
        if (!card || typeof card !== 'object' || Array.isArray(card)) throw Error('invalid card');
    } catch (_) { card = {}; metadata_status = 'unreadable'; }
    const fields = [], camera = card.camera && typeof card.camera === 'object' && !Array.isArray(card.camera) ? card.camera : {};
    // These are the current authored card fields. They are not claimed to be
    // historical generation settings or guessed from the selected picture.
    for (const [key, value] of Object.entries(camera)) {
        if (present(value)) fields.push({ key: `camera.${key}`, label: 'Camera', text: `${key.replace(/_/g, ' ')}: ${textOf(value)}` });
    }
    const description = card.action || card.description || shot.scene_description || '';
    if (present(description)) fields.push({ key: 'description', label: 'Action', text: textOf(description) });
    const dialogue = Array.isArray(card.dialogue) ? card.dialogue : present(card.dialogue) ? [card.dialogue] : [];
    dialogue.forEach((line, index) => {
        if (!present(line)) return;
        let text;
        if (typeof line === 'string') text = line;
        else if (line && typeof line === 'object') {
            const speaker = line.character || line.speaker || line.name || '';
            const spoken = line.text ?? line.line ?? line.dialogue;
            text = spoken === undefined ? textOf(line) : `${speaker ? textOf(speaker) + ': ' : ''}${textOf(spoken)}`;
            // Keep direction/parenthetical or other recorded dialogue fields.
            const extras = Object.fromEntries(Object.entries(line).filter(([key]) => !['character', 'speaker', 'name', 'text', 'line', 'dialogue'].includes(key)));
            if (Object.keys(extras).length) text += '\n' + JSON.stringify(extras);
        } else text = textOf(line);
        if (text !== '') fields.push({ key: `dialogue.${index}`, label: 'Dialogue', text });
    });
    if (metadata_status === 'unreadable') fields.push({ key: 'metadata', label: 'Metadata', text: shot.scene_card_yaml || '' });
    return { fields, metadata_status, camera_recorded: Object.keys(camera).some(key => present(camera[key])), description_recorded: present(description) };
}

function linesOf(fields) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const lines = [];
    for (const field of fields) {
        const graphemes = Array.from(segmenter.segment(field.text), part => part.segment);
        let begin = 0, start = 0, first = true;
        while (begin < graphemes.length) {
            let end = begin, width = 0, boundary = -1, boundaryWidth = 0, hardBreak = false;
            while (end < graphemes.length) {
                const segment = graphemes[end];
                if (/[\r\n]/.test(segment)) { end++; hardBreak = true; break; }
                const unit = segment === '\t' ? 4 : WIDE_GRAPHEME.test(segment) ? 2 : 1;
                if (width + unit > LINE_WIDTH_UNITS) break;
                width += unit; end++;
                if (/\s/u.test(segment)) { boundary = end; boundaryWidth = width; }
            }
            // Keep the whitespace in its original chunk. Only a token longer
            // than the available width needs to split within the token.
            if (end < graphemes.length && !hardBreak && boundary > begin && !/\s/u.test(graphemes[end])) {
                end = boundary; width = boundaryWidth;
            }
            const chunk = graphemes.slice(begin, end).join('');
            lines.push({ field: field.key, label: first ? field.label : '', text: chunk, start, end: start + chunk.length, width_units: width,
                display_text: chunk.replace(/[\r\n]+$/, '').replace(/\t/g, '    ') });
            start += chunk.length; begin = end; first = false;
        }
    }
    return lines;
}

function makePagePlan(shots) {
    const panels = [], pages = [], overflow = [];
    for (let i = 0; i < shots.length; i += 4) {
        const page = { number: pages.length + 1, kind: 'shots', panel_ids: [] };
        for (const [slot, shot] of shots.slice(i, i + 4).entries()) {
            const states = [shot.metadata_status === 'unreadable' && 'Shot metadata unreadable',
                !shot.camera_recorded && 'Camera not recorded', !shot.description_recorded && 'Description not recorded'].filter(Boolean);
            const lines = linesOf([...states.map((text, n) => ({ key: `state.${n}`, label: 'Status', text })), ...shot.fields]), id = `shot:${shot.shot_id}`;
            const panel = { id, kind: 'shot', shot_id: shot.shot_id, shot_number: shot.shot_number,
                scene_number: shot.scene_number, source_page: page.number, source_slot: slot + 1,
                image: shot.image, metadata_status: shot.metadata_status, camera_recorded: shot.camera_recorded,
                description_recorded: shot.description_recorded, lines: lines.slice(0, NORMAL_LINES), continues_on_pages: [] };
            panels.push(panel); page.panel_ids.push(id);
            const rest = lines.slice(NORMAL_LINES), total = Math.ceil(rest.length / CONTINUATION_LINES);
            for (let n = 0; n < total; n++) {
                const continued = rest.slice(n * CONTINUATION_LINES, (n + 1) * CONTINUATION_LINES).map(line => ({ ...line }));
                if (!continued[0].label) continued[0].label = shot.fields.find(field => field.key === continued[0].field)?.label || 'Status';
                overflow.push({ id: `${id}:continuation:${n + 1}`, kind: 'continuation',
                    shot_id: shot.shot_id, shot_number: shot.shot_number, scene_number: shot.scene_number,
                    source_page: page.number, source_slot: slot + 1, continuation_index: n + 1, continuation_total: total, lines: continued });
            }
        }
        pages.push(page);
    }
    for (let i = 0; i < overflow.length; i += 4) {
        const page = { number: pages.length + 1, kind: 'continuations', panel_ids: [] };
        for (const panel of overflow.slice(i, i + 4)) {
            panels.push(panel); page.panel_ids.push(panel.id);
            const normal = panels.find(p => p.id === `shot:${panel.shot_id}`);
            if (!normal.continues_on_pages.includes(page.number)) normal.continues_on_pages.push(page.number);
        }
        pages.push(page);
    }
    return { panels, pages, continuation_count: overflow.length };
}

function panelHtml(panel) {
    const text = panel.lines.map(line => `<div class="text-line"><span class="field-label">${esc(line.label)}</span><span class="line-value">${esc(line.display_text) || '&#160;'}</span></div>`).join('');
    if (panel.kind === 'continuation') return `<article class="print-panel continuation"><header><strong>SHOT ${esc(panel.shot_number)}</strong><span>CONTINUED ${panel.continuation_index}/${panel.continuation_total}</span></header>
        <p class="source-link">From page ${panel.source_page}, panel ${panel.source_slot} · Scene ${esc(panel.scene_number)}</p><div class="panel-text">${text}</div></article>`;
    const image = panel.image, caption = image.status === 'ready'
        ? `Selected original · v${image.version}${image.pixels ? ` · ${image.pixels.width} × ${image.pixels.height} px` : ' · dimensions unrecorded'}` : image.note;
    const imageHtml = image.status === 'ready' ? `<img src="${image.data_uri}" alt="Selected original for shot ${esc(panel.shot_number)}">`
        : `<div class="missing-image">${esc(image.note)}${image.version != null ? `<small>Selected v${esc(image.version)}</small>` : ''}</div>`;
    return `<article class="print-panel"><header><strong>SHOT ${esc(panel.shot_number)}</strong><span>SCENE ${esc(panel.scene_number)}</span></header>
        <div class="image-box">${imageHtml}</div><p class="image-caption">${esc(caption)}</p>
        <div class="panel-text">${text}</div>
        ${panel.continues_on_pages.length ? `<p class="source-link">Text continues on page ${panel.continues_on_pages.join(', ')}</p>` : ''}</article>`;
}

function printableHtml(plan) {
    const paper = PAPERS[plan.paper], byId = new Map(plan.panels.map(p => [p.id, p]));
    const pages = plan.pages.length ? plan.pages : [{ number: 1, kind: 'empty', panel_ids: [] }];
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fe-storyboard-print" content="${esc(plan.project_id)}:${plan.paper}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><title>${esc(plan.title)} — Storyboard</title><style>
@page { size: ${paper.css} landscape; margin: 0.4in; }
* { box-sizing: border-box; } body { margin: 0; color: #192330; background: #e6e8ec; font-family: Arial, sans-serif; }
.print-page { width: ${paper.width_in - 0.8}in; min-height: ${paper.height_in - 0.8}in; margin: 18px auto; padding: 0; background: white; break-after: page; }
.page-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16pt; min-height: 28pt; border-bottom: 1pt solid #192330; padding: 0 0 6pt; }
.brand { font-size: 8pt; font-weight: bold; letter-spacing: 1pt; white-space: nowrap; } h1 { margin: 0; font-size: 12pt; font-weight: 600; overflow-wrap: anywhere; }
.page-subtitle { margin: 5pt 0 9pt; font-size: 7.5pt; color: #566372; }
.panel-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(226pt, auto)); gap: 10pt; }
.print-panel { border: .6pt solid #a9b1bc; padding: 8pt; min-width: 0; min-height: 226pt; break-inside: avoid; }
.print-panel header { display: flex; justify-content: space-between; gap: 10pt; min-height: 18pt; font-size: 9pt; overflow-wrap: anywhere; }
.print-panel header span { font-size: 7pt; color: #566372; }
.image-box { height: 88pt; background: #f4f5f7; display: flex; align-items: center; justify-content: center; }
.image-box img { width: 100%; height: 100%; object-fit: contain; }.missing-image { padding: 12pt; font-size: 9pt; color: #647080; text-align: center; }.missing-image small { display: block; margin-top: 5pt; }
.image-caption, .source-link { margin: 4pt 0; font-size: 7pt; line-height: 9pt; overflow-wrap: anywhere; }.image-caption { color: #566372; }
.panel-text { margin-top: 4pt; }.text-line { display: grid; grid-template-columns: 43pt minmax(0, 1fr); gap: 4pt; min-height: 10pt; }
.field-label { font-family: Arial, sans-serif; font-size: 7pt; font-weight: 600; line-height: 10pt; }.line-value { font-family: 'DejaVu Sans Mono', 'Noto Sans Mono', monospace; font-size: 8.25pt; line-height: 10pt; white-space: pre-wrap; overflow-wrap: anywhere; }
.continuation .source-link { margin: 0 0 8pt; }.continuation .panel-text { margin-top: 0; }.source-link { color: #4d4374; }
.page-footer { margin-top: 8pt; display: flex; justify-content: space-between; gap: 12pt; color: #647080; font-size: 7pt; }.empty { padding: 80pt 10pt; text-align: center; }
@media print { body { background: white; } .print-page { margin: 0; } .print-page:last-child { break-after: auto; } }
</style></head><body>${pages.map(page => `<section class="print-page"><div class="page-heading"><h1>${esc(plan.title)}</h1><span class="brand">FILM ENGINE / STORYBOARD</span></div>
<p class="page-subtitle">Selected original images · Current shot cards · Narrative order${page.kind === 'continuations' ? ' · Text continuations' : ''}</p>
${page.kind === 'empty' ? '<p class="empty">No shots in narrative order.</p>' : `<div class="panel-grid">${page.panel_ids.map(id => panelHtml(byId.get(id))).join('')}</div>`}
<footer class="page-footer"><span>${plan.paper === 'letter' ? 'Letter' : 'A4'} landscape · Print at 100% or fit to printable area</span><span>Page ${page.number} of ${pages.length}</span></footer></section>`).join('')}</body></html>`;
}

function buildStoryboardPrint(db, projectId, { paper = 'letter' } = {}) {
    if (!Object.hasOwn(PAPERS, paper)) throw Object.assign(Error('Paper must be letter or a4'), { status: 400 });
    const project = db.prepare('SELECT id,title FROM film_projects WHERE id=?').get(projectId);
    if (!project) return null;
    const rows = db.prepare(`SELECT sh.*, sc.scene_number, sc.description AS scene_description FROM film_shots sh
        JOIN film_scenes sc ON sc.id=sh.scene_id WHERE sc.project_id=? AND sc.status != 'removed'
        ORDER BY ${orderBySql({ shots: 'sh', scenes: 'sc' })}`).all(projectId);
    const shots = rows.map(shot => ({ shot_id: shot.id, shot_number: shot.shot_code, scene_number: shot.scene_number,
        ...shotFields(shot), image: originalImage(db, shot) }));
    const plan = { project_id: project.id, title: project.title, paper, orientation: 'landscape',
        page_size: { width_in: PAPERS[paper].width_in, height_in: PAPERS[paper].height_in, margin_in: 0.4 },
        shot_count: shots.length, ...makePagePlan(shots),
        shots: shots.map(({ image, ...shot }) => ({ ...shot, image: { ...image, data_uri: undefined } })) };
    return { ...plan, html: printableHtml(plan) };
}

module.exports = { buildStoryboardPrint };
