/** The location workspace owns target selection; it never replaces blocking while switching targets. */
import { legacy } from './legacy.js';
import { nearestSupport, walkStep } from './previz-navigation.js';
import { loadPrevizModel, disposePrevizModel, previzRepresentationDescriptor } from './previz-model.js';
const api = (url, opts = {}) => legacy.api(url, {
  ...opts,
  refresh: false
});
const clone = value => JSON.parse(JSON.stringify(value));
export const previzWorkspace = {
  changed() {
    this.revision++;
  },
  loadModel(T, url, options = {}) { return loadPrevizModel(T, url, options); },
  disposeModel(root) { disposePrevizModel(root); },
  step(camera, dx, dz, scale) {
    const nav = this.source?.navigation;
    if (!nav?.supports.length) return false;
    const p = camera.position.map(n => n * scale),
      foot = nearestSupport(nav, p[0], p[2], p[1] - .2);
    if (foot == null) return false;
    const eye = p[1] - foot,
      next = walkStep(nav, p, dx, dz, foot);
    next.position[1] = next.foot + eye;
    camera.position = next.position.map(n => n / scale);
    return true;
  },
  async follow(subject, distance, height) {
    const E = this.E,
      W = legacy.WORLD,
      revision = this.revision;
    if (!this.source) throw new Error('Wait for the set audit');
    const result = await api('/previz-workspace/follow', {
      method: 'POST',
      body: JSON.stringify({
        world_version_id: W.version.id,
        world_sha256: this.source.world_sha256,
        subject: clone(subject),
        durationMs: W.durationMs,
        distance_m: distance,
        height_m: height,
        focal_mm: W.lens
      })
    });
    if (this.revision !== revision) return;
    W.keys = result.cameraKeys;
    W.blocking.blocking.cameraKeys = clone(result.cameraKeys);
    this.changed();
    E.worldConsoleRender();
  },
  async explore(operation) {
    const E = this.E,
      W = legacy.WORLD,
      X = E.EXPLORE,
      revision = this.revision;
    try {
      if (!this.source) throw new Error('Wait for the set audit');
      const body = {
        operation,
        world_version_id: W.version.id,
        world_sha256: this.source.world_sha256,
        blocking: clone(W.blocking.blocking)
      };
      body.blocking.camera = {
        ...body.blocking.camera,
        focalMm: W.lens
      };
      if (operation === 'accept') {
        const got = E.worldExploreCandidates();
        if (got.error) throw new Error(got.error);
        body.candidates = got.candidates;
      }
      if (operation === 'compare') {
        const [a, b] = X.picks.map(k => X.accepted.find(x => x.key === k));
        if (!a || !b) throw new Error('Choose two checked cameras');
        body.a = {
          camera: a.camera,
          blocking: body.blocking
        };
        body.b = {
          camera: b.camera,
          blocking: body.blocking
        };
      }
      const result = await api('/previz-workspace/explore', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      if (revision !== this.revision) return;
      if (operation === 'brief') {
        X.brief = result;
        X.cats = result.categories || [];
      } else if (operation === 'accept') {
        X.accepted = result.accepted;
        X.rejected = result.rejected;
        X.shortfall = result.shortfall;
        X.workspaceRevision = revision;
      } else X.result = {
        comparison: result
      };
      E.worldExploreShow();
    } catch (err) {
      X.result = {
        error: err.message
      };
      E.worldExploreShow();
    }
  },
  loadExplore(key) {
    const E = this.E,
      X = E.EXPLORE,
      got = X.accepted.find(a => a.key === key);
    if (!got || X.workspaceRevision !== this.revision) {
      X.result = {
        error: 'Check cameras against the current set and blocking first.'
      };
      return E.worldExploreShow();
    }
    legacy.WORLD.blocking.blocking.camera = clone(got.camera);
    legacy.WORLD.lens = got.camera.focalMm || legacy.WORLD.lens;
    legacy.WALK.on = true;
    legacy.WALK.moved = true;
    this.changed();
    X.workspaceRevision = this.revision;
    X.result = {
      loaded: key,
      camera: got.camera
    };
    E.worldWalkRepaint();
    E.worldExploreShow();
  },
  async light(change) {
    const revision = this.revision,
      W = legacy.WORLD,
      previous = W.blocking?.lighting || {},
      next = change ? {
        ...previous,
        ...change
      } : {};
    const pose = this.E.worldCameraPose(),
      subject = this.E.stageSubjects().find(s => s.isTarget) || this.E.stageSubjects()[0];
    try {
      const result = await api('/previz-workspace/lighting', {
        method: 'POST',
        body: JSON.stringify({
          settings: next,
          camera: pose?.eye,
          subject: subject?.position || pose?.target
        })
      });
      if (revision !== this.revision) return;
      W.blocking.lighting = result;
      this.changed();
      this.E.worldConsoleRender();
    } catch (err) {
      legacy.setStatus(err.message);
    }
  },
  E: null,
  source: null,
  room: null,
  draft: null,
  pending: null,
  revision: 0,
  sourceGeneration: 0,
  collapsedSets: {},
  railRevision: 0,
  creation: null,
  creationGeneration: 0,
  busy: false,
  bind(E) {
    this.E = E;
    const names = ['previzTarget', 'previzRoom', 'previzApply', 'previzCapture', 'previzRenderReview', 'previzSend', 'previzCancel', 'previzFilter', 'previzSelectSet', 'previzCreateTarget', 'previzCreateShot', 'previzStartNewShot', 'previzAddScene'];
    for (const name of names) window[name] = (...args) => this[name](...args);
    return () => {
      this.E.worldMeshRelease();
      for (const name of names) delete window[name];
      this.revision++;
      this.sourceGeneration++;
      this.source = null;
      this.draft = null;
      if (!this.creation?.shot && !this.creation?.sending) this.creation = null;
      this.creationGeneration++;
      // React can clean up the initial mount before the deferred core exists.
      let world;
      try { world = legacy.WORLD; }
      catch (err) { if (err.message !== 'legacy.WORLD: the core has not defined it') throw err; }
      if (world) {
        world.selectionRevision = (world.selectionRevision || 0) + 1;
        world.scoutLoading = null;
      }
      if (this.pending) this.previzCancel();
    };
  },
  async opened({preserve = false} = {}) {
    const world = legacy.WORLD;
    this.revision++;
    this.source = null;
    if (!preserve) this.room = null;
    this.draft = null;
    const revision = this.revision,
      generation = ++this.sourceGeneration,
      version = world.version?.id;
    if (!preserve) {
      this.E.STAGE.gltf = {};
      this.E.STAGE.lookSig = null;
      world.targetId = null;
      world.shotId = null;
      world.targetFrame = null;
      this.E.EXPLORE.accepted = [];
      this.E.EXPLORE.result = null;
      world.keys = [];
      world.moves = [];
      world.t = 0;
      world.durationMs = 4000;
    }
    try {
      const source = await api('/previz-workspace/world/' + version);
      if (this.sourceGeneration !== generation || world.version?.id !== version) return;
      this.source = source;
      if (source.geometry && (!preserve || world.geometryFor !== version)) {
        world.geometry = source.geometry;
        world.geometryFor = version;
      }
      if (!preserve && !world.blocking?.blocking?.camera) this.E.worldWalkCamera();
      if (preserve && this.room) this.room = source.rooms?.find(r=>String(r.id) === String(this.room.id)) || null;
      if (!preserve && this.revision === revision && !legacy.WALK.moved && source.rooms?.length) this.previzRoom(source.rooms[0].id);else this.E.worldConsoleRender();
    } catch (err) {
      if (this.revision === revision) legacy.setStatus('Set audit: ' + err.message);
    }
  },
  locationName() {
    const W = legacy.WORLD;
    return W.scout?.name || W.scoutable?.find(s => s.world.id === W.world?.id)?.name || W.world?.name || '';
  },
  targets() {
    const W = legacy.WORLD,
      name = this.locationName().trim().toUpperCase();
    return (W.shots || []).filter(s => s.location_id && W.world?.location_id
      ? s.location_id === W.world.location_id : String(s.location || '').trim().toUpperCase() === name);
  },
  target() {
    return this.targets().find(s => s.id === legacy.WORLD.targetId) || null;
  },
  async previzTarget(id) {
    if (id === '__create__') return this.previzCreateTarget();
    const W = legacy.WORLD;
    if (id && !this.targets().some(s => s.id === id)) return legacy.setStatus('Choose a shot at this location');
    this.revision++;
    W.targetId = id || null;
    W.shotId = id || null;
    this.draft = null;
    const revision = this.revision;
    W.targetCard = null;
    W.targetFrame = null;
    if (id) {
      try {
        const [detail, previs] = await Promise.all([api('/shots/' + id), api('/shots/' + id + '/previs')]);
        if (revision !== this.revision || W.targetId !== id) return;
        W.targetCard = detail.card;
        W.targetFrame = previs.keyframe;
      } catch (err) {
        if (revision === this.revision) legacy.setStatus(err.message);
      }
    }
    if (revision === this.revision) this.E.worldConsoleRender();
  },
  pickerHtml() {
    const esc = legacy.esc,
      t = this.target();
    return `<label class="pv-target-picker"><span class="sr-only">Target storyboard shot</span><select aria-label="Target storyboard shot" onchange="previzTarget(this.value)"><option value="">Choose target shot</option>${this.targets().map(s => `<option value="${esc(s.id)}"${s.id === t?.id ? ' selected' : ''}>${esc(s.shot_code)} · ${esc(s.location || '')}</option>`).join('')}${legacy.WORLD.version ? '<option value="__create__">Create shot at this location…</option>' : ''}</select></label>`;
  },
  scope() {
    const W = legacy.WORLD;
    return { projectId: legacy.state.currentProject?.id, worldId: W.world?.id, versionId: W.version?.id,
      locationId: W.world?.location_id, name: this.locationName() };
  },
  sameScope(scope) {
    return JSON.stringify(this.scope()) === JSON.stringify(scope);
  },
  async previzCreateTarget() {
    // A known or in-flight shot owns its original scene, set and camera until saved.
    if (this.creation?.shot || this.creation?.sending) return this.showCreationDialog(this.creation);
    const W = legacy.WORLD, scope = this.scope(), revision = this.revision, generation = ++this.creationGeneration;
    if (!scope.projectId || !scope.versionId || !W.blocking?.blocking?.camera) return legacy.setStatus('Load a set and choose a camera view first');
    this.creation = null;
    try {
      const result = await api(`/projects/${scope.projectId}/scenes`);
      if (generation !== this.creationGeneration || revision !== this.revision || !this.sameScope(scope)) return;
      const scenes = (result.scenes || []).filter(s => s.status !== 'removed' && (!s.project_id || s.project_id === scope.projectId)
        && (s.location_id && scope.locationId ? s.location_id === scope.locationId : String(s.location || '').trim().toUpperCase() === scope.name.trim().toUpperCase()));
      this.creation = {scope, revision, scenes, blocking:clone(W.blocking.blocking), lens:W.lens,
        durationMs:W.durationMs, cameraKeys:clone(W.keys || []), moves:clone(W.moves || [])};
      this.showCreationDialog(this.creation);
    } catch (err) { if (this.sameScope(scope)) legacy.setStatus('Could not read location scenes: ' + err.message); }
  },
  showCreationDialog(creation, open = true) {
    const {scope, scenes, operation, shot, sending} = creation, esc = legacy.esc;
    legacy.showModalHtml('previzCreateShot', `<div class="pv-create-shot"><h2>${shot ? 'Finish saving shot' : 'Create shot at'} ${esc(shot?.shot_code || scope.name)}</h2>${scenes.length
      ? `<p>${shot ? `Finish the original ${esc(scope.name)} set and camera save for scene ${esc(operation.sceneNumber)}.` : 'The new shot will use this camera and set version. Choose its scene.'}</p><label>Scene <select id="previzCreateScene"${shot || sending ? ' disabled' : ''}>${scenes.map(s=>`<option value="${esc(s.id)}"${s.id === operation?.sceneId ? ' selected' : ''}>${esc(s.scene_number)} · ${esc(s.location)}</option>`).join('')}</select></label><div class="btn-row"><button class="btn btn-secondary" onclick="closeModal('previzCreateShot')">Close</button><button class="btn btn-primary"${sending ? ' disabled' : ''} onclick="previzCreateShot(document.getElementById('previzCreateScene').value)">${sending ? 'Saving shot…' : shot ? 'Finish saving shot' : 'Create shot from this view'}</button></div>${shot ? `<p>Starting another shot leaves ${esc(shot.shot_code || operation.code)} in its original scene with this save unfinished.</p><button class="btn btn-secondary"${sending ? ' disabled' : ''} onclick="previzStartNewShot()">Start a new shot from current view</button>` : ''}`
      : `<p>No screenplay scene is set at ${esc(scope.name)}. Add a scene at this location, then return to create its shot. Your explored camera is kept.</p><button class="btn btn-primary" onclick="previzAddScene()">Add scene in screenplay</button>`}</div>`);
    if (open) legacy.showModal('previzCreateShot');
  },
  async previzStartNewShot() {
    const creation = this.creation;
    if (!creation?.shot || creation.sending) return;
    const {shot, scope, operation} = creation, W = legacy.WORLD;
    if (legacy.state.currentProject?.id === scope.projectId) W.shots = [...(W.shots || []).filter(s=>s.id !== shot.id), {...shot,shot_code:shot.shot_code || operation.code,scene_id:operation.sceneId,location:scope.name,location_id:scope.locationId}];
    this.creation = null;
    legacy.closeModal('previzCreateShot');
    legacy.setStatus(`Shot ${shot.shot_code || operation.code} remains in its original scene with the set/camera save unfinished.`);
    return this.previzCreateTarget();
  },
  previzAddScene() {
    legacy.closeModal('previzCreateShot');
    legacy.navigateTo('screenplay');
  },
  async previzCreateShot(sceneId) {
    const creation = this.creation;
    if (!creation || creation.sending) return;
    if (!creation.shot && (!this.sameScope(creation.scope) || creation.revision !== this.revision)) return legacy.setStatus('The set or camera changed. Open Create shot again.');
    if (creation.shot && sceneId !== creation.operation.sceneId) return legacy.setStatus('Finish saving the original shot in its selected scene.');
    const scene = creation.scenes.find(s=>s.id === sceneId);
    if (!scene) return legacy.setStatus('Choose a scene at this location');
    const {scope, blocking} = creation, W = legacy.WORLD;
    const code = this.E.scoutShotCode(scene.scene_number, (W.shots || []).filter(s=>s.scene_id === scene.id).map(s=>s.shot_code));
    if (!creation.shot) creation.operation = {sceneId:scene.id, sceneNumber:scene.scene_number, code};
    const operation = creation.operation;
    creation.sending = true;
    this.showCreationDialog(creation, false);
    try {
      const made = creation.shot ? {shots:[creation.shot]} : await api('/shots', {method:'POST',body:JSON.stringify({scene_id:scene.id,cards:[{shot_code:code,description:`Chosen by walking the ${scope.name} set in Previs.`,duration_seconds:(creation.durationMs || 4000)/1000}]})});
      const shot = creation.shot = made.shots?.[0];
      if (!shot?.id) throw new Error('The shot was not created');
      await api(`/shots/${shot.id}/world`, {method:'POST',body:JSON.stringify({world_version_id:scope.versionId})});
      await api(`/shots/${shot.id}/previs`, {method:'PUT',body:JSON.stringify({...blocking,
        camera:{...blocking.camera,focalMm:creation.lens || 35},durationMs:creation.durationMs,
        cameraKeys:creation.cameraKeys,moves:creation.moves})});
      if (this.creation === creation) {
        if (legacy.state.currentProject?.id === scope.projectId) W.shots = [...(W.shots || []).filter(s=>s.id !== shot.id), {...shot,shot_code:shot.shot_code || operation.code,scene_id:operation.sceneId,location:scope.name,location_id:scope.locationId}];
        this.creation = null;
        legacy.closeModal('previzCreateShot');
        if (this.sameScope(scope) && this.revision === creation.revision) await this.previzTarget(shot.id);
      }
      legacy.setStatus(`Shot ${shot.shot_code || operation.code} created at ${scope.name}. Select it, save a draft, then render the saved setup in Blender.`);
    } catch (err) { legacy.setStatus((creation.shot ? `Shot ${creation.shot.shot_code || operation.code} was created, but its set/camera save failed. Retry to finish the same shot: ` : 'Could not create the shot: ') + err.message); }
    finally {
      creation.sending = false;
      if (this.creation === creation) this.showCreationDialog(creation, false);
    }
  },
  titleHtml() {
    const W = legacy.WORLD;
    return `<div class="pv-location-heading"><b>${legacy.esc(W.scout?.name || W.world?.name || 'Choose a 3D set')}</b><span>${legacy.esc(this.room?.name || 'Walk and frame the set')} · ${W.version ? 'v' + legacy.esc(String(W.version.version || 1)) : 'no set loaded'}</span></div>`;
  },
  railHtml() {
    const W = legacy.WORLD,
      esc = legacy.esc,
      sets = W.scoutable || [];
    return `<div class="nav-group-label"><span>3D SETS</span><span>${sets.length}</span></div><div class="fe-panel-shotlist">${sets.map(x => {
      const selected = W.world?.id === x.world.id, expanded = selected && !this.collapsedSets[x.world.id];
      return `<div class="pv-set-entry" data-set-id="${esc(x.world.id)}" data-name="${esc(x.name.toLowerCase())}"><button class="pv-shot${selected ? ' active' : ''}" aria-expanded="${expanded}" onclick="previzSelectSet('${esc(x.world.id)}')"><span class="pv-shot-id">${expanded ? '▾' : '▸'}</span><span class="pv-shot-loc"><b>${esc(x.name)}</b><small>v${esc(String(x.version.version || 1))} · ${x.world.location_id ? 'Location set' : '3D set'}</small></span></button>${expanded && this.source?.rooms?.length ? `<div class="pv-room-list">${this.source.rooms.map(r => `<button${r.id === this.room?.id ? ' class="active"' : ''} onclick="previzRoom('${esc(r.id)}')">${esc(r.name)}</button>`).join('')}</div>` : ''}</div>`;
    }).join('') || '<p class="pv-dim">No 3D sets yet. Build or import a location set.</p>'}</div><p class="pv-location-note">Locations first<br>Walk the set. Block the shot.<br>Save a draft, then render.</p>`;
  },
  previzSelectSet(id) {
    if (legacy.WORLD.world?.id !== id) return this.E.worldScoutSelect(id);
    this.collapsedSets[id] = !this.collapsedSets[id];
    this.railRevision++;
    this.E.worldConsoleRender();
  },
  previzFilter(value) {
    document.querySelectorAll('.pv-set-entry').forEach(el => {
      el.hidden = !el.dataset.name.includes(value.toLowerCase());
    });
  },
  previzRoom(id) {
    const r = this.source?.rooms?.find(r => String(r.id) === String(id)),
      W = legacy.WORLD,
      T = window.THREE;
    if (!r || !T) return;
    const mat = new T.Matrix4().fromArray(r.matrix),
      position = new T.Vector3(),
      q = new T.Quaternion(),
      scale = new T.Vector3();
    mat.decompose(position, q, scale);
    const forward = new T.Vector3(0, 0, -1).applyQuaternion(q),
      up = new T.Vector3(0, 1, 0).applyQuaternion(q);
    const k = Number(W.version?.scale_factor) || 1;
    W.blocking.blocking.camera = {
      position: position.toArray().map(n => n / k),
      rotation: [Math.atan2(-forward.x, -forward.z) * 180 / Math.PI, Math.asin(forward.y) * 180 / Math.PI, 0]
    };
    const basis = new T.Matrix4().lookAt(position, position.clone().add(forward), new T.Vector3(0, 1, 0)),
      baseQ = new T.Quaternion().setFromRotationMatrix(basis);
    const actualUp = new T.Vector3(0, 1, 0).applyQuaternion(baseQ),
      right = new T.Vector3(1, 0, 0).applyQuaternion(baseQ);
    W.blocking.blocking.camera.rotation[2] = Math.atan2(-up.dot(right), up.dot(actualUp)) * 180 / Math.PI;
    W.lens = 18.66 / (2 * Math.tan(r.verticalFovDegrees * Math.PI / 360));
    this.room = r;
    this.revision++;
    this.draft = null;
    legacy.WALK.on = true;
    legacy.WALK.moved = true;
    this.E.worldSetViewMode('look');
    this.E.worldConsoleRender();
  },
  briefHtml() {
    const W = legacy.WORLD,
      t = this.target(),
      card = W.targetCard || {};
    return `<div class="we-panel"><div class="we-label">SHOT BRIEF</div>${this.pickerHtml()}<p class="pv-shot-description">${legacy.esc(t ? card.action || card.description || t.description || 'This shot has no description yet.' : 'Choose an existing shot to see its canonical description.')}</p><p class="we-hint">Use the description as blocking guidance. Saving the draft adds an image version to this shot.</p></div>`;
  },
  footerHtml() {
    const t = this.target(),
      disabled = !t || !legacy.WORLD.version || this.busy;
    return `<div class="pv-delivery"><div><span>STORYBOARD DESTINATION</span><b title="${legacy.esc(t ? 'New image version · existing history preserved' : 'Existing shots at other locations stay where they are')}">${legacy.esc(t ? `${legacy.state.currentProject?.title || 'Project'} / Storyboard / ${t.shot_code}` : 'Choose or create a shot at this location')}</b><small>${t ? 'New image version · existing history preserved' : 'Existing shots at other locations stay where they are'}</small>${!t && legacy.WORLD.version ? '<button class="pv-btn" onclick="previzCreateTarget()">Create shot from this view</button>' : ''}</div><div class="pv-delivery-actions"><button class="pv-btn" onclick="previzApply()" title="Send this camera, its keyed move and who stands where to the shot. Production › Generate writes them into the prompt; anything changed there stays."${!(t || legacy.WORLD.shotId) || this.busy ? ' disabled' : ''}>Apply to shot</button><button class="pv-btn pv-draft" onclick="previzCapture()" title="Browser preview"${disabled ? ' disabled' : ''}>Save draft to storyboard</button><button class="pv-btn pv-primary" onclick="previzRenderReview()" title="${this.draft ? 'Same saved scene snapshot' : 'Save a draft first'}"${disabled || !this.draft ? ' disabled' : ''}>Render in Blender</button><small>Browser preview</small><small>${this.draft ? 'Same saved scene snapshot' : 'Save a draft first'}</small></div></div>`;
  },
  async capture() {
    const E = this.E,
      W = legacy.WORLD,
      T = window.THREE;
    if (!this.target()) throw new Error('Choose a real target shot');
    if (E.worldViewMode() !== 'look') throw new Error('Open 3D view to capture the camera preview');
    if (!this.source || this.source.world_version_id !== W.version?.id || !E.MESHLOOK.root || E.MESHLOOK.versionId !== W.version?.id || E.MESHLOOK.worldSha256 !== this.source.world_sha256 || E.SPLAT.infoFor !== W.version?.id || !E.SPLAT.info?.mesh || E.MESHLOOK.url !== E.SPLAT.info.mesh.url || !E.MESHLOOK.camera) throw new Error('Wait for this exact set version to finish loading');
    if (E.SETEDIT.on) throw new Error('Finish or cancel the set edit before capturing');
    if (W.playing) throw new Error('Pause the timeline before capturing');
    const worldScale = E.worldCameraPose()?.scale || 1;
    if (['x','y','z'].some(axis => !Number.isFinite(E.MESHLOOK.root.scale?.[axis]) || Math.abs(E.MESHLOOK.root.scale[axis] - worldScale) > 1e-9)) throw new Error('Set calibration and loaded preview differ. Reload the set before capturing');
    E.worldMeshRenderOnce();
    const camera = E.MESHLOOK.camera,
      canvas = E.MESHLOOK.canvas,
      subjects = E.stageShownSubjects();
    const group = E.MESHLOOK.scene.getObjectByName('staged');
    if (subjects.length !== (group?.children.length || 0)) throw new Error('A staged model is still loading or failed to load');
    if (camera.view?.enabled || camera.filmOffset) throw new Error('This camera view offset cannot be matched in Blender');
    const p = new T.Vector3(),
      q = new T.Quaternion();
    camera.getWorldPosition(p);
    camera.getWorldQuaternion(q);
    const ratio = camera.aspect;
    let width = canvas.width,
      height = canvas.height;
    const scale = width / Math.max(height, 1);
    if (Math.abs(scale - ratio) > 1e-4) throw new Error('Viewport and camera framing differ; resize the view');
    const staged = subjects.map((s, i) => {
      const holder = group?.children.find(h => h.userData.si === i),
        loadedSha = holder?.userData.previz_asset_sha256;
      if (s.model && !loadedSha) throw new Error('The staged model has no verified loaded bytes');
      return {
        ...clone(s),
        model: s.model ? {
          ...clone(s.model),
          loaded_sha256: loadedSha
        } : null,
        position: s.position.map(n => n * worldScale),
        sizeM: E.stageSize(s).map(n => n * worldScale)
      };
    });
    const lit = W.blocking?.lighting || {};
    return {
      project_id: legacy.state.currentProject.id,
      shot_id: W.targetId,
      world_version_id: W.version.id,
      world_sha256: this.source.world_sha256,
      world_scale_factor: worldScale,
      browser_representation: previzRepresentationDescriptor(E.MESHLOOK.root),
      preview: canvas.toDataURL('image/png'),
      camera: {
        position: p.toArray(),
        quaternion: q.toArray(),
        verticalFovDegrees: camera.getEffectiveFOV(),
        aspectRatio: ratio,
        near: camera.near,
        far: camera.far,
        lens_mm: E.worldPreviewCamera()?.focalMm || W.lens || 35,
        sensor_width_mm: 24.89,
        sensorFit: 'HORIZONTAL',
        projectionMatrix: camera.projectionMatrix.toArray()
      },
      frame: {
        width,
        height,
        playhead_ms: E.stageNowMs()
      },
      subjects: staged,
      lights: {
        mode: W.showLights !== false && (lit.rig?.length || lit.mood) ? 'rig' : 'native',
        rig: clone(lit.rig || []),
        mood: clone(lit.mood || null),
        browser_preview_lighting: 'Browser work lights and glTF materials approximate the native scene; Blender uses native materials and native lighting or the explicit rig.',
        browser_tone_mapping: 'ACESFilmic',
        browser_exposure: E.MESHLOOK.renderer.toneMappingExposure
      },
      timeline: {
        keys: clone(W.keys || []),
        moves: clone(W.moves || []),
        range: clone(W.blocking?.blocking?.range || null)
      },
      framing: clone(E.worldShotNow()),
      room: this.room?.name || ''
    };
  },
  /*
   * APPLY TO SHOT: what Previz decided becomes what the shot is blocked with, so generation and Production ›
   * Generate use it (lib/previs-direction.js turns it into prompt words). The button lived in a decisions bar the
   * redesigned console stopped drawing, which left a staged camera unable to reach the shot at all.
   * Scouting a set keeps the camera, its keys and the staging here only (worldTimelineSave), so they are written to
   * the target shot first — the same write "Create shot from this view" makes — and then applied.
   */
  async previzApply() {
    const W = legacy.WORLD, t = this.target(), shotId = (t && t.id) || W.shotId;
    if (!shotId) return legacy.setStatus('Choose the shot to apply this to first (Choose target shot)');
    if (this.busy) return;
    this.busy = true;
    this.E.worldConsoleRender();
    try {
      if (W.scout) {
        if (!W.blocking?.blocking?.camera) throw new Error('Frame a camera view first');
        const b = clone(W.blocking.blocking);
        if (W.version?.id) await api(`/shots/${shotId}/world`, {method:'POST',body:JSON.stringify({world_version_id:W.version.id})});
        await api(`/shots/${shotId}/previs`, {method:'PUT',body:JSON.stringify({...b,
          camera:{...b.camera,focalMm:W.lens || b.camera.focalMm || 35},durationMs:W.durationMs,
          cameraKeys:clone(W.keys || []),moves:clone(W.moves || [])})});
      }
      // With the framing Previz shows (worldApplyBody), so Generate's Framing follows the camera, not the old card.
      await api(`/shots/${shotId}/previs/apply`, {method:'POST',body:this.E.worldApplyBody ? this.E.worldApplyBody() : '{}'});
      legacy.setStatus(`Applied to ${(t && t.shot_code) || 'the shot'}: Production › Generate now uses this camera, move and staging (anything you changed there stays).`);
    } catch (err) { legacy.setStatus('Could not apply: ' + err.message); }
    finally { this.busy = false; this.E.worldConsoleRender(); }
  },
  async previzCapture() {
    if (this.busy) return;
    this.busy = true;
    const revision = this.revision;
    try {
      const capture = await this.capture(),
        result = await api('/previz-workspace/capture', {
          method: 'POST',
          body: JSON.stringify(capture)
        });
      if (revision !== this.revision) {
        await api(`/previz-workspace/reviews/${result.review.id}/cancel`, {
          method: 'POST',
          body: '{}'
        });
        return;
      }
      this.pending = {
        ...result,
        kind: 'draft',
        revision,
        capture
      };
      this.reviewHtml();
    } catch (err) {
      legacy.setStatus(err.message);
    } finally {
      this.busy = false;
      this.E.worldConsoleRender();
    }
  },
  async previzRenderReview() {
    if (this.busy || !this.draft) return;
    this.busy = true;
    const revision = this.revision,
      draft = this.draft;
    try {
      const result = await api(`/previz-workspace/${draft.snapshot_id}/render-review`, {
        method: 'POST',
        body: '{}'
      });
      if (revision !== this.revision) {
        if (result.review) await api(`/previz-workspace/reviews/${result.review.id}/cancel`, {
          method: 'POST',
          body: '{}'
        });
        return;
      }
      this.pending = {
        ...result,
        kind: 'render',
        revision
      };
      this.reviewHtml();
    } catch (err) {
      legacy.setStatus(err.message);
    } finally {
      this.busy = false;
    }
  },
  reviewHtml() {
    const p = this.pending,
      s = p.snapshot,
      esc = legacy.esc;
    legacy.showModalHtml('previzFrozenReview', `<div class="pv-frozen-review"><span class="pv-review-label">${p.kind === 'draft' ? 'PREVIZ DRAFT' : 'BLENDER RENDER'} · REVIEW</span><h2>${p.kind === 'draft' ? 'Save the captured camera view' : 'Render the saved shot setup'}</h2><img alt="Actual captured browser preview" src="${esc(legacy.mediaUrl(`/film/previz-workspace/${p.snapshot_id}/preview`))}"><dl><dt>Target shot</dt><dd>${esc(s.target.shot_code)} · ${esc(s.target.location)}</dd><dt>Destination</dt><dd>Storyboard / ${esc(s.target.shot_code)} / New version</dd><dt>Set / room</dt><dd>${esc(s.world.name)} · v${s.world.version} · ${esc(s.room || 'Free camera')}</dd><dt>Camera</dt><dd>${Number(s.camera.lens_mm.toFixed(2))}mm · ${s.frame.width}×${s.frame.height} · frame at ${s.frame.playhead_ms}ms</dd><dt>Characters / props</dt><dd>${s.subjects.length ? s.subjects.map(x => esc(x.name || 'Subject')).join(', ') : 'None staged'}</dd><dt>Lighting</dt><dd>${p.kind === 'draft' ? (s.lights.mode === 'native' ? 'Browser preview and work lights' : 'Browser lighting rig and mood') : (s.lights.mode === 'native' ? 'Native set lighting' : 'Approved lighting rig and mood')}</dd></dl>${p.blockers?.length ? `<div class="pv-render-blockers"><b>Rendering is blocked</b><ul>${p.blockers.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}<p>The target, source version and setup are frozen. Later changes require another capture. ${p.kind === 'render' ? 'Browser materials and lighting are a preview approximation; Cycles CPU uses the native scene materials.' : 'Browser glTF materials and work lights are approximate; this saves the captured preview.'}</p><details><summary>Exact captured setup</summary><pre>${esc(JSON.stringify(s, null, 2))}</pre></details><div class="btn-row"><button class="btn btn-secondary" onclick="previzCancel()">Back to blocking</button><button class="btn btn-primary" onclick="previzSend()"${!p.review ? ' disabled' : ''}>${p.kind === 'draft' ? 'Approve & save draft' : 'Approve & render'}</button></div></div>`);
    legacy.showModal('previzFrozenReview');
  },
  async previzSend() {
    const p = this.pending;
    if (!p?.review || p.sending) return;
    const W = legacy.WORLD;
    if (p.revision !== this.revision || p.snapshot.target.id !== W.targetId || p.snapshot.world.version_id !== W.version?.id) {
      await this.previzCancel();
      return legacy.setStatus('The camera or set changed after this capture. Capture it again.');
    }
    p.sending = true;
    try {
      if (!p.token) p.token = await api(`/previz-workspace/reviews/${p.review.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          fingerprint: p.review.fingerprint,
          human_confirmed: true
        })
      });
      if (p !== this.pending || p.revision !== this.revision) {
        if (p === this.pending) {
          await this.previzCancel();
          return legacy.setStatus('The camera or set changed after this capture. Capture it again.');
        }
        await api(`/previz-workspace/reviews/${p.review.id}/cancel`, {
          method: 'POST',
          body: '{}'
        });
        return;
      }
      const result = await api(`/previz-workspace/reviews/${p.review.id}/${p.kind === 'draft' ? 'draft' : 'render'}`, {
        method: 'POST',
        body: JSON.stringify(p.token)
      });
      if (p === this.pending) {
        legacy.closeModal('previzFrozenReview');
        this.pending = null;
      }
      if (p.revision === this.revision && W.targetId === p.snapshot.target.id) {
        this.draft = p.kind === 'draft' ? result : this.draft;
        const target = this.target();
        if (target) target.storyboard_image = result.url;
        W.targetFrame = {
          src: result.url,
          asset_id: result.asset_id,
          asset_version: result.version
        };
        this.E.worldConsoleRender();
      }
      legacy.setStatus(`Saved ${p.snapshot.target.shot_code} v${result.version} · ${result.kind === 'previz_draft' ? 'browser preview' : 'Blender render'}`);
    } catch (err) {
      legacy.setStatus(err.message);
      // The status line sits behind the modal: say it where the button was pressed.
      const box = document.querySelector('#previzFrozenReview .pv-frozen-review');
      if (box && p === this.pending) {
        let line = box.querySelector('.pv-review-error');
        if (!line) { line = document.createElement('p'); line.className = 'pv-review-error'; box.querySelector('.btn-row')?.before(line); }
        line.textContent = /cannot be retried|fingerprint|changed/i.test(err.message)
          ? `Not saved: ${err.message} Go back to blocking and capture again.` : `Not saved: ${err.message}`;
      }
    } finally {
      p.sending = false;
    }
  },
  async previzCancel() {
    const p = this.pending;
    this.pending = null;
    legacy.closeModal('previzFrozenReview');
    if (p?.review) try {
      await api(`/previz-workspace/reviews/${p.review.id}/cancel`, {
        method: 'POST',
        body: '{}'
      });
    } catch (err) {
      legacy.setStatus(err.message);
    }
  }
};
