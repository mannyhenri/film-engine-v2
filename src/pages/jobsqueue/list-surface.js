// The Job Queue: search, sort and filter the project's generation jobs (src/lib/list-controls.jsx;
// src/pages/list-surfaces.test.jsx). Newest first is the default: the route's own order.
export default {
    id: 'jobsqueue', noun: 'jobs',
    search: ['job_type', 'prompt', 'model', 'error_message', 'id'],
    sorts: [
        { id: 'newest', label: 'Newest first', field: 'created_at', dir: 'desc' },
        { id: 'oldest', label: 'Oldest first', field: 'created_at', dir: 'asc' },
        { id: 'type', label: 'Job type', field: 'job_type', dir: 'asc' },
    ],
    filters: [
        { id: 'status', label: 'Status', field: 'status' },
        { id: 'type', label: 'Type', field: 'job_type' },
        { id: 'model', label: 'Model', field: 'model' },
    ],
};
