/**
 * Draft, production, hero — as POLICY, not as model names.
 *
 * `draft = H3, production = Seedance` would be an alias table, and it would be
 * wrong within a month: the model leaderboard moves faster than this file. A
 * tier states what the director WANTS — how cheap, how good, how many attempts
 * are reasonable — and the model that satisfies it is a separate decision that
 * will eventually be made by a router from real acceptance data.
 *
 * `preferredModel` is the answer until that data exists. `hero` deliberately
 * has none: the most expensive generation in the production is the one that
 * should not be chosen by a default.
 *
 * Mirrors lib/quality-tiers.js, which does this for images.
 */
const VIDEO_TIERS = Object.freeze({
    draft: Object.freeze({
        label: 'Draft',
        why: 'Is the blocking right? Not: is it beautiful. Seedance 2.5 at 480p on Higgsfield is '
            + '3 credits a second, so a five-second answer costs 15 credits and trying three angles '
            + 'is a decision about taste rather than about budget.',
        preferredModel: 'seedance_2_5',
        durationSeconds: 5,
        resolution: '480p',
        references: 'keyframe',
        qualityPriority: 'low',
        costPriority: 'high',
        maxAttempts: 2,
    }),
    production: Object.freeze({
        label: 'Production',
        why: 'The shot as it will be cut. Seedance 2.5 on Higgsfield takes up to 30 reference '
            + 'images at no extra charge, so the cast and the location travel with every clip; '
            + '720p is 7 credits a second.',
        preferredModel: 'seedance_2_5',
        durationSeconds: 10,
        resolution: '720p',
        references: 'role-based',
        qualityPriority: 'high',
        costPriority: 'normal',
        maxAttempts: 3,
    }),
    hero: Object.freeze({
        label: 'Hero',
        why: 'The shot the film is judged on. Deliberately has no preferred model: this is '
            + 'the most expensive generation in the production and it should be a decision, '
            + 'made by a director or by a router with real acceptance data behind it.',
        preferredModel: null,
        durationSeconds: null,
        resolution: null,
        references: 'role-based',
        qualityPriority: 'maximum',
        costPriority: 'low',
        maxAttempts: 5,
    }),
});

const DEFAULT_VIDEO_TIER = 'production';

/** The tier a name asks for, falling back to production rather than to nothing. */
function resolveVideoTier(name) {
    const id = String(name || '').trim().toLowerCase();
    return VIDEO_TIERS[id] ? { id, ...VIDEO_TIERS[id] } : { id: DEFAULT_VIDEO_TIER, ...VIDEO_TIERS[DEFAULT_VIDEO_TIER] };
}

/** For a picker: what each tier is, in the director's terms. */
function videoTierMenu() {
    return Object.entries(VIDEO_TIERS).map(([id, t]) => ({
        id, label: t.label, why: t.why, preferredModel: t.preferredModel, maxAttempts: t.maxAttempts,
    }));
}

module.exports = { VIDEO_TIERS, DEFAULT_VIDEO_TIER, resolveVideoTier, videoTierMenu };
