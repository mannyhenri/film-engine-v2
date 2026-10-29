#!/usr/bin/env node
/*
 * Check workflow manifests against the LIVE ComfyUI PC, the way Film Engine does before it calls one ready
 * (lib/comfyui.js: validate() against the graph, then liveProblems() against the PC's /object_info).
 *
 *   node tools/comfyui-live-check.cjs                         every workflow deployed on the PC
 *   node tools/comfyui-live-check.cjs <manifest.fe.json> [--graph <api.json>]
 *                                                            a local manifest (say, one about to be deployed, or a
 *                                                            deliberately broken copy), against its deployed graph
 *                                                            unless --graph names a local one
 * Exit 0 when everything checked is ready, 1 when anything is not. FILM_COMFYUI_URL picks another PC.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.FILM_DATA_DIR = process.env.FILM_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'fe-live-check-'));
const comfy = require('../backend/lib/comfyui');

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const local = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--graph'));

(async () => {
    let results;
    if (!local) results = (await comfy.listWorkflows()).map(w => ({ name: w.slug, problems: w.problems }));
    else {
        const manifest = JSON.parse(fs.readFileSync(local, 'utf8'));
        const slug = path.basename(local).replace(/\.fe\.json$/i, '');
        const graph = flag('graph') ? JSON.parse(fs.readFileSync(flag('graph'), 'utf8')) : (await comfy.loadGraph(manifest.workflow || `${slug}.api.json`));
        const problems = comfy.validate(manifest, graph);
        if (!problems.length) problems.push(...comfy.liveProblems(manifest, graph, await comfy.liveInfo(manifest, graph)));
        results = [{ name: `${local} (local)`, problems }];
    }
    console.log(`PC ${comfy.baseUrl()}`);
    for (const r of results) console.log(`${r.problems.length ? 'NOT READY' : 'READY    '}  ${r.name}${r.problems.map(p => `\n             - ${p}`).join('')}`);
    process.exit(results.every(r => !r.problems.length) ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
