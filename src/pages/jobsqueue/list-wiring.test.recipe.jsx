// How jobsqueue's list is mounted for src/pages/list-wiring.test.jsx.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import { drawn } from '../list-wiring.helpers.js';

export default {
    rowKey: r => r.id,
    async open() {
        const rows = [
            { id: 'job-one', job_type: 'video', status: 'complete', prompt: 'slow push', model: 'kling', error_message: 'none-a', created_at: '2026-01-03' },
            { id: 'job-two', job_type: 'image', status: 'failed', prompt: 'wide shot', model: 'flux', error_message: 'quota', created_at: '2026-01-01' },
            { id: 'job-tri', job_type: 'voice', status: 'queued', prompt: 'line read', model: 'eleven', error_message: 'none-c', created_at: '2026-01-02' },
        ];
        installLegacy({ routes: { 'GET /projects/p1/jobs': { total: 3, summary: {}, jobs: rows } } });
        const Page = (await import('./JobsQueuePage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadJobsQueuePage(); });
        return { rows, keys: drawn('#jobsQueueList [data-job-id]', 'data-job-id') };
    },
};
