-- JOB QUEUE "CLEAR": finished jobs the director cleared from the Job Queue, kept out of its list and its badge.
-- Only hidden: the jobs stay in their own tables (film_video_jobs, film_music_jobs…), which other routes read for a take's
-- source, a model's job, a retry. Per job, so a job still running when the queue was cleared shows when it finishes.
CREATE TABLE film_job_queue_cleared (
    project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL,
    cleared_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, job_id)
);
