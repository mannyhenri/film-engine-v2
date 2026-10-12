import { resolutionInfo } from '../../lib/media-resolution.js';

export default function ResolutionBadge({ pixels, upscaled }) {
    const info = resolutionInfo(pixels, { upscaled });
    return info?.label ? <span className="resolution-badge" title={info.title} aria-label={info.title}>{info.label}</span> : null;
}
