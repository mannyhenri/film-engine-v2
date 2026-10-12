/** Derived navigation representation. Authoritative GLB/native bytes never change.
 * Only static opaque primitives are batched; material objects, attributes and
 * triangles survive intact. Transparency, animation and editable subjects stay
 * in their original objects. Spatial cells keep culling useful for town sets. */
const ALGORITHM = 'previz-static-spatial-v1';
const sourceBytes = new Map();
const MAX_CACHED_BYTES = 64 * 1024 * 1024;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const abort = signal => {
  if (signal?.aborted) throw new DOMException('Set load cancelled', 'AbortError');
};
async function digest(bytes) {
  const value = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(value), n => n.toString(16).padStart(2, '0')).join('');
}
function cacheBytes(key, value) {
  sourceBytes.set(key, value);
  let total = Array.from(sourceBytes.values()).reduce((n, x) => n + x.bytes.byteLength, 0);
  while (total > MAX_CACHED_BYTES && sourceBytes.size) {
    const first = sourceBytes.keys().next().value;
    total -= sourceBytes.get(first).bytes.byteLength;
    sourceBytes.delete(first);
  }
}
export function clearPrevizModelCache() { sourceBytes.clear(); }

export async function loadPrevizModel(T, url, options = {}) {
  const { signal, worldVersionId = null, expectedSha256 = null } = options;
  abort(signal);
  const key = expectedSha256 ? JSON.stringify([url, worldVersionId, expectedSha256]) : null;
  let asset = key && sourceBytes.get(key);
  if (!asset) {
    const response = await fetch(url, { cache: 'no-store', signal });
    if (!response.ok) throw new Error('Model download failed: ' + response.status);
    const bytes = await response.arrayBuffer();
    abort(signal);
    const sha256 = await digest(bytes);
    if (expectedSha256 && sha256 !== expectedSha256) throw new Error('Set source changed. Reload the location before capturing.');
    asset = { bytes, sha256 };
    if (key) cacheBytes(key, asset);
  }
  abort(signal);
  const gltf = await new Promise((resolve, reject) => new T.GLTFLoader().parse(asset.bytes,
    new URL('.', new URL(url, document.baseURI)).href, resolve, reject));
  const root = gltf.scene;
  try {
    abort(signal);
    root.userData.previz_asset_sha256 = asset.sha256;
    root.userData.previz_world_version_id = worldVersionId;
    // Track bindings may target any descendant; preserve that full graph.
    if (options.batch !== false) await batchPrevizModel(T, root, { ...options, sourceSha256: asset.sha256,
      animated: !!options.animated || !!gltf.animations?.length });
    abort(signal);
    return root;
  } catch (error) { disposePrevizModel(root); throw error; }
}

function signature(object) {
  const g = object.geometry, m = object.material;
  if (!object.isMesh || object.isSkinnedMesh || object.isInstancedMesh || !g || Array.isArray(m) || !m
    || m.transparent || m.opacity < 1 || m.transmission > 0 || object.userData?.previz_editable
    || object.userData?.dynamic || Object.values(g.morphAttributes || {}).some(x => x.length)
    || g.groups.length || g.drawRange.start !== 0 || Number.isFinite(g.drawRange.count)
    || object.matrixWorld.determinant() <= 0 || !g.attributes.position) return null;
  // Geometry outside TRIANGLES (lines/points) and interleaved attributes remain
  // untouched. Float position/normal/tangent transforms use Three's same math.
  if (['position', 'normal', 'tangent'].some(name => g.attributes[name]
    && (!(g.attributes[name].array instanceof Float32Array) || g.attributes[name].normalized))) return null;
  const attrs = Object.keys(g.attributes).sort();
  if (attrs.some(name => g.attributes[name].isInterleavedBufferAttribute
    || g.attributes[name].count !== g.attributes.position.count)) return null;
  const count = g.index?.count ?? g.attributes.position.count;
  if (count % 3) return null;
  for (let p = object; p; p = p.parent) if (!p.visible) return null;
  return [m.uuid, object.castShadow, object.receiveShadow, object.renderOrder, object.layers.mask, object.frustumCulled,
    ...attrs.map(name => [name, g.attributes[name].array.constructor.name, g.attributes[name].itemSize,
      g.attributes[name].normalized, g.attributes[name].gpuType ?? null].join(':'))].join('|');
}
function triangleCount(object) {
  if (!object.isMesh) return 0;
  return (object.geometry.index?.count ?? object.geometry.attributes.position?.count ?? 0) / 3;
}
function meshBounds(T, mesh, inverseRoot) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld));
}

export async function batchPrevizModel(T, root, options = {}) {
  const { signal, animated = false, sourceSha256 = root.userData.previz_asset_sha256 || null,
    worldVersionId = root.userData.previz_world_version_id || null, cellSize = 32, yieldTask = tick } = options;
  abort(signal);
  if (!Number.isFinite(cellSize) || cellSize <= 0 || cellSize > 1024) throw new Error('Invalid preview spatial cell size');
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert(), meshes = [], groups = new Map();
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  const totalTriangles = meshes.reduce((n, o) => n + triangleCount(o), 0);
  const boundsBefore = new T.Box3().setFromObject(root).applyMatrix4(inverseRoot);
  let deadline = performance.now() + 8;
  const pause = async () => {
    if (performance.now() >= deadline) { await yieldTask(); abort(signal); deadline = performance.now() + 8; }
  };
  if (!animated) for (const mesh of meshes) {
    const sig = mesh === root ? null : signature(mesh);
    if (sig) {
      const b = meshBounds(T, mesh, inverseRoot), centre = b.getCenter(new T.Vector3());
      const cell = [centre.x, centre.y, centre.z].map(n => Math.floor((n + 1e-7) / cellSize));
      const key = sig + '|' + cell.join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(mesh);
    }
    await pause();
  }
  const batches = [], consumed = new Set(), generated = [], sources = [];
  try {
    for (const [key, items] of groups) {
      if (items.length < 2) continue;
      abort(signal);
      const first = items[0], attrs = Object.keys(first.geometry.attributes).sort();
      const vertices = items.reduce((n, o) => n + o.geometry.attributes.position.count, 0);
      const indices = items.reduce((n, o) => n + (o.geometry.index?.count ?? o.geometry.attributes.position.count), 0);
      const geometry = new T.BufferGeometry(), index = new Uint32Array(indices);
      generated.push(geometry);
      for (const name of attrs) {
        const a = first.geometry.attributes[name];
        const merged = new T.BufferAttribute(new a.array.constructor(vertices * a.itemSize), a.itemSize, a.normalized);
        if (a.gpuType !== undefined) merged.gpuType = a.gpuType;
        geometry.setAttribute(name, merged);
      }
      let vertexOffset = 0, indexOffset = 0;
      for (const mesh of items) {
        const matrix = new T.Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld);
        const transformed = mesh.geometry.clone();
        transformed.applyMatrix4(matrix);
        for (const name of attrs) geometry.attributes[name].array.set(transformed.attributes[name].array,
          vertexOffset * geometry.attributes[name].itemSize);
        const count = transformed.index?.count ?? transformed.attributes.position.count;
        for (let i = 0; i < count; i++) index[indexOffset + i] = vertexOffset + (transformed.index ? transformed.index.getX(i) : i);
        sources.push({ name: mesh.name, batch: batches.length, vertexOffset, vertexCount: transformed.attributes.position.count,
          indexOffset, indexCount: count, matrix: matrix.toArray(), userData: { ...mesh.userData } });
        vertexOffset += transformed.attributes.position.count;
        indexOffset += count;
        transformed.dispose();
        consumed.add(mesh);
        await pause();
      }
      geometry.setIndex(new T.BufferAttribute(index, 1));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const batch = new T.Mesh(geometry, first.material);
      batch.name = 'Preview batch ' + batches.length;
      batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow;
      batch.renderOrder = first.renderOrder; batch.layers.mask = first.layers.mask;
      batch.frustumCulled = first.frustumCulled;
      batch.userData.previz_derived = true;
      batch.userData.previz_spatial_cell = key.slice(key.lastIndexOf('|') + 1);
      batches.push(batch);
      await pause();
    }
    abort(signal);
    // Commit only after all batches are complete. Cancellation leaves the
    // original scene intact. Preserve non-mesh children and their world pose.
    for (const mesh of consumed) {
      if (mesh.children.length) {
        const shell = new T.Group();
        shell.name = mesh.name; shell.userData = { ...mesh.userData };
        shell.position.copy(mesh.position); shell.quaternion.copy(mesh.quaternion); shell.scale.copy(mesh.scale);
        shell.matrix.copy(mesh.matrix); shell.matrixAutoUpdate = mesh.matrixAutoUpdate;
        shell.layers.mask = mesh.layers.mask; shell.visible = mesh.visible;
        for (const child of [...mesh.children]) shell.add(child);
        mesh.parent.add(shell);
      }
      mesh.removeFromParent();
    }
    for (const batch of batches) root.add(batch);
    // Shared source geometries can still be used by preserved transparent or
    // mirrored meshes. Dispose only geometries with no surviving scene user.
    const remaining = new Set(); root.traverse(o => { if (o.geometry) remaining.add(o.geometry); });
    const disposed = new Set();
    for (const mesh of consumed) if (!remaining.has(mesh.geometry) && !disposed.has(mesh.geometry)) {
      disposed.add(mesh.geometry); mesh.geometry.dispose();
    }
    root.updateMatrixWorld(true);
    const manifest = {
      algorithm: ALGORITHM, rendererRevision: String(T.REVISION || 'unknown'), sourceSha256, worldVersionId, cellSize, coordinateSpace: 'unchanged source scene',
      geometryPolicy: 'All triangles and vertex attributes retained. Static opaque objects only. Native source unchanged.',
      sourceMeshes: meshes.length, batchedMeshes: consumed.size, batches: batches.length,
      drawMeshes: meshes.length - consumed.size + batches.length, triangles: totalTriangles,
      bounds: { min: boundsBefore.min.toArray(), max: boundsBefore.max.toArray() }, sources
    };
    // The derived identity belongs to this algorithm/configuration AND actual
    // source bytes, never replaces previz_asset_sha256 used at capture freeze.
    manifest.sourceMappingSha256 = await digest(new TextEncoder().encode(JSON.stringify(sources)));
    manifest.derivedSha256 = await digest(new TextEncoder().encode(JSON.stringify(manifest)));
    root.userData.previz_representation = manifest;
    return root;
  } catch (error) {
    for (const geometry of generated) geometry.dispose();
    throw error;
  }
}

/** Capture provenance stays small while explicitly binding the full mapping.
 * Reconstruct it from immutable source bytes, renderer revision and algorithm
 * configuration; derivedSha256 hashes the complete manifest, not this summary. */
export function previzRepresentationDescriptor(root) {
  const m = root?.userData?.previz_representation;
  if (!m) return null;
  const { sources, ...descriptor } = m;
  return { ...descriptor, sourceMappingCount: sources.length,
    fullManifestBytes: new TextEncoder().encode(JSON.stringify(m)).byteLength };
}

export function disposePrevizModel(root) {
  if (!root || root.userData?.previz_disposed) return;
  root.userData.previz_disposed = true;
  root.removeFromParent?.();
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  root.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const material of (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean)) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    for (const uniform of Object.values(material.uniforms || {})) if (uniform?.value?.isTexture) textures.add(uniform.value);
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    if (texture.image?.close) images.add(texture.image);
    texture.dispose();
  }
  for (const image of images) image.close();
}
