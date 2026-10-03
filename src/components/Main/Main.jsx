import { memo, useSyncExternalStore } from 'react';
import LegacyElement from '../LegacyElement.jsx';
import PageBoundary from '../PageBoundary.jsx';
import { projectEpoch, subscribeProjectEpoch } from '../../lib/project-epoch.js';
import { PAGES } from '../../pages/registry.js';
import { MODALS } from '../modals/index.js';

// Every page's markup is mounted here at boot (pages read ids out of each
// other's markup); only a page's code waits for its first visit.
export default memo(function Main() {
    // React pages are mounted per open project (src/lib/project-epoch.js); legacy markup is mounted once.
    const epoch = useSyncExternalStore(subscribeProjectEpoch, projectEpoch);
    return (
        <LegacyElement html={'<div class="main"></div>'}>
            {/* Each page in its own boundary: one page's render error never unmounts the app (PageBoundary.jsx). */}
            {PAGES.map(({ id, Component, react }) => <PageBoundary key={react ? `${id}:${epoch}` : id} name={'page ' + id} pageId={id}><Component /></PageBoundary>)}
            {MODALS.filter(m => m.inMain).map(m => <LegacyElement key={m.id} html={m.html} />)}
        </LegacyElement>
    );
});
