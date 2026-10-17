'use strict';
/**
 * WHAT THE ASSEMBLE TAB CAN TAKE IN, AND WHERE EACH FILE LANDS.
 *
 * Derived from MEDIA_KINDS (what can be uploaded, and whether it belongs to a
 * shot or a scene) and the project folder layout (lib/project-folders.js), so
 * a file dropped on a node goes through the same import as every other upload
 * and is filed where the project already keeps that kind: no second opinion
 * about folders, and nothing for the director to move by hand.
 */
const { MEDIA_KINDS } = require('./media-kinds');
const { PROJECT_LAYOUT } = require('./project-folders');

/** The library section each capability is shown under. */
const SECTION = { video: 'video', lipsync: 'video', post: 'video', voice: 'dialogue', sfx: 'sfx', music: 'music', ambient: 'music' };
const LABEL = { video: 'Video', dialogue: 'Dialogue', sfx: 'Sound effects', music: 'Music' };

function assembleKinds() {
    return Object.values(MEDIA_KINDS).filter(k => k.media !== 'image').map(k => {
        const section = SECTION[k.capability] || (k.media === 'video' ? 'video' : 'sfx');
        const spec = PROJECT_LAYOUT[k.subdir];
        return { capability: k.capability, section, section_label: LABEL[section], media: k.media, scope: k.scope,
            asset_type: k.assetType, folder: spec ? spec.folder : `Other/${k.subdir}`,
            route: `/${k.scope === 'scene' ? 'scenes' : 'shots'}/:id/media/${k.capability}/import` };
    });
}

module.exports = { assembleKinds, SECTION };
