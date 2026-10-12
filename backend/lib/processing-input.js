const fs = require('node:fs');
const path = require('node:path');
const {PROJECT_LAYOUT} = require('./project-folders');
const {fail} = require('./depth-media');

/** A registry row identifies an asset; it does not grant access to a disk path. */
function ownedProcessingFile(storage, projectId, filename) {
    try {
        if (!path.isAbsolute(filename || '')) throw Error('Missing file path');
        const leaf = fs.lstatSync(filename);
        if (!leaf.isFile() || leaf.isSymbolicLink()) throw Error('Not a regular owned file');
        const real = fs.realpathSync(filename);
        for (const kind of Object.keys(PROJECT_LAYOUT)) {
            const root = storage.dirFor(projectId, kind);
            let canonicalRoot;
            try {canonicalRoot = fs.realpathSync(root);} catch (error) {
                if (error.code === 'ENOENT') continue;
                throw error;
            }
            const relative = path.relative(canonicalRoot, real);
            if (relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) {
                return {path: real, size: fs.statSync(real).size};
            }
        }
    } catch (error) {
        if (error.status) throw error;
    }
    throw fail('Processing input is outside this project’s managed media storage. Import an owned copy before using it.', 404);
}

module.exports = {ownedProcessingFile};
