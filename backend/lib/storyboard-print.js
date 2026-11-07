'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { selectedFrame } = require('./selected-frame');
const { orderBySql } = require('./running-order');
const { imagePixels } = require('./asset-pixel-dimensions');
const { printCopyFor } = require('./thumbnails');

const PT = 72;
const PAPERS = { letter: { css: 'letter', name: 'Letter', width_in: 11, height_in: 8.5 }, a4: { css: 'A4', name: 'A4', width_in: 297 / 25.4, height_in: 210 / 25.4 } };
const MARGIN_IN = 0.4;
// Pictures print at this resolution: an original larger than that at its printed size is embedded as a copy at it.
const PRINT_DPI = 300;
/*
 * Boards per landscape page. Four is a 2 × 2 grid with the picture above its
 * notes; two are full-width rows with the picture on the left, as large as
 * the row allows, and the notes beside it.
 */
const LAYOUTS = { 4: { cols: 2, rows: 2, picture: 'above' }, 2: { cols: 1, rows: 2, picture: 'left' } };
// Every size the printed page uses, in points. The line budget below is computed
// from these, so a board's notes are known to fit before the page is drawn.
const SIZE = { head: 24, foot: 12, gap: 10, gutter: 14, meta: 18, line: 10.5, font: 8.5, label: 44, min_lines: 4, picture_share: 0.64, slack: 2 };

/** Where everything sits on one page, for one paper, layout and frame aspect. */
function geometry(paper, perPage, aspect) {
    const p = PAPERS[paper], L = LAYOUTS[perPage];
    const page = { width_pt: (p.width_in - 2 * MARGIN_IN) * PT, height_pt: (p.height_in - 2 * MARGIN_IN) * PT - SIZE.slack };
    const content = page.height_pt - SIZE.head - SIZE.foot - 2 * SIZE.gap;
    const board = { width_pt: (page.width_pt - (L.cols - 1) * SIZE.gutter) / L.cols, height_pt: (content - (L.rows - 1) * SIZE.gutter) / L.rows };
    let image_box, text_width, text_top;
    if (L.picture === 'above') {
        // The picture spans the board; it gives up height (letterboxed) only so at least a few lines of notes fit under it.
        const room = board.height_pt - SIZE.meta - SIZE.gap / 2 - SIZE.min_lines * SIZE.line;
        image_box = { width_pt: board.width_pt, height_pt: Math.min(board.width_pt / aspect, room) };
        text_width = board.width_pt; text_top = SIZE.meta + image_box.height_pt + SIZE.gap / 2;
    } else {
        // The picture fills the row's height unless that would leave the notes too narrow.
        const width = Math.min(board.height_pt * aspect, board.width_pt * SIZE.picture_share);
        image_box = { width_pt: width, height_pt: board.height_pt };
        text_width = board.width_pt - width - SIZE.gutter; text_top = SIZE.meta;
    }
    const fit = Math.min(image_box.width_pt / aspect, image_box.height_pt);
    const image = { width_pt: fit * aspect, height_pt: fit };
    const normal_lines = Math.floor((board.height_pt - text_top) / SIZE.line + 1e-9);
    const continuation_lines = Math.floor((board.height_pt - SIZE.meta) / SIZE.line + 1e-9);
    // Monospace advance is 0.6em; one unit is kept back so a rounding in the font never wraps a line the plan counted as one.
    const line_width_units = Math.floor((text_width - SIZE.label) / (SIZE.font * 0.6)) - 1;
    return { paper, per_page: perPage, aspect, page, head_pt: SIZE.head, foot_pt: SIZE.foot, gap_pt: SIZE.gap, gutter_pt: SIZE.gutter,
        content_pt: content, cols: L.cols, rows: L.rows, picture: L.picture, board, image_box, image, text_width_pt: text_width,
        text_top_pt: text_top, continuation_top_pt: SIZE.meta, label_pt: SIZE.label, line_pt: SIZE.line, font_pt: SIZE.font,
        normal_lines, continuation_lines, line_width_units };
}

/** The frame shape most of the selected pictures share (16:9 when none is known), so most boards print without bars. */
function dominantAspect(shots) {
    const counts = new Map();
    for (const shot of shots) {
        const px = shot.image && shot.image.status === 'ready' && shot.image.pixels;
        if (!px || !(px.width > 0) || !(px.height > 0)) continue;
        // Grouped to the nearest 0.05 so 1916 × 821 and 1915 × 821 count as one shape; the group's own first ratio is used.
        const ratio = px.width / px.height, key = Math.round(ratio * 20);
        const group = counts.get(key) || { ratio, n: 0 }; group.n++; counts.set(key, group);
    }
    let best = 16 / 9, n = 0;
    for (const group of counts.values()) if (group.n > n) { best = group.ratio; n = group.n; }
    return Math.min(3, Math.max(0.5, best));
}
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
        const image = { ...identity, status: 'ready', mime_type: mime, data_uri: `data:${mime};base64,${bytes.toString('base64')}`,
            pixels: imagePixels(asset.file_path), byte_length: bytes.length,
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'), note: 'Selected original bytes' };
        return Object.defineProperty(image, 'file_path', { value: asset.file_path, enumerable: false });
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
    // One line of camera rather than a line per setting: "shot type: wide · movement: static".
    const cameraText = Object.entries(camera).filter(([, value]) => present(value))
        .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${textOf(value)}`).join(' · ');
    if (cameraText) fields.push({ key: 'camera', label: 'Camera', text: cameraText });
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

function linesOf(fields, LINE_WIDTH_UNITS) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const lines = [];
    for (const field of fields) {
        const graphemes = Array.from(segmenter.segment(field.text), part => part.segment);
        let begin = 0, start = 0, first = true, wrapped = false;
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
                // A wrap that fell just before a space leaves it leading the next line; it is shown without it (the text keeps it).
                display_text: (wrapped ? chunk.replace(/^ (?=\S)/, '') : chunk).replace(/[\r\n]+$/, '').replace(/\t/g, '    ') });
            start += chunk.length; begin = end; first = false; wrapped = !hardBreak;
        }
    }
    return lines;
}

function makePagePlan(shots, g) {
    const { per_page: perPage, normal_lines: NORMAL_LINES, continuation_lines: CONTINUATION_LINES } = g;
    const panels = [], pages = [], overflow = [];
    for (let i = 0; i < shots.length; i += perPage) {
        const page = { number: pages.length + 1, kind: 'shots', panel_ids: [] };
        for (const [slot, shot] of shots.slice(i, i + perPage).entries()) {
            const states = [shot.metadata_status === 'unreadable' && 'Shot metadata unreadable',
                !shot.camera_recorded && 'Camera not recorded', !shot.description_recorded && 'Description not recorded'].filter(Boolean);
            const lines = linesOf([...states.map((text, n) => ({ key: `state.${n}`, label: 'Status', text })), ...shot.fields], g.line_width_units), id = `shot:${shot.shot_id}`;
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
    for (let i = 0; i < overflow.length; i += perPage) {
        const page = { number: pages.length + 1, kind: 'continuations', panel_ids: [] };
        for (const panel of overflow.slice(i, i + perPage)) {
            panels.push(panel); page.panel_ids.push(panel.id);
            const normal = panels.find(p => p.id === `shot:${panel.shot_id}`);
            if (!normal.continues_on_pages.includes(page.number)) normal.continues_on_pages.push(page.number);
        }
        pages.push(page);
    }
    return { panels, pages, continuation_count: overflow.length };
}

const pt = n => `${n.toFixed(2)}pt`;

function notesHtml(lines) {
    return `<div class="notes">${lines.map(line => `<div class="line${line.label ? ' first' : ''}"><span class="label">${esc(line.label)}</span><span class="value">${esc(line.display_text) || '&#160;'}</span></div>`).join('')}</div>`;
}

function panelHtml(panel) {
    if (panel.kind === 'continuation') return `<article class="board continuation">
        <div class="board-text"><header class="meta"><span class="no">${esc(panel.shot_number)}</span><span class="sc">SC ${esc(panel.scene_number)}</span><span class="more">Notes continued ${panel.continuation_index}/${panel.continuation_total} · from page ${panel.source_page}</span></header>${notesHtml(panel.lines)}</div></article>`;
    const image = panel.image;
    const picture = image.status === 'ready' ? `<img src="${image.data_uri}" alt="Shot ${esc(panel.shot_number)}">`
        : `<div class="missing">${esc(image.note)}${image.version != null ? `<small>Selected v${esc(image.version)}</small>` : ''}</div>`;
    // Carried in the header row, so a board whose notes continue is no taller than one whose notes do not.
    const tail = [panel.continues_on_pages.length ? `Notes continue on page ${panel.continues_on_pages.join(', ')}` : '',
        image.status === 'ready' && image.version != null ? `v${esc(image.version)}` : ''].filter(Boolean).join(' · ');
    return `<article class="board"><header class="meta"><span class="no">${esc(panel.shot_number)}</span><span class="sc">SC ${esc(panel.scene_number)}</span>${tail ? `<span class="more">${tail}</span>` : ''}</header>
        <div class="frame">${picture}</div><div class="board-text">${notesHtml(panel.lines)}</div></article>`;
}

function printableHtml(plan) {
    const g = plan.geometry, paper = PAPERS[plan.paper], byId = new Map(plan.panels.map(p => [p.id, p]));
    const pages = plan.pages.length ? plan.pages : [{ number: 1, kind: 'empty', panel_ids: [] }];
    const left = g.picture === 'left';
    // The rows-with-picture-left layout puts the shot number over the notes, beside the picture.
    const boardCss = left
        ? `.board { display: grid; grid-template-columns: ${pt(g.image_box.width_pt)} minmax(0, 1fr); column-gap: ${SIZE.gutter}pt; grid-template-rows: ${SIZE.meta}pt minmax(0, 1fr); }
.board > .frame { grid-column: 1; grid-row: 1 / span 2; height: ${pt(g.image_box.height_pt)}; }
.board > .meta { grid-column: 2; grid-row: 1; } .board > .board-text { grid-column: 2; grid-row: 2; }
.board.continuation { grid-template-columns: ${pt(g.image_box.width_pt)} minmax(0, 1fr); } .board.continuation > .board-text { grid-column: 2; grid-row: 1 / span 2; }`
        : `.board { display: flex; flex-direction: column; } .board > .frame { height: ${pt(g.image_box.height_pt)}; margin-bottom: ${SIZE.gap / 2}pt; }`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fe-storyboard-print" content="${esc(plan.project_id)}:${plan.paper}:${plan.per_page}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><title>${esc(plan.title)} — Storyboard</title><style>
@page { size: ${paper.css} landscape; margin: ${MARGIN_IN}in; }
* { box-sizing: border-box; } html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #15171a; background: #d9dbdf; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; }
.print-page { width: ${pt(g.page.width_pt)}; height: ${pt(g.page.height_pt)}; margin: 24px auto; background: white; display: flex; flex-direction: column; gap: ${SIZE.gap}pt; break-after: page; box-shadow: 0 0 0 ${MARGIN_IN}in white, 0 2px 24px rgba(0,0,0,.25); }
.page-head { height: ${SIZE.head}pt; flex: none; display: flex; align-items: flex-end; justify-content: space-between; gap: 16pt; border-bottom: 1.25pt solid #15171a; padding-bottom: 5pt; }
.page-head h1 { margin: 0; font-size: 13pt; font-weight: 700; letter-spacing: -.01em; white-space: nowrap; overflow-wrap: anywhere; }
.page-head .doc { font-size: 7pt; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; white-space: nowrap; }
.page-head .doc span { color: #8a9099; font-weight: 400; }
.grid { height: ${pt(g.content_pt)}; flex: none; display: grid; grid-template-columns: repeat(${g.cols}, ${pt(g.board.width_pt)}); grid-template-rows: repeat(${g.rows}, ${pt(g.board.height_pt)}); gap: ${SIZE.gutter}pt; }
.board { min-width: 0; height: ${pt(g.board.height_pt)}; break-inside: avoid; }
${boardCss}
.meta { height: ${SIZE.meta}pt; display: flex; align-items: baseline; gap: 7pt; }
.meta .no { font-size: 13pt; font-weight: 700; letter-spacing: -.01em; line-height: 1; }
.meta .sc { font-size: 7pt; font-weight: 700; letter-spacing: .14em; color: #5d636b; }
.meta .more { margin-left: auto; font-size: 6.5pt; letter-spacing: .06em; color: #8a9099; white-space: nowrap; }
.frame { flex: none; width: ${pt(g.image_box.width_pt)}; display: flex; align-items: ${left ? 'flex-start' : 'center'}; justify-content: center; background: ${left ? 'transparent' : '#f1f2f4'}; }
.frame img { display: block; width: ${pt(g.image.width_pt)}; height: ${pt(g.image.height_pt)}; max-width: 100%; max-height: 100%; object-fit: contain; background: #15171a; }
.missing { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4pt; border: .75pt dashed #a3a9b1; color: #5d636b; font-size: 8pt; text-align: center; padding: 8pt; }
.missing small { font-size: 6.5pt; color: #8a9099; }
.board-text { min-width: 0; }
.notes { font-size: ${SIZE.font}pt; line-height: ${SIZE.line}pt; }
.line { display: grid; grid-template-columns: ${SIZE.label}pt minmax(0, 1fr); height: ${SIZE.line}pt; }
.label { font-size: 6pt; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #8a9099; line-height: ${SIZE.line}pt; }
.value { font-family: 'Courier Prime', 'Courier New', Courier, monospace; white-space: pre; }
.page-foot { height: ${SIZE.foot}pt; flex: none; display: flex; justify-content: space-between; align-items: flex-end; font-size: 6.5pt; letter-spacing: .06em; color: #8a9099; }
.empty { margin: auto; color: #5d636b; font-size: 10pt; }
@media print { body { background: white; } .print-page { margin: 0; box-shadow: none; } .print-page:last-child { break-after: auto; } }
</style></head><body>${pages.map(page => `<section class="print-page"><header class="page-head"><h1>${esc(plan.title)}</h1><span class="doc">Storyboard${page.kind === 'continuations' ? ' <span>· notes continued</span>' : ''}</span></header>
${page.kind === 'empty' ? '<p class="empty">No shots in narrative order.</p>' : `<div class="grid">${page.panel_ids.map(id => panelHtml(byId.get(id))).join('')}</div>`}
<footer class="page-foot"><span>${paper.name} landscape · ${plan.per_page} per page · Narrative order · Selected originals</span><span>${page.number} / ${pages.length}</span></footer></section>`).join('')}</body></html>`;
}

/** A print plan and its page from shots already read — the layout without the database. */
/*
 * The selected original, or a JPEG copy of it no larger than the board prints
 * at PRINT_DPI when that copy is smaller, so a 4K project's print is megabytes
 * rather than hundreds. The original's identity (asset, version, bytes, sha256,
 * pixels) stays on record either way; no encoder means the original is used.
 */
function printImage(image, g) {
    if (image.status !== 'ready') return image;
    const edge = Math.ceil(Math.max(g.image_box.width_pt, g.image_box.height_pt) / PT * PRINT_DPI / 100) * 100;
    const long = image.pixels ? Math.max(image.pixels.width, image.pixels.height) : null;
    // Never enlarged; a frame already within the print size is re-encoded at its own size. Either way the copy is used only if it is smaller.
    const copy = printCopyFor(image.file_path, edge), bytes = copy && fs.readFileSync(copy);
    if (!bytes || bytes.length >= image.byte_length) return image;
    return { ...image, data_uri: `data:image/jpeg;base64,${bytes.toString('base64')}`, note: `Selected original at ${PRINT_DPI} dpi`,
        print: { mime_type: 'image/jpeg', long_edge_px: long ? Math.min(long, edge) : null, byte_length: bytes.length } };
}

function renderPlan(project, shots, { paper = 'letter', perPage = 4 } = {}) {
    const aspect = dominantAspect(shots), g = geometry(paper, perPage, aspect);
    shots = shots.map(shot => ({ ...shot, image: printImage(shot.image, g) }));
    const plan = { project_id: project.id ?? project.project_id, title: project.title, paper, per_page: perPage, orientation: 'landscape',
        page_size: { width_in: PAPERS[paper].width_in, height_in: PAPERS[paper].height_in, margin_in: MARGIN_IN },
        frame_aspect: aspect, line_width_units: g.line_width_units, geometry: g,
        shot_count: shots.length, ...makePagePlan(shots, g),
        shots: shots.map(({ image, ...shot }) => ({ ...shot, image: { ...image, data_uri: undefined } })) };
    // The pictures travel once, inside the page; the panels keep each one's record without its bytes.
    const html = printableHtml(plan);
    return { ...plan, panels: plan.panels.map(panel => panel.image?.data_uri ? { ...panel, image: { ...panel.image, data_uri: undefined } } : panel), html };
}

function buildStoryboardPrint(db, projectId, { paper = 'letter', perPage = 4 } = {}) {
    if (!Object.hasOwn(PAPERS, paper)) throw Object.assign(Error('Paper must be letter or a4'), { status: 400 });
    perPage = Number(perPage);
    if (!Object.hasOwn(LAYOUTS, perPage)) throw Object.assign(Error('Boards per page must be 2 or 4'), { status: 400 });
    const project = db.prepare('SELECT id,title FROM film_projects WHERE id=?').get(projectId);
    if (!project) return null;
    const rows = db.prepare(`SELECT sh.*, sc.scene_number, sc.description AS scene_description FROM film_shots sh
        JOIN film_scenes sc ON sc.id=sh.scene_id WHERE sc.project_id=? AND sc.status != 'removed'
        ORDER BY ${orderBySql({ shots: 'sh', scenes: 'sc' })}`).all(projectId);
    const shots = rows.map(shot => ({ shot_id: shot.id, shot_number: shot.shot_code, scene_number: shot.scene_number,
        ...shotFields(shot), image: originalImage(db, shot) }));
    return renderPlan(project, shots, { paper, perPage });
}

module.exports = { buildStoryboardPrint, renderPlan, geometry, PAPERS, LAYOUTS, PRINT_DPI };
