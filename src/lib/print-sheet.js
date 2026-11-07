/*
 * The printed character, location and prop sheets.
 *
 * One renderer for all three so they read as one set of production documents,
 * and the same visual language as the printed storyboard: a project/document
 * band, the subject's name, the canonical picture large, its other views in a
 * strip, then the written description beside a column of facts.
 *
 * Pure: every builder takes plain data and returns a page, so the layout can be
 * checked in a real browser (tools/print-layout-check.cjs) without the app.
 * Nothing is cut short to fit — long text flows onto the next page.
 */

export const SHEET_KINDS = Object.freeze(['character', 'location', 'prop']);

const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const has = v => v !== null && v !== undefined && String(v).trim() !== '';
const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

const CSS = `
@page { size: portrait; margin: 18mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #15171a; background: #fff; font: 9.5pt/1.5 'Helvetica Neue', Helvetica, Arial, sans-serif; }
.sheet { max-width: 180mm; margin: 0 auto; }
.band { display: flex; justify-content: space-between; align-items: baseline; gap: 12pt; padding-bottom: 5pt; border-bottom: 1.25pt solid #15171a; }
.band .project { font-size: 8pt; font-weight: 700; letter-spacing: .02em; overflow-wrap: anywhere; }
.band .doc { font-size: 7pt; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; white-space: nowrap; }
.title { margin: 12pt 0 12pt; }
.title h1 { margin: 0; font-size: 26pt; line-height: 1.05; font-weight: 700; letter-spacing: -.015em; overflow-wrap: anywhere; }
.title .meta { margin-top: 5pt; display: flex; flex-wrap: wrap; gap: 4pt 6pt; }
.title .meta span { font-size: 7pt; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #5d636b; border: .75pt solid #c9cdd2; border-radius: 2pt; padding: 1.5pt 5pt; }
.hero { margin: 0; break-inside: avoid; }
.hero .frame { display: flex; justify-content: center; }
.hero img { display: block; max-width: 100%; max-height: 110mm; object-fit: contain; }
.hero .blank { height: 60mm; }
.blank { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; border: .75pt dashed #a3a9b1; color: #8a9099; font-size: 8pt; text-align: center; padding: 6pt; }
figcaption { margin-top: 3pt; font-size: 6.5pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #5d636b; overflow-wrap: anywhere; }
figcaption small { display: block; font-weight: 400; letter-spacing: 0; text-transform: none; font-size: 7pt; color: #8a9099; }
.strip { display: grid; gap: 6pt; margin-top: 8pt; }
.strip figure, .gallery figure { margin: 0; min-width: 0; break-inside: avoid; }
.strip .frame, .gallery .frame { display: flex; align-items: center; justify-content: center; overflow: hidden; }
.gallery.cover .frame { background: #f1f2f4; }
.strip img, .gallery img { display: block; width: 100%; height: 100%; object-fit: contain; }
.gallery.cover img { object-fit: cover; }
.body { display: grid; grid-template-columns: minmax(0, 1.75fr) minmax(0, 1fr); gap: 0 16pt; margin-top: 14pt; }
section { break-inside: auto; }
h2 { margin: 12pt 0 5pt; padding-bottom: 3pt; border-bottom: .5pt solid #c9cdd2; font-size: 7pt; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: #5d636b; break-after: avoid; }
.body > div > section:first-child h2 { margin-top: 0; }
.prose p { margin: 0 0 6pt; font-family: Georgia, 'Times New Roman', serif; font-size: 10pt; line-height: 1.5; overflow-wrap: anywhere; }
.prose h3 { margin: 8pt 0 2pt; font-size: 7.5pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; break-after: avoid; }
.facts { margin: 0; }
.facts div { display: grid; grid-template-columns: 36% minmax(0, 1fr); gap: 6pt; padding: 3pt 0; border-bottom: .5pt solid #e3e5e8; break-inside: avoid; }
.facts dt { font-size: 6.5pt; font-weight: 700; letter-spacing: .06em; overflow-wrap: anywhere; text-transform: uppercase; color: #8a9099; padding-top: 1.5pt; }
.facts dd { margin: 0; font-size: 9pt; overflow-wrap: anywhere; }
.list { margin: 0; padding: 0; list-style: none; }
.list li { padding: 3pt 0 3pt 10pt; border-bottom: .5pt solid #e3e5e8; position: relative; font-size: 9pt; overflow-wrap: anywhere; break-inside: avoid; }
.list li::before { content: ''; position: absolute; left: 0; top: 8pt; width: 4pt; height: 4pt; background: #15171a; }
.list li small { color: #8a9099; }
.swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(26mm, 1fr)); gap: 6pt; }
.swatch { break-inside: avoid; min-width: 0; }
.swatch i { display: block; height: 11mm; border: .5pt solid rgba(0,0,0,.18); border-radius: 1.5pt; }
.swatch span { display: block; margin-top: 2pt; font-size: 7.5pt; overflow-wrap: anywhere; }
.swatch small { display: block; font-size: 6.5pt; color: #8a9099; font-family: Menlo, 'Courier New', monospace; }
.chips { display: flex; flex-wrap: wrap; gap: 4pt; }
.chips span { font-size: 8pt; border: .75pt solid #c9cdd2; border-radius: 8pt; padding: 1pt 6pt; overflow-wrap: anywhere; }
.compass { display: grid; grid-template-columns: 1fr 1.2fr 1fr; grid-template-rows: auto auto auto; gap: 3pt; font-size: 7.5pt; break-inside: avoid; }
.compass > div { min-width: 0; padding: 2pt; overflow-wrap: anywhere; font-size: 7pt; line-height: 1.35; }
.compass b { display: block; font-size: 6.5pt; letter-spacing: .14em; text-transform: uppercase; color: #8a9099; }
.compass .n { grid-column: 2; grid-row: 1; text-align: center; } .compass .s { grid-column: 2; grid-row: 3; text-align: center; }
.compass .w { grid-column: 1; grid-row: 2; } .compass .e { grid-column: 3; grid-row: 2; text-align: right; }
.compass .room { grid-column: 2; grid-row: 2; border: 1pt solid #15171a; min-height: 22mm; display: flex; flex-direction: column; justify-content: center; gap: 2pt; text-align: center; }
.plan { break-inside: avoid; }
.plan-image { display: block; max-width: 100%; max-height: 48mm; margin: 0 auto 6pt; }
.marker { margin: 4pt 0 0; font-size: 8pt; color: #5d636b; }
.galleries section { margin-top: 4pt; }
.gallery { display: grid; gap: 6pt; }
.muted { color: #8a9099; font-size: 8.5pt; margin: 0; }
.foot { margin-top: 14pt; padding-top: 4pt; border-top: .5pt solid #c9cdd2; display: flex; justify-content: space-between; font-size: 6.5pt; letter-spacing: .06em; color: #8a9099; break-inside: avoid; }
@media screen { body { background: #d9dbdf; } .sheet { background: #fff; padding: 14mm; margin: 16px auto; max-width: 210mm; box-shadow: 0 2px 24px rgba(0,0,0,.25); } }
`;

const img = (src, alt) => has(src) ? `<img src="${esc(src)}" alt="${esc(alt || '')}">` : '';
const caption = (label, note) => has(label) || has(note) ? `<figcaption>${esc(label)}${has(note) ? `<small>${esc(note)}</small>` : ''}</figcaption>` : '';

function tiles(items, { columns, ratio, cover }) {
    return `<div class="${cover ? 'gallery cover' : 'gallery'}" style="grid-template-columns: repeat(${columns}, minmax(0, 1fr));">${items.map(it =>
        `<figure><div class="frame" style="aspect-ratio: ${ratio};">${img(it.src, it.label) || `<div class="blank">${esc(it.empty || 'Not made yet')}</div>`}</div>${caption(it.label, it.note)}</figure>`).join('')}</div>`;
}

/* One block of the body. Each kind decides only what goes in; this decides how it looks. */
function block(b) {
    if (!b) return '';
    let inner = '';
    if (b.paragraphs) {
        const ps = b.paragraphs.filter(p => has(p.text));
        inner = ps.length ? `<div class="prose">${ps.map(p => `${has(p.heading) ? `<h3>${esc(p.heading)}</h3>` : ''}${String(p.text).trim().split(/\n{2,}/).map(t => `<p>${esc(t).replace(/\n/g, '<br>')}</p>`).join('')}`).join('')}</div>` : '';
    } else if (b.facts) {
        const rows = b.facts.filter(([, v]) => has(v));
        inner = rows.length ? `<dl class="facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : '';
    } else if (b.list) {
        const items = b.list.filter(i => has(typeof i === 'string' ? i : i.text));
        inner = items.length ? `<ul class="list">${items.map(i => typeof i === 'string' ? `<li>${esc(i)}</li>`
            : `<li>${esc(i.text)}${has(i.note) ? ` <small>· ${esc(i.note)}</small>` : ''}</li>`).join('')}</ul>` : '';
    } else if (b.swatches) {
        const sw = b.swatches.filter(s => has(s.name) || HEX.test(String(s.hex || '')));
        inner = sw.length ? `<div class="swatches">${sw.map(s => `<div class="swatch"><i style="background:${HEX.test(String(s.hex || '')) ? s.hex : 'transparent'}"></i><span>${esc(s.name || '')}</span>${has(s.note) || has(s.hex) ? `<small>${esc([s.note, s.hex].filter(has).join(' · '))}</small>` : ''}</div>`).join('')}</div>` : '';
    } else if (b.chips) {
        const c = b.chips.filter(has);
        inner = c.length ? `<div class="chips">${c.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : '';
    } else if (b.html) inner = b.html;
    if (!inner) {
        if (!has(b.empty)) return '';
        inner = `<p class="muted">${esc(b.empty)}</p>`;
    }
    return `<section><h2>${esc(b.title)}</h2>${inner}</section>`;
}

/**
 * The page. `doc` = { kind, project, name, meta[], hero {src,label,note,empty}, strip {columns, ratio, items[]},
 * main[], side[], galleries[{title, columns, ratio, cover, items[]}], date }.
 */
export function sheetHtml(doc) {
    const date = doc.date || new Date().toISOString().slice(0, 10);
    const hero = doc.hero ? `<figure class="hero"><div class="frame">${img(doc.hero.src, doc.hero.label) || `<div class="blank">${esc(doc.hero.empty || 'No picture yet')}</div>`}</div>${caption(doc.hero.label, doc.hero.note)}</figure>` : '';
    const strip = doc.strip && doc.strip.items.length ? `<div class="strip" style="grid-template-columns: repeat(${doc.strip.columns}, minmax(0, 1fr));">${doc.strip.items.map(it =>
        `<figure><div class="frame" style="aspect-ratio: ${doc.strip.ratio};">${img(it.src, it.label) || `<div class="blank">${esc(it.empty || 'Not made yet')}</div>`}</div>${caption(it.label, it.note)}</figure>`).join('')}</div>` : '';
    const main = (doc.main || []).map(block).join(''), side = (doc.side || []).map(block).join('');
    const galleries = (doc.galleries || []).filter(g => g.items.length).map(g => `<section><h2>${esc(g.title)}</h2>${tiles(g.items, g)}</section>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fe-print-sheet" content="${esc(doc.kind)}">
<title>${esc(doc.name || doc.kind)} — ${esc(doc.kind)} sheet</title><style>${CSS}</style></head><body>
<main class="sheet">
<header class="band"><span class="project">${esc(doc.project || '')}</span><span class="doc">${esc(doc.kind)} sheet</span></header>
<div class="title"><h1>${esc(doc.name || 'Untitled')}</h1>${(doc.meta || []).filter(has).length ? `<div class="meta">${doc.meta.filter(has).map(m => `<span>${esc(m)}</span>`).join('')}</div>` : ''}</div>
${hero}${strip}
${main || side ? `<div class="body"><div>${main}</div><div>${side}</div></div>` : ''}
${galleries ? `<div class="galleries">${galleries}</div>` : ''}
<footer class="foot"><span>${esc(doc.project || 'Film Engine')} · ${esc(doc.kind)} sheet · ${esc(doc.name || '')}</span><span>Film Engine · ${esc(date)}</span></footer>
</main></body></html>`;
}

/* ── the three kinds ─────────────────────────────────────────────────────── */

/**
 * c: the character row; main/variations from /characters/:id/sheet; wardrobe and references from the gallery.
 * Pictures arrive with `src` already resolved by the caller (the app's image URLs).
 */
export function characterDoc({ project, character: c = {}, main, variations = [], palette = [], wardrobe = [], references = [], date }) {
    return {
        kind: 'Character', project, date, name: c.name || 'Character',
        meta: [c.age_range, c.gender, c.height_m ? `${c.height_m} m` : '', c.build],
        hero: { src: main && main.src, label: main ? `Main picture · ${main.kind || 'sheet'}` : '', note: main ? 'Used for every generation' : '', empty: 'No main picture yet' },
        strip: { columns: Math.min(6, Math.max(4, variations.length)), ratio: '1 / 1', items: variations.map(v => ({ src: v.src, label: v.kind || 'Variation' })) },
        main: [
            { title: 'Description', empty: 'No description yet.', paragraphs: [{ heading: has(c.appearance_prompt) ? 'Appearance' : '', text: c.appearance_prompt }, { heading: has(c.appearance_prompt) && has(c.description) ? 'From the screenplay' : '', text: c.description }] },
            { title: 'Personality', paragraphs: [{ text: c.personality_notes }] },
        ],
        side: [
            { title: 'Physical spec', facts: [['Age', c.age_range], ['Gender', c.gender], ['Height', c.height_m ? `${c.height_m} m` : ''], ['Build', c.build], ['Hair', c.hair], ['Distinguishing', c.distinguishing]] },
            { title: 'Palette', swatches: palette.map(p => ({ name: p.name, hex: p.hex })) },
        ],
        galleries: [
            { title: 'Wardrobe & props', columns: 6, ratio: '3 / 4', cover: true, items: wardrobe.map(w => ({ src: w.src, label: w.note || 'Item' })) },
            { title: 'Concept art & references', columns: 6, ratio: '4 / 3', cover: true, items: references.map(r => ({ src: r.src, label: r.note || '' })) },
        ],
    };
}

/** l: the location row (description sections already parsed); slots: the plate plan with each slot's picture. */
export function locationDoc({ project, location: l = {}, sections = [], slots = [], plan = {}, planImage, scenes = [], flags = [], references = [], date }) {
    const [first, ...rest] = slots;
    const compass = plan && (has(plan.north) || has(plan.south) || has(plan.east) || has(plan.west) || (plan.interior || []).some(has) || has(planImage));
    const room = (plan.interior || []).filter(has);
    return {
        kind: 'Location', project, date, name: l.name || 'Location',
        meta: [l.location_type, l.time_of_day_default, `Used in ${Number(l.scene_count) || scenes.length || 0} scene${(Number(l.scene_count) || scenes.length) === 1 ? '' : 's'}`, slots.length ? `Plates ${slots.filter(s => has(s.src)).length}/${slots.length}` : ''],
        hero: first ? { src: first.src, label: first.label, note: first.note, empty: 'No master plate yet' } : null,
        strip: { columns: Math.max(3, rest.length), ratio: '16 / 9', items: rest.map(s => ({ src: s.src, label: s.label, note: s.note })) },
        main: [
            { title: 'Set description', empty: 'No description yet.', paragraphs: sections.length ? sections.map(s => ({ heading: s.label, text: s.text })) : [{ text: l.description }] },
            { title: 'Atmosphere', paragraphs: [{ text: l.atmosphere_notes }] },
            { title: 'Sound', paragraphs: [{ text: l.sound_notes }] },
        ],
        side: [
            { title: 'Lighting', facts: [['Default', l.lighting_default], ['Technique', l.lighting_technique], ['Key side', l.lighting_key_side], ['Time of day', l.time_of_day_default], ['Type', l.location_type]] },
            { title: 'Continuity', list: flags, empty: 'Nothing to hold yet.' },
            compass ? { title: 'Orientation plan', html: `<div class="plan">${has(planImage) ? `<img class="plan-image" src="${esc(planImage)}" alt="Orientation plan">` : ''}<div class="compass">
                <div class="n"><b>North</b>${esc(plan.north || '—')}</div><div class="w"><b>West</b>${esc(plan.west || '—')}</div>
                <div class="room">${room.length ? room.map(r => `<span>${esc(r)}</span>`).join('') : '<span class="muted">Interior not planned</span>'}</div>
                <div class="e"><b>East</b>${esc(plan.east || '—')}</div><div class="s"><b>South</b>${esc(plan.south || '—')}</div></div>${has(plan.marker) ? `<p class="marker">&#9650; ${esc(plan.marker)}</p>` : ''}</div>` } : null,
            { title: 'Scenes here', list: scenes.map(s => ({ text: `Scene ${s.scene_number}`, note: [s.time_of_day, s.covered === false ? 'no plate for this hour' : ''].filter(has).join(' · ') })), empty: 'No scene here yet.' },
            { title: 'Props on set', chips: (l.linked_props || []).map(p => p.name) },
        ],
        galleries: [{ title: 'Concept art & references', columns: 6, ratio: '4 / 3', cover: true, items: references.map(r => ({ src: r.src, label: [r.sent ? '★' : '', r.note].filter(has).join(' ') })) }],
    };
}

/** p: the prop row; views: the turntable slots, each with its picture; the rest already parsed. */
export function propDoc({ project, prop: p = {}, views = [], extraViews = [], materials = [], states = [], constraints = [], keywords = [], references = [], date }) {
    const mm = v => (Number(v) > 0 ? `${Math.round(Number(v) * 1000)} mm` : '');
    const biggest = Math.max(Number(p.height_m) || 0, Number(p.width_m) || 0, Number(p.length_m) || 0);
    const verdict = !biggest ? '' : biggest < 0.12 ? 'one-hand object' : biggest < 0.6 ? 'two-hand object' : biggest < 2 ? 'carried with effort' : 'set piece';
    const front = views.find(v => has(v.src)) || views[0];
    return {
        kind: 'Prop', project, date, name: p.name || 'Prop',
        meta: [p.category, p.period, p.practical ? 'Handled on camera' : '', verdict],
        hero: front ? { src: front.src, label: front.label, note: front.note, empty: 'No view yet' } : null,
        strip: { columns: Math.max(4, Math.min(6, views.length + extraViews.length - 1)), ratio: '1 / 1',
            items: [...views, ...extraViews].filter(v => v !== front).map(v => ({ src: v.src, label: v.label, note: v.note })) },
        main: [
            { title: 'Object description', empty: 'No description yet.', paragraphs: [{ text: p.visual_prompt }, { heading: has(p.visual_prompt) && has(p.description) ? 'For the crew' : '', text: p.description }] },
            { title: 'Must survive into every frame', chips: keywords },
            { title: 'Continuity states', list: states.map((s, i) => ({ text: `${String.fromCharCode(65 + i)} · ${s.name || 'State'}${has(s.what) ? ` — ${s.what}` : ''}`, note: s.scene || 'default' })) },
            { title: 'Constraints', list: constraints },
            { title: 'Production notes', paragraphs: [{ text: p.notes }] },
        ],
        side: [
            { title: 'Spec', facts: [['Category', p.category], ['Period', p.period], ['Quantity', p.quantity == null ? '' : String(p.quantity)], ['Practical', p.practical ? 'Yes' : 'No']] },
            { title: 'Scale', facts: [['Width', mm(p.width_m)], ['Height', mm(p.height_m)], ['Depth', mm(p.length_m)], ['Handling', verdict]], empty: 'Size not declared.' },
            { title: 'Materials & finish', swatches: materials.map(m => ({ name: m.name, hex: m.hex, note: m.role })) },
            { title: 'Appears in', chips: p.shots || [], empty: 'No shot names it yet.' },
            { title: 'Sets', chips: (p.locations || []).map(l => l.name) },
        ],
        galleries: [{ title: 'Concept art & references', columns: 6, ratio: '4 / 3', cover: true, items: references.map(r => ({ src: r.src, label: [r.sent ? '★' : '', r.note].filter(has).join(' ') })) }],
    };
}
