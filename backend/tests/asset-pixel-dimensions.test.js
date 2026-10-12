const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
process.env.FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-resolution-'));
const { imagePixels, imageWasUpscaled } = require('../lib/asset-pixel-dimensions');
const { encode } = require('../lib/png-raster');
const { db } = require('../db/database');
require('../db/schema').ensureSchema();
const { handleStoryboard, storyboardImagePath } = require('../routes/storyboard');
test.after(() => { db.close(); fs.rmSync(process.env.FILM_DATA_DIR, { recursive: true, force: true }); });

function png(file, width, height) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encode({ width, height, pixels: Buffer.alloc(width * height * 4, 255) }));
}
function route(parts) {
    let result;
    handleStoryboard({ method: 'GET' }, { writeHead() {}, end(bytes) { result = JSON.parse(bytes); } }, parts, {});
    return result;
}

test('reads the real PNG raster independent of filename, bounded to one header and never full file', () => {
    const file = path.join(process.env.FILM_DATA_DIR, 'requested-4K.png'); png(file, 1920, 1080);
    const read = fs.readSync, full = fs.readFileSync; let bytes = 0;
    fs.readSync = (...args) => { bytes += args[3]; return read(...args); };
    fs.readFileSync = () => { throw new Error('whole-file read is forbidden'); };
    try { assert.deepEqual(imagePixels(file), { width: 1920, height: 1080 }); assert.ok(bytes <= 64); }
    finally { fs.readSync = read; fs.readFileSync = full; }
});
test('missing files, directories, truncated or unsupported headers return unknown; changed files are remeasured', () => {
    assert.equal(imagePixels(path.join(process.env.FILM_DATA_DIR, 'missing')), null);
    assert.equal(imagePixels(process.env.FILM_DATA_DIR), null);
    const file = path.join(process.env.FILM_DATA_DIR, 'bad.png');
    fs.writeFileSync(file, Buffer.alloc(32)); assert.equal(imagePixels(file), null);
    fs.writeFileSync(file, Buffer.alloc(1024)); assert.equal(imagePixels(file), null);
    png(file, 2048, 858); assert.deepEqual(imagePixels(file), { width: 2048, height: 858 });
    png(file, 2160, 3840); assert.deepEqual(imagePixels(file), { width: 2160, height: 3840 });
});
test('upscale disclosure requires explicit selected-asset origin metadata', () => {
    assert.equal(imageWasUpscaled({ metadata: '{invalid' }), false);
    assert.equal(imageWasUpscaled({ metadata: '{"resolution":"4K"}' }), false);
    assert.equal(imageWasUpscaled({ metadata: '{"direction_mode":"upscale"}' }), true);
});
test('board payload follows the selected asset and actual live picture across version switches; rejects requested sizes', () => {
    const project = crypto.randomUUID(), scene = crypto.randomUUID(), shot = crypto.randomUUID();
    const a = crypto.randomUUID(), b = crypto.randomUUID(), file = storyboardImagePath(project, '1A');
    db.prepare('INSERT INTO film_projects (id,title,target_resolution) VALUES (?,?,?)').run(project, 'Badge fixture', '4096x2160');
    db.prepare('INSERT INTO film_scenes (id,project_id,scene_number) VALUES (?,?,1)').run(scene, project);
    db.prepare('INSERT INTO film_shots (id,scene_id,shot_code,current_frame_version) VALUES (?,?,?,1)').run(shot, scene, '1A');
    const insert = db.prepare("INSERT INTO film_assets (id,project_id,shot_id,asset_type,file_path,file_name,version,width,height,metadata) VALUES (?,?,?,'storyboard',?,'1A.png',?,4096,2160,?)");
    insert.run(a, project, shot, file, 1, '{}'); insert.run(b, project, shot, file, 2, '{"direction_mode":"upscale"}');
    const get = () => route(['film', 'projects', project, 'storyboard']).frames.find(f => f.shot_id === shot);
    png(file, 1920, 1080);
    assert.equal(get().asset_id, a); assert.deepEqual(get().image_pixels, { width: 1920, height: 1080 }); assert.equal(get().image_upscaled, false);
    db.prepare('UPDATE film_shots SET current_frame_version=2 WHERE id=?').run(shot); png(file, 2048, 858);
    assert.equal(get().asset_id, b); assert.deepEqual(get().image_pixels, { width: 2048, height: 858 }); assert.equal(get().image_upscaled, true);
    db.prepare('UPDATE film_shots SET current_frame_version=1 WHERE id=?').run(shot); png(file, 1920, 1080);
    assert.equal(get().asset_id, a); assert.equal(get().image_upscaled, false);
    fs.unlinkSync(file); assert.equal(get().image_pixels, null); assert.equal(get().image_url, null);
});
