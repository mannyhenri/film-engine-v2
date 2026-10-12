'use strict';
const ROLES = Object.freeze(['style', 'colors', 'lighting', 'angle', 'framing', 'texture']);
function rolesOf(value) {
    let roles;
    try { roles = typeof value === 'string' ? JSON.parse(value) : value; }
    catch (_) { throw Object.assign(new Error('Moodboard influence roles are invalid. Restore or edit this reference before generating.'), {status:400,code:'MOODBOARD_REFERENCE_UNSENDABLE'}); }
    if (!Array.isArray(roles) || !roles.length || roles.some(r => !ROLES.includes(r)) || new Set(roles).size !== roles.length) {
        throw Object.assign(new Error('Choose one or more Moodboard influence roles: ' + ROLES.join(', ')), { status: 400, code: 'MOODBOARD_REFERENCE_UNSENDABLE' });
    }
    return roles;
}
function instruction(ref, position) {
    const roles = rolesOf(ref.influence_roles);
    return `Reference ${position}: Moodboard visual influence only (${roles.join(', ')})${ref.influence_note ? ` — ${ref.influence_note}` : ''}. Preserve the requested subjects, identity, location and products; do not copy subjects from this look reference`;
}
function instructions(refs) {
    return (refs || []).flatMap((ref, i) => ref.moodboard_entry_id ? [instruction(ref, i + 1)] : []).join('. ');
}
function assertSelectedFit(candidates, selected, limit) {
    const missing = candidates.filter(r => r.moodboard_entry_id && !selected.some(s => s.moodboard_entry_id === r.moodboard_entry_id));
    if (missing.length) throw Object.assign(new Error(`Moodboard references cannot all reach generation (provider capacity ${limit} slots, shared with identity/location/product references). Restore unreadable images, deactivate references, or choose a provider with more slots. Missing: ${missing.map(r=>r.name).join(', ')}`), {status:409,code:'MOODBOARD_REFERENCE_UNSENDABLE'});
}
function exactUri(ref) {
    const fs = require('fs'), file = ref.file_path || ref.path;
    try {
        const bytes = fs.readFileSync(file);
        if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Image must be between 1 byte and 20 MB');
        const mime = ({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'})[require('path').extname(file).toLowerCase()];
        if (!mime) throw new Error('Unsupported image format');
        return `data:${mime};base64,${bytes.toString('base64')}`;
    } catch (error) { throw Object.assign(new Error(`Moodboard image is unreadable: ${ref.name}. Restore/replace it or deactivate it. ${error.message}`),{status:409,code:'MOODBOARD_REFERENCE_UNSENDABLE'}); }
}
// Called at the shared image-provider boundary as well as the plate builders.
// Refine/recompose/alternate shot paths cannot bypass a project's active look.
function includeInPayload(db, projectId, payload, provider) {
    const candidates = require('./look-development').styleReferences(db, projectId);
    if (!candidates.length) return payload;
    if (!provider?.supportsReferenceImages) throw Object.assign(new Error('This provider does not support Moodboard image conditioning. Choose a supported provider or deactivate the images.'), {status:409,code:'MOODBOARD_REFERENCE_UNSENDABLE'});
    const existing = payload.reference_images || [], look = existing.filter(ref => ref.moodboard_entry_id);
    // Keep subject/expression order from a composed shot when the board is already complete.
    const complete = look.length === candidates.length && candidates.every(ref => look.some(r => r.moodboard_entry_id === ref.moodboard_entry_id));
    const refs = complete ? existing : [...existing.filter(ref => !ref.moodboard_entry_id), ...require('./reference-images').selectReferences(candidates, {limit:Number.MAX_SAFE_INTEGER})];
    if (refs.length > (provider.maxReferenceImages || 3)) throw Object.assign(new Error(`Moodboard references exceed provider capacity (${provider.maxReferenceImages || 3} slots shared with identity/location/product references). Deactivate images or choose a provider with more slots.`), {status:409,code:'MOODBOARD_REFERENCE_UNSENDABLE'});
    let prompt = payload.prompt || '';
    refs.forEach((ref,i) => { if (ref.moodboard_entry_id) { const text=instruction(ref,i+1); if (!prompt.includes(text)) prompt += '. ' + text; } });
    return {...payload,reference_images:refs,prompt};
}
module.exports = { ROLES, rolesOf, instruction, instructions, assertSelectedFit, exactUri, includeInPayload };
