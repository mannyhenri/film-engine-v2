import { usePageLoader } from '../../lib/usePageLoader.js';
import * as E from '../previs/engine.js';
import Lists from './lists.jsx';

/*
 * The 3D models page, as React: its frame. Its loader and everything it draws are the 3D stage engine's (src/pages/previs/engine.js, owned by the Previs page, which registers the engine on window). It declares three.js (react.json vendors), loaded before the loader.
 *
 * The frame is GENERATED from the legacy markup by tools/make-react-page.js (tools/html-to-jsx.js); its test holds it
 * to the reference markup element by element. Regenerate it rather than editing the frame by hand.
 */
export default function ThreeDPage() {
    usePageLoader('loadThreeD', E.loadThreeD);

    return (
        <>
            <Lists />
        <div className="page" id="page-threed">
            {' '}
            <div className="flex-between mb-16">
                {' '}
                <h2>
                    3D Models
                </h2>
                {' '}
                <div style={{ "display": "flex", "gap": "8px", "flexWrap": "wrap" }}>
                    {' '}
                    <label className="btn btn-secondary" style={{ "cursor": "pointer" }}>
                        {" Import GLB "}
                        <input data-import-target="three-d-model" type="file" accept=".glb,model/gltf-binary" style={{ "display": "none" }} onChange={(event) => E.importThreeDModel(event.nativeEvent)} />
                        {' '}
                    </label>
                    {' '}
                    <button className="btn btn-primary" onClick={(event) => E.generateAllModels()}>
                        Generate All Models
                    </button>
                    {' '}
                </div>
                {' '}
            </div>
            {' '}
            <div id="threedProgress" style={{ "display": "none" }} className="mb-16">
                {' '}
                <div className="text-sm text-muted mb-8" id="threedProgressLabel">
                    Starting...
                </div>
                {' '}
                <div style={{ "background": "var(--gl-bg-surface)", "borderRadius": "var(--gl-radius-md)", "height": "10px", "overflow": "hidden" }}>
                    {' '}
                    <div id="threedProgressBar" style={{ "height": "100%", "width": "0%", "background": "var(--gl-accent,#6366f1)", "transition": "width .2s" }}></div>
                    {' '}
                </div>
                {' '}
            </div>
            {' '}
            <h3 className="mb-8" style={{ "fontSize": "13px", "textTransform": "uppercase", "letterSpacing": "1px", "color": "var(--gl-text-muted)" }}>
                Subjects
            </h3>
            {' '}
            <div className="entity-grid mb-16" id="threedSubjects" style={{ "gridTemplateColumns": "repeat(auto-fill,minmax(240px,1fr))" }}></div>
            {' '}
            <h3 className="mb-8" style={{ "fontSize": "13px", "textTransform": "uppercase", "letterSpacing": "1px", "color": "var(--gl-text-muted)" }}>
                Generated Models
            </h3>
            {' '}
            <div className="entity-grid" id="threedModels" style={{ "gridTemplateColumns": "repeat(auto-fill,minmax(240px,1fr))" }}></div>
            {' '}
        </div>
        </>
    );
}
