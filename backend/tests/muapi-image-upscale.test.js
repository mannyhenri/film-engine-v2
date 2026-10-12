const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.FILM_DATA_DIR = path.join(os.tmpdir(), `film-engine-image-upscale-${crypto.randomUUID()}`);
process.env.MUAPI_API_KEY = 'test-muapi-key';
process.env.MUAPI_POLL_MS = '1';

const upscale = require('../lib/providers/muapi-topaz-upscale');

function png(width, height) {
    const bytes = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes, 0);
    bytes.writeUInt32BE(13, 8);
    bytes.write('IHDR', 12, 'ascii');
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return bytes;
}

function uri(bytes) {
    return `data:image/png;base64,${bytes.toString('base64')}`;
}

test('Topaz Precision High Fidelity V3 uses the smallest scale that reaches the requested tier', () => {
    const twoK = upscale.buildUpscaleRequest({ width: 1200, height: 800, resolution: '2K', image_url: 'https://example.test/in.png' });
    assert.match(twoK.url, /\/topaz-upscale-image-precision$/);
    assert.deepEqual(twoK.body, {
        image_url: 'https://example.test/in.png',
        model: 'High Fidelity V3',
        upscale_factor: 2,
        output_format: 'png',
    });
    assert.equal(twoK.target_pixels, 2048);
    assert.equal(twoK.expected_long_edge, 2400);

    const fourK = upscale.buildUpscaleRequest({ width: 1200, height: 800, resolution: '4k', image_url: 'https://example.test/in.png' });
    assert.equal(fourK.body.upscale_factor, 4);
    assert.equal(fourK.expected_long_edge, 4800);
});

test('a small source automatically stays with Topaz and uses its compatible 8x endpoint', () => {
    const req = upscale.buildUpscaleRequest({ width: 600, height: 400, resolution: '4K', image_url: 'https://example.test/in.png' });
    assert.match(req.url, /\/topaz-image-upscale$/);
    assert.deepEqual(req.body, { image_url: 'https://example.test/in.png', factor: 8 });
    assert.equal(req.model, 'Topaz Image Upscale 8x fallback');
    assert.equal(req.expected_long_edge, 4800);
});


test('the MCP surface needs only the picture and 2K/4K target', () => {
    const { listTools } = require('../lib/mcp-tools');
    const tool = listTools().find(item => item.name === 'image_upscale');
    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.required, ['image', 'resolution']);
    assert.deepEqual(tool.inputSchema.properties.resolution.enum, ['2K', '4K']);
    assert.match(tool.description, /SPENDS/i);
    assert.match(tool.description, /High Fidelity V3/);
});

test('resume uses an existing provider handle without reupload or paid resubmission', async () => {
 const realFetch=global.fetch, sent=[], output=png(2400,1600);
 global.fetch=async(url,init)=>{sent.push({url:String(url),method:init?.method||'GET'});if(String(url).includes('/predictions/existing-upscale/result'))return {ok:true,status:200,json:async()=>({status:'completed',outputs:['https://fixture.test/result.png']})};if(String(url)==='https://fixture.test/result.png')return {ok:true,status:200,headers:{get:()=> 'image/png'},arrayBuffer:async()=>output.buffer.slice(output.byteOffset,output.byteOffset+output.length)};throw new Error('Unexpected upload or paid submit');};
 try{let stamped=0;const result=await upscale.upscaleImage({image:uri(png(1200,800)),resolution:'2K'},{requestId:'existing-upscale',onSubmitted:()=>stamped++});assert.equal(result.ok,true);assert.equal(stamped,0);assert.equal(sent.length,2);assert.ok(sent.every(r=>r.method==='GET'));assert.equal(result.request_id,'existing-upscale');}finally{global.fetch=realFetch;}
});

test.after(()=>{try{require('../db/database').db.close();}catch(_){}fs.rmSync(process.env.FILM_DATA_DIR,{recursive:true,force:true});});
