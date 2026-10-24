import { useEffect, useState } from 'react';
import { legacy } from '../../lib/legacy.js';

/*
 * Test mode is on: say so on every screen, so a click that would have spent credits is never mistaken
 * for a real generation, and a real one is never mistaken for a test. Read from the app settings,
 * and updated the moment Setup flips the switch.
 */
export default function TestModeBadge() {
    const [on, setOn] = useState(false);
    useEffect(() => {
        let live = true;
        legacy.api('/settings').then(r => { if (live) setOn(!!(r && r.settings && r.settings.generation_test_mode)); }).catch(() => {});
        const flip = e => setOn(!!(e.detail && e.detail.on));
        window.addEventListener('film:test-mode', flip);
        return () => { live = false; window.removeEventListener('film:test-mode', flip); };
    }, []);
    if (!on) return null;
    return <div role="status" aria-label="Test mode" className="test-mode-badge"
        style={{ position: 'fixed', right: 18, bottom: 38, zIndex: 1200, padding: '6px 12px', borderRadius: 999,
            background: 'var(--gl-warning, #b45309)', color: '#fff', fontSize: 12, fontWeight: 600, pointerEvents: 'none' }}>
        TEST MODE · Higgsfield requests are saved, not sent
    </div>;
}
