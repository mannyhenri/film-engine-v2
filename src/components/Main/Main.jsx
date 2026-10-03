import { memo } from 'react';
import LegacyElement from '../LegacyElement.jsx';
import { PAGES } from '../../pages/registry.js';
import { MODALS } from '../modals/index.js';

// Every page's markup is mounted here at boot (pages read ids out of each
// other's markup); only a page's code waits for its first visit.
export default memo(function Main() {
    return (
        <LegacyElement html={'<div class="main"></div>'}>
            {PAGES.map(({ id, Component }) => <Component key={id} />)}
            {MODALS.filter(m => m.inMain).map(m => <LegacyElement key={m.id} html={m.html} />)}
        </LegacyElement>
    );
});
