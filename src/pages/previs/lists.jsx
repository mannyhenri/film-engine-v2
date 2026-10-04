import DrawnListControls from '../../lib/drawn-list.jsx';
import { legacy } from '../../lib/legacy.js';
import SURFACE from './list-surface.js';

/*
 * The shot list the previs engine draws, from core's WORLD.shots: in the app's side panel (worldSyncPanelShots, into
 * #fePanelShots) with the console layout on, which is the default, else in the console's own rail (worldRailHtml, in
 * #worldConsole). Each button selects its shot by id (onclick="worldRailSelect('<id>')"), which is how it is matched.
 */
const rows = () => (legacy.WORLD && legacy.WORLD.shots) || [];
const keys = { row: (r) => r.id, el: (n) => (n.getAttribute('onclick').match(/'([^']+)'/) || [])[1] };

export default function Lists() {
    return (
        <>
            <DrawnListControls surface={SURFACE} container="fePanelShots" item={'button.pv-shot[onclick^="worldRailSelect"]'} rows={rows} keys={keys} />
            <DrawnListControls surface={SURFACE} container="worldConsole" item={'button.we-shot[onclick^="worldRailSelect"]'} rows={rows} keys={keys} />
        </>
    );
}
