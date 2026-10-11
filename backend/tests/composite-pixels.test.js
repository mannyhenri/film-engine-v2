const test = require('node:test');
const assert = require('node:assert/strict');
const {refineAlpha, blendFrame} = require('../lib/composite-render');

const settings = {corrections: [], choke_px: 0, feather_px: 0, exposure: 0, contrast: 1, saturation: 1, gamma: 1, light_rgb_gain: [1,1,1], grain: 0, grain_seed: 0};
const floats = values => {const buffer=Buffer.alloc(values.length*4);values.forEach((value,i)=>buffer.writeFloatLE(value,i*4));return buffer;};
const near = (actual, expected) => actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-6, `${i}: ${value} vs ${expected[i]}`));

test('manual polygons alter only their selected absolute source frames', async()=>{
    const raw=floats(Array(8).fill(.25));
    const corrections=[{mode:'include',points:[[0,0],[.5,0],[.5,1],[0,1]],start_frame:10,end_frame_exclusive:11},{mode:'exclude',points:[[.5,0],[1,0],[1,1],[.5,1]],start_frame:10,end_frame_exclusive:11}];
    near(await refineAlpha(raw,4,2,{...settings,corrections},10), [1,1,0,0,1,1,0,0]);
    near(await refineAlpha(raw,4,2,{...settings,corrections},11), Array(8).fill(.25));
});
test('choke, expansion and feather produce known alpha values without changing input bytes', async()=>{
    const raw=floats([0,0,0,0,1,0,0,0,0]),original=Buffer.from(raw);
    near(await refineAlpha(raw,3,3,{...settings,choke_px:1},0), Array(9).fill(0));
    near(await refineAlpha(raw,3,3,{...settings,choke_px:-1},0), Array(9).fill(1));
    near(await refineAlpha(raw,3,3,{...settings,feather_px:1},0), Array(9).fill(1/9));
    assert.deepEqual(raw,original);
    await assert.rejects(Promise.resolve().then(()=>refineAlpha(floats([NaN]),1,1,settings,0)), /nonfinite/);
});
test('colour and grain controls have independent exact RGB and straight-alpha expectations', async()=>{
    const source=Buffer.from([64,128,192]),background=Buffer.from([10,20,30]);
    const half=await blendFrame(source,Float32Array.from([.5]),background,null,null,settings,0);
    assert.deepEqual([...half.rgb],[37,74,111]);assert.deepEqual([...half.rgba],[64,128,192,128]);
    for(const [change,expected] of [[{exposure:1},[128,255,255]],[{saturation:0},[119,119,119]],[{gamma:2},[128,181,221]],[{light_rgb_gain:[2,1,.5]},[128,128,96]],[{contrast:0},[128,128,128]]]) {
        const frame=await blendFrame(source,Float32Array.from([1]),background,null,null,{...settings,...change},0);assert.deepEqual([...frame.rgb],expected);assert.deepEqual([...frame.rgba.slice(0,3)],expected);
    }
    const grain=await blendFrame(Buffer.from([128,128,128]),Float32Array.from([1]),background,null,null,{...settings,grain:.2},0);
    assert.deepEqual([...grain.rgb],[115,115,115]);assert.deepEqual([...grain.rgba],[128,128,128,255]);
});
test('inverse depth places the subject on each side of a semi-transparent foreground',async()=>{
    const frame=await blendFrame(Buffer.from([200,0,0,200,0,0]),Float32Array.from([.5,.5]),Buffer.from([0,0,200,0,0,200]),Buffer.from([0,200,0,128,0,200,0,128]),floats([.8,.2]),{...settings,foreground_inverse_depth:.5},0);
    assert.deepEqual([...frame.rgb],[100,50,50,50,100,50]);assert.deepEqual([...frame.rgba],[200,0,0,128,200,0,0,128]);
});
test('a cancellation can be serviced during an admitted maximum-size refinement or blend',async()=>{
    const width=1920,height=1080,pixels=width*height;
    for(const operation of [signal=>refineAlpha(Buffer.alloc(pixels*4),width,height,{...settings,choke_px:4,feather_px:12},0,signal),signal=>blendFrame(Buffer.alloc(pixels*3),new Float32Array(pixels),Buffer.alloc(pixels*3),null,null,settings,0,signal)]) {
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),0);
        try {await assert.rejects(Promise.resolve().then(()=>operation(controller.signal)),/Cancelled/);} finally {clearTimeout(timer);}
    }
});
