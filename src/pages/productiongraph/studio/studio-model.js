/*
 * Production Studio, the pure part: what the Generate and Cut tabs derive
 * from the production graph, with no fetching and no React.
 *
 * The graph (GET /projects/:id/production-graph) already carries every shot
 * with its frames and clips, every sequence with its members and versions, and
 * every sound attached to a node as a timeline audio track. The tabs read it;
 * they do not keep a second copy of the film. A cut's layout comes from the
 * server (routes/production-cuts.js); here only the order and the lanes.
 */

const byOrder = (graph) => {
    const order = new Map((graph?.running_order || []).map((k, i) => [k, i]));
    return (a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9) || (a.scene_number || 0) - (b.scene_number || 0) || String(a.shot_code).localeCompare(String(b.shot_code), undefined, { numeric: true });
};

/** Shots grouped by scene, in running order. */
export function scenesOf(graph) {
    const shots = (graph?.nodes || []).filter(n => n.type === 'shot').sort(byOrder(graph));
    const scenes = [];
    for (const s of shots) {
        let sc = scenes.find(x => x.id === s.scene_id);
        if (!sc) scenes.push(sc = { id: s.scene_id, label: s.scene_label || `Scene ${s.scene_number || ''}`.trim(), shots: [] });
        sc.shots.push(s);
    }
    return scenes;
}

export const secondsOf = (ms) => Math.max(1, Math.round((Number(ms) || 5000) / 1000));

/** An existing sequence holding exactly these shots in this order, if there is one. */
export function matchingSequence(graph, shotIds) {
    return (graph?.nodes || []).find(n => n.type === 'sequence' && n.shot_ids?.length === shotIds.length && n.shot_ids.every((id, i) => id === shotIds[i])) || null;
}

/** References from the shots' starter recipes, deduplicated by their source, in order. */
export function collectReferences(recipes) {
    const seen = new Set(), out = [];
    let start = null;
    for (const r of recipes) {
        const frame = r?.init_image || r?.image_url || (Array.isArray(r?.keyframes) ? r.keyframes[0] : null);
        if (!start && frame && !frame.unresolved) start = frame;
        for (const ref of r?.reference_images || []) {
            const id = ref.asset_id || ref.moodboard_entry_id || ref.sha256;
            if (!id || ref.unresolved || seen.has(id)) continue;
            seen.add(id); out.push(ref);
        }
    }
    return { start, references: out };
}

/** The brief the recommender reads. */
export function briefOf({ shots, prompt, references, start, aspect = '16:9', resolution }) {
    return { prompt, duration_s: shots.reduce((a, s) => a + secondsOf(s.duration_ms), 0), aspect, resolution,
        shot_count: shots.length, reference_count: references.length, has_start_frame: !!start,
        dialogue: shots.some(s => Number(s.dialogue_lines) > 0) };
}

/**
 * The Production draft recipe for Higgsfield: the same draft the old graph
 * saved, with the provider and model chosen here. References beyond the
 * model's limit are left out rather than sent and refused.
 */
export function higgsfieldRecipe({ model, prompt, references, start, durationS, aspect, resolution, audio, maxImages, startFrame = true }) {
    // A model with no first-frame input (Cinema Studio) still sees the keyframe, as its first reference picture.
    const asFrame = start && startFrame;
    const pictures = asFrame || !start ? references : [start, ...references];
    // The signed-in Higgsfield connection runs the app's own models by their app ids (seedance_2_5, kling3_0…).
    const recipe = { provider: 'higgsfield-mcp', model, prompt,
        settings: { duration_s: durationS, aspect_ratio: aspect, generate_audio: !!audio, ...(resolution ? { resolution } : {}) },
        reference_images: pictures.slice(0, Math.max(0, (maxImages ?? pictures.length) - (asFrame ? 1 : 0))), audio_references: [] };
    if (asFrame) recipe.init_image = start;
    return recipe;
}

/** The sound kinds a cut wires, in lane order, with what each is called and where its files go. */
export const CUT_KINDS = [
    { id: 'music', label: 'Music', color: '#c08bff', capability: 'music', lane: 'A4 MUS' },
    { id: 'sfx', label: 'Sound effect', color: '#57c98a', capability: 'sfx', lane: 'A2 SFX', generates: true },
    { id: 'ambient', label: 'Ambience', color: '#4fb6c9', capability: 'ambient', lane: 'A3 AMB', generates: true },
    { id: 'dialogue', label: 'Dialogue', color: '#e8a3c9', capability: 'voice', lane: 'A1 DLG' },
];

/** Where a newly ticked shot goes: among the cut's shots, at its place in story order (a hand-made order is kept). */
export function insertInStoryOrder(shotIds, id, runningOrder = []) {
    if (shotIds.includes(id)) return shotIds;
    const rank = new Map(runningOrder.map((s, i) => [s, i]));
    const mine = rank.has(id) ? rank.get(id) : Infinity;
    const at = shotIds.findIndex(s => (rank.has(s) ? rank.get(s) : Infinity) > mine);
    return at < 0 ? [...shotIds, id] : [...shotIds.slice(0, at), id, ...shotIds.slice(at)];
}

/** The cut as timeline lanes, read straight off the server's layout: picture, then each sound kind. */
export function cutLanes(cut) {
    const lanes = { video: [], dialogue: [], sfx: [], ambient: [], music: [] };
    for (const s of cut?.shots || []) if (s.start_ms !== null) lanes.video.push({ key: s.shot_id, label: s.picture === 'board' ? `${s.shot_code} · board` : s.shot_code, start: s.start_ms, length: s.duration_ms, picture: s.picture });
    for (const n of cut?.sounds || []) if (n.placed) lanes[n.kind].push({ key: n.id, label: n.label || n.asset?.file_name || 'no file yet', start: n.start_ms, length: n.end_ms - n.start_ms, empty: !n.asset });
    return { total: cut?.total_ms || 0, lanes };
}
