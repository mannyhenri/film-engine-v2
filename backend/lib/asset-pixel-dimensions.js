'use strict';
const fs = require('fs');

// Storyboard deliveries are PNG. Read a fixed header from the actual selected
// picture, never a requested resolution or legacy width/height columns. A
// regular-file check and nonblocking open exclude pipes/devices. No decoder,
// process, whole-file allocation or unbounded JPEG marker walk runs on GET.
function imagePixels(filePath) {
    let fd;
    try {
        if (!filePath || !fs.statSync(filePath).isFile()) return null;
        fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        const head = Buffer.alloc(33);
        if (fs.readSync(fd, head, 0, head.length, 0) !== head.length) return null;
        if (!head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            || head.readUInt32BE(8) !== 13 || head.toString('ascii', 12, 16) !== 'IHDR') return null;
        const width = head.readUInt32BE(16), height = head.readUInt32BE(20);
        return width > 0 && height > 0 && width <= 0x7fffffff && height <= 0x7fffffff ? { width, height } : null;
    } catch (_) { return null; }
    finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} } }
}

function imageWasUpscaled(asset) {
    try { return JSON.parse(asset?.metadata || '{}').direction_mode === 'upscale'; }
    catch (_) { return false; }
}
module.exports = { imagePixels, imageWasUpscaled };
