const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  declSource
} = require('./console-render');
test('deferred source requests cannot reuse a previous set or install a late response', async () => {
  const WORLD = {
      version: {
        id: 'A'
      }
    },
    SPLAT = {
      infoFor: 'old',
      info: {
        mesh: {
          url: 'old'
        }
      }
    },
    release = {};
  const api = url => new Promise(resolve => release[url] = resolve);
  const info = new Function('WORLD', 'SPLAT', 'api', 'previzWorkspace', declSource('worldSplatInfo') + ';return worldSplatInfo;')(WORLD, SPLAT, api, {});
  const a = info();
  assert.equal(SPLAT.info, null);
  WORLD.version = {
    id: 'B'
  };
  const b = info(),
    b2 = info();
  assert.equal(SPLAT.info, null);
  release['/world-versions/B/splats']({
    world_version_id: 'B',
    mesh: {
      url: 'B'
    }
  });
  assert.equal((await b).mesh.url, 'B');
  assert.equal((await b2).mesh.url, 'B');
  release['/world-versions/A/splats']({
    world_version_id: 'A',
    mesh: {
      url: 'A'
    }
  });
  assert.equal(await a, null);
  assert.equal(SPLAT.info.mesh.url, 'B');
});
test('A to B to A source requests keep only the newest A response', async () => {
  const WORLD = { version: { id: 'A' } }, SPLAT = {}, releases = [];
  const api = url => new Promise(resolve => releases.push({url, resolve}));
  const info = new Function('WORLD', 'SPLAT', 'api', 'previzWorkspace', declSource('worldSplatInfo') + ';return worldSplatInfo;')(WORLD, SPLAT, api, {});
  const oldA = info();
  WORLD.version.id = 'B';
  const b = info();
  WORLD.version.id = 'A';
  const newA = info();
  releases[0].resolve({world_version_id:'A',mesh:{url:'stale A'}});
  releases[1].resolve({world_version_id:'B',mesh:{url:'B'}});
  assert.equal(await oldA, null);
  assert.equal(await b, null);
  assert.equal(SPLAT.info, null);
  releases[2].resolve({world_version_id:'A',mesh:{url:'new A'}});
  assert.equal((await newA).mesh.url, 'new A');
  assert.equal(SPLAT.info.mesh.url, 'new A');
});
test('deferred GLTF loaders cannot replace the current mesh after location or same-URL version switches', async () => {
  const WORLD = {
      version: {
        id: 'A'
      }
    },
    callbacks = [],
    rendered = [],
    loaded = [],
    frame = {
      firstChild: null,
      getBoundingClientRect: () => ({
        width: 320,
        height: 180
      }),
      insertBefore() {}
    },
    canvas = {
      style: {},
      width: 640,
      height: 360,
      parentElement: frame
    };
  const T = {
    GLTFLoader: class {}
  };
  const previzWorkspace = {
    loadModel: () => new Promise(resolve => callbacks.push(resolve)),
    disposeModel: root => { root.disposed = true; }
  };
  const MESHLOOK = {
      renderer: {
        setSize() {}
      },
      camera: {},
      scene: {
        add: r => loaded.push(r),
        remove() {}
      },
      sun: {},
      loadRevision: 0
    },
    STAGE = {};
  const mesh = new Function('previzWorkspace', 'WORLD', 'MESHLOOK', 'STAGE', 'window', 'document', 'worldMeshCanvas', 'mediaUrl', 'meshLookLights', 'stageSyncLook', 'worldViewMode', 'MESH_MODE_NOTES', 'worldMeshRequestRender', declSource('worldMeshSync') + ';return worldMeshSync;')(previzWorkspace, WORLD, MESHLOOK, STAGE, {
    THREE: T
  }, {
    getElementById: () => frame
  }, () => canvas, x => x, () => false, () => {}, () => 'look', {
    look: 'preview'
  }, () => rendered.push(true));
  await mesh('look', {
    world_version_id: 'A',
    mesh: {
      url: 'same'
    },
    scale_factor: 1
  }, 'A');
  WORLD.version = {
    id: 'B'
  };
  await mesh('look', {
    world_version_id: 'B',
    mesh: {
      url: 'same'
    },
    scale_factor: 1
  }, 'B');
  WORLD.version = {id: 'A'};
  await mesh('look', {world_version_id:'A',mesh:{url:'same'},scale_factor:1}, 'A');
  const a = {
      userData: {
        previz_asset_sha256: 'A'
      },
      scale: {
        setScalar() {}
      }
    },
    b = {
      userData: {
        previz_asset_sha256: 'B'
      },
      scale: {
        setScalar() {}
      }
    };
  callbacks[0](a);
  await Promise.resolve();
  assert.equal(MESHLOOK.root, null);
  assert.equal(a.disposed, true);
  callbacks[1](b);
  await Promise.resolve();
  assert.equal(MESHLOOK.root, null);
  assert.equal(b.disposed, true);
  const newA = {...a,userData:{previz_asset_sha256:'new A'}};
  callbacks[2](newA);
  await Promise.resolve();
  assert.equal(MESHLOOK.root, newA);
  assert.equal(MESHLOOK.versionId, 'A');
  assert.equal(loaded.length, 1);
  assert.equal(MESHLOOK.camera.aspect, 640 / 360);
});
