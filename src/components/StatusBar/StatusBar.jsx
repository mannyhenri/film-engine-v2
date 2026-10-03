import { memo } from 'react';
import LegacyElement from '../LegacyElement.jsx';
import html from './status-bar.html?raw';

export default memo(function StatusBar() {
    return <LegacyElement html={html} />;
});
