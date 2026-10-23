import { useEffect, useRef, useState } from 'react';

/*
 * A finished model, turned in the hand: drag to orbit, wheel to zoom, double-click to frame it again. three.js and its
 * GLTF loader are the page's vendors (react.json), so they are on window by the time the page draws. The file is the
 * model's own .glb (/film/models/:id/file), textures and all; Previz strips materials, this does not.
 */
export default function ModelViewer({ url, name, onClose }) {
    const host = useRef(null);
    const [state, setState] = useState('loading');   // loading | ready | error text

    useEffect(() => {
        const T = window.THREE, el = host.current;
        if (!T || !T.GLTFLoader || !el) { setState('The 3D viewer is not available here.'); return undefined; }
        let renderer;
        try { renderer = new T.WebGLRenderer({ antialias: true, alpha: false }); }
        catch (_) { setState('This computer could not start the 3D viewer (no WebGL).'); return undefined; }
        const w = () => el.clientWidth || 800, h = () => el.clientHeight || 500;
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.setSize(w(), h());
        if ('outputEncoding' in renderer && T.sRGBEncoding) renderer.outputEncoding = T.sRGBEncoding;
        renderer.setClearColor(0x16161a);
        el.appendChild(renderer.domElement);
        const scene = new T.Scene();
        scene.add(new T.HemisphereLight(0xffffff, 0x404048, 1.1));
        const sun = new T.DirectionalLight(0xffffff, 1.2); sun.position.set(3, 5, 4); scene.add(sun);
        const camera = new T.PerspectiveCamera(40, w() / h(), 0.01, 5000);
        const orbit = { yaw: 0.7, pitch: 0.35, dist: 4, target: new T.Vector3() };
        let fit = { dist: 4, target: new T.Vector3() }, root = null, raf = 0, alive = true;
        const place = () => {
            const cp = Math.cos(orbit.pitch);
            camera.position.set(orbit.target.x + orbit.dist * cp * Math.sin(orbit.yaw), orbit.target.y + orbit.dist * Math.sin(orbit.pitch),
                orbit.target.z + orbit.dist * cp * Math.cos(orbit.yaw));
            camera.lookAt(orbit.target);
        };
        const frame = () => { orbit.dist = fit.dist; orbit.target.copy(fit.target); orbit.yaw = 0.7; orbit.pitch = 0.35; };
        const loop = () => { if (!alive) return; place(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
        new T.GLTFLoader().load(url, gltf => {
            if (!alive) return;
            root = gltf.scene; scene.add(root);
            const box = new T.Box3().setFromObject(root), size = box.getSize(new T.Vector3()), c = box.getCenter(new T.Vector3());
            const r = Math.max(size.x, size.y, size.z) || 1;
            const grid = new T.GridHelper(r * 3, 12, 0x444450, 0x2a2a30); grid.position.y = box.min.y; scene.add(grid);
            fit = { dist: r * 1.9, target: c };
            camera.near = r / 200; camera.far = r * 200; camera.updateProjectionMatrix();
            frame(); setState('ready');
        }, undefined, err => alive && setState('The model could not be loaded: ' + (err?.message || 'unreadable file')));
        loop();

        let drag = null;
        const down = e => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture?.(e.pointerId); };
        const move = e => {
            if (!drag) return;
            orbit.yaw -= (e.clientX - drag.x) * 0.008;
            orbit.pitch = Math.max(-1.45, Math.min(1.45, orbit.pitch + (e.clientY - drag.y) * 0.008));
            drag = { x: e.clientX, y: e.clientY };
        };
        const up = () => { drag = null; };
        const wheel = e => { e.preventDefault(); orbit.dist = Math.max(fit.dist * 0.05, Math.min(fit.dist * 8, orbit.dist * Math.exp(e.deltaY * 0.001))); };
        const resize = () => { renderer.setSize(w(), h()); camera.aspect = w() / h(); camera.updateProjectionMatrix(); };
        el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
        el.addEventListener('wheel', wheel, { passive: false }); el.addEventListener('dblclick', frame);
        window.addEventListener('resize', resize);
        return () => {
            alive = false; cancelAnimationFrame(raf);
            el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
            el.removeEventListener('wheel', wheel); el.removeEventListener('dblclick', frame); window.removeEventListener('resize', resize);
            scene.traverse(o => { o.geometry?.dispose?.(); [].concat(o.material || []).forEach(m => { Object.values(m).forEach(v => v?.isTexture && v.dispose()); m.dispose?.(); }); });
            renderer.dispose(); renderer.domElement.remove();
        };
    }, [url]);

    useEffect(() => {
        const key = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [onClose]);

    return (
        <div className="md-viewer-overlay" role="dialog" aria-modal="true" aria-label={`3D model: ${name}`} onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="md-viewer">
                <header><strong>{name}</strong><span className="text-muted text-sm">Drag to turn · scroll to zoom · double-click to frame</span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Close the viewer">Close</button></header>
                <div className="md-viewer-stage" ref={host}>
                    {state !== 'ready' && <div className="md-viewer-note" role="status">{state === 'loading' ? 'Loading the model…' : state}</div>}
                </div>
            </div>
        </div>
    );
}
