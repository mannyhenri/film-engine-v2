// The set of lists that grow with the film, each with its owner, and those not wired yet. Read by
// src/pages/list-surfaces.test.jsx (the declarations) and src/pages/list-wiring.test.jsx (the pages use them).
export const REQUIRED = {
    // film-engine-v2 agent
    characters: 'v2', locations: 'v2', props: 'v2', scenes: 'v2', storyboard: 'v2', consistency: 'v2',
    assets: 'v2', jobsqueue: 'v2', notes: 'v2', renderhistory: 'v2', moodboard: 'v2', stylebook: 'v2', marketing: 'v2',
    subtitles: 'v2', titles: 'v2', rights: 'v2', deliverables: 'v2', projects: 'v2',
    // film-engine agent
    productiongraph: 'fe', screenplay: 'fe',
    previs: 'fe', threed: 'fe', edits: 'fe', budget: 'fe',
};
// Not wired yet, each with its owner (REQUIRED); an owner removes a name here in the commit that wires it.
export const PENDING = new Set([
]);
