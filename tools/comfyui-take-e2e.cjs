#!/usr/bin/env node
/*
 * Live end-to-end check of a PC take tool through Film Engine's own path (lib/comfyui-shot.js makeFromTake):
 * a throwaway take, in a temporary data folder (never a real project), goes to the ComfyUI PC and must come back
 * filed on its shot as the next version, at the size the tool promises, with its fps and its sound.
 *
 *   node tools/comfyui-take-e2e.cjs <source video> [--seconds 0.5] [--workflow take_upscale_seedvr2]
 *        [--option model="Faster (SeedVR2 3B)"] [--want 1920x1080]
 *
 * The source is cut to --seconds and re-encoded as HEVC, so the H.264 conversion before upload is exercised too.
 * It uses the PC for real: keep the clip short. FILM_COMFYUI_URL picks another PC.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const src = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
if (!src || !fs.existsSync(src)) { console.error('usage: comfyui-take-e2e.cjs <source video> [--seconds 0.5] [--workflow slug] [--option id=label] [--want WxH]'); process.exit(2); }
const seconds = Number(flag('seconds', '0.5'));
const workflow = flag('workflow', 'take_upscale_seedvr2');
const want = flag('want', '1920x1080');
const options = {};
args.forEach((a, i) => { if (a === '--option') { const [k, ...v] = args[i + 1].split('='); options[k] = v.join('='); } });

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-take-e2e-'));
process.env.FILM_DATA_DIR = path.join(TMP, 'data');
const { db, generateId } = require('../backend/db/database');
require('../backend/db/schema').ensureSchema();
const { resolveFfmpeg } = require('../backend/lib/ffmpeg');
const comfy = require('../backend/lib/comfyui');
const shotLib = require('../backend/lib/comfyui-shot');

const ff = resolveFfmpeg().bin;
const info = f => require('child_process').spawnSync(ff, ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr || '';
const probe = f => {
    const s = info(f);
    const v = /Stream #\S+.*: Video: (\w+)[^\n]*?, (\d+)x(\d+)[^\n]*?, ([\d.]+) fps/.exec(s) || [];
    const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(s);
    return { codec: v[1], size: v[2] && `${v[2]}x${v[3]}`, fps: Number(v[4]), audio: / Audio: /.test(s), seconds: d ? (+d[1]) * 3600 + (+d[2]) * 60 + Number(d[3]) : null };
};

(async () => {
    const take = path.join(TMP, 'take-hevc.mp4');
    execFileSync(ff, ['-nostdin', '-v', 'error', '-y', '-i', src, '-t', String(seconds), '-c:v', 'libx265', '-tag:v', 'hvc1', '-crf', '18', '-c:a', 'aac', take]);
    const before = probe(take);
    const projectId = generateId(), sceneId = generateId(), shotId = generateId();
    db.prepare('INSERT INTO film_projects (id, title, assets_dir) VALUES (?, ?, ?)').run(projectId, 'take e2e (throwaway)', path.join(TMP, 'film'));
    db.prepare('INSERT INTO film_scenes (id, project_id, scene_number) VALUES (?, ?, 1)').run(sceneId, projectId);
    db.prepare('INSERT INTO film_shots (id, scene_id, shot_code) VALUES (?, ?, ?)').run(shotId, sceneId, 'E2E');
    const filed = shotLib.importTake(shotId, { path: take });
    console.log(`take v${filed.version}: ${before.codec} ${before.size} ${before.fps} fps ${before.seconds}s audio=${before.audio}; PC ${comfy.baseUrl()}; ${workflow} ${JSON.stringify(options)}`);
    const t0 = Date.now();
    const { job } = await shotLib.makeFromTake(filed.asset_id, { workflow, options });
    let j = comfy.getJob(job.id), stage = '';
    while (!['done', 'failed', 'cancelled'].includes(j.status)) {
        if (j.stage_label !== stage) { stage = j.stage_label; console.log(`  ${Math.round((Date.now() - t0) / 1000)}s ${j.status}: ${stage}`); }
        await new Promise(r => setTimeout(r, 2000));
        j = comfy.getJob(job.id);
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    if (j.status !== 'done') { console.error(`FAIL: ${j.status} after ${secs}s: ${j.error}`); process.exit(1); }
    const out = probe(j.filed.path);
    const takes = shotLib.listTakes(shotId);
    const checks = [
        ['filed as the next version', j.filed.version === filed.version + 1],
        ['remembers the take it came from', takes[0].from && takes[0].from.asset_id === filed.asset_id],
        [`size ${want}`, out.size === want],
        [`fps kept (${before.fps})`, Math.abs(out.fps - before.fps) < 0.01],
        ['sound kept', out.audio],
        [`length kept (${before.seconds}s ±1 frame)`, Math.abs(out.seconds - before.seconds) <= 1 / before.fps + 0.01],
    ];
    console.log(`back in ${secs}s: ${out.codec} ${out.size} ${out.fps} fps ${out.seconds}s audio=${out.audio} -> ${j.filed.path}`);
    for (const [what, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
    process.exit(checks.every(c => c[1]) ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
