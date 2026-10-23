import ModelsStudio from './ModelsStudio.jsx';

/*
 * The 3D models page: ModelsStudio (characters on Meshy; locations and props built in Blender by Astra; a 3D viewer;
 * second passes). It replaced the frame the Previs engine used to draw into (loadThreeD in src/pages/previs/engine.js,
 * kept there for Previs). The page answers to the loader name "loadThreeD" itself (usePageLoader in ModelsStudio).
 */
export default function ThreeDPage() {
    return (
        <div className="page" id="page-threed">
            <ModelsStudio />
        </div>
    );
}
