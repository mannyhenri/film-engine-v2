import { memo } from 'react';
import LegacyElement from '../LegacyElement.jsx';
import html from './sidebar.html?raw';

// The project list and the project's page nav. shell.js later moves the
// .nav-item buttons into the phase panel; they keep their onclick and data-page.
export default memo(function Sidebar() {
    return <LegacyElement html={html} />;
});
