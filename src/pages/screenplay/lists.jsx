import DrawnListControls from '../../lib/drawn-list.jsx';
import * as E from './engine.js';
import SURFACE from './list-surface.js';

// The scene navigator the screenplay engine draws (updateSceneNavigator, into #sceneNavList), one item per scene the
// editor holds, read the way the engine reads them (parseSceneOutline). Enter goes to the scene, as clicking it does.
const scenes = () => (E.parseSceneOutline(document.getElementById('screenplayEditor')) || [])
    .map((s, index) => ({ ...s, index, cast: s.characters.join(', ') }));

export default function Lists() {
    return <DrawnListControls surface={SURFACE} container="sceneNavList" item=":scope > .scene-nav-item" rows={scenes}
        onFind={(s) => E.scrollToScene(s.index)} />;
}
