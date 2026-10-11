// V2's API contract identity prevents reuse of a retiring legacy backend.
const backendId = 'film-engine-v2:meshy-6-lite-v1';
function matchesBackend(health, version) {
    return Boolean(health && health.service === 'film-engine'
        && health.version === version && health.backend_id === backendId);
}
function matchesWritingBackend(health,version) {
    return matchesBackend(health,version) && health.capabilities?.ai_connections===1
        && health.capabilities?.application_ai_workspace===1;
}
module.exports = { backendId, matchesBackend, matchesWritingBackend };
