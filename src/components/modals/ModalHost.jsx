import { memo } from 'react';
import LegacyElement from '../LegacyElement.jsx';
import { MODALS } from './index.js';

// The modal overlays, all mounted and hidden; showModal(id) adds .open.
export default memo(function ModalHost() {
    return MODALS.filter(m => !m.inMain).map(m => <LegacyElement key={m.id} html={m.html} />);
});
