import DrawnListControls from '../../lib/drawn-list.jsx';
import { legacy } from '../../lib/legacy.js';
import SURFACE from './list-surface.js';
const rows = () => (legacy.WORLD?.scoutable || []).map(set => ({ id: set.world.id, name: set.name }));
const keys = { row: row => row.id, el: node => node.dataset.setId };
export default function Lists() {
    return <>
        <DrawnListControls surface={SURFACE} container="fePanelShots" item=".pv-set-entry" rows={rows} keys={keys} />
        <DrawnListControls surface={SURFACE} container="weRail" item=".pv-set-entry" rows={rows} keys={keys} />
    </>;
}
