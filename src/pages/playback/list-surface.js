// Playback: find a shot in the cut (src/lib/list-controls.jsx; held by src/pages/list-surfaces.test.jsx and, on the
// page, src/pages/list-wiring.test.jsx). Find, not filter: the playlist is the film, so nothing leaves it and nothing
// moves; matches are marked, and Enter goes to the shot.
export default {
    id: 'playback', noun: 'shots',
    search: ['shot_code', 'start_timecode'],
    sorts: [],
    why: 'the playlist is the running order of the film; playing it reads that order',
    filters: [],
    mode: 'find',
};
