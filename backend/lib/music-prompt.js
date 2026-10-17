/**
 * FILM-090-093: Sound Prompt Builder
 *
 * Pure functions for building SFX and ambient generation payloads from scene
 * cards, sound cues, and location data. No DB dependency. (The music builder
 * went when music-making was retired on 2026-10-14.)
 */

// ── Location → Ambient Sound Mapping ────────────────────────────────

// Ambient loop bounds. The ceiling is the shortest limit across the ambient
// generators we support (ElevenLabs sound-generation caps at 30s), and the
// floor is that same endpoint's minimum. A loop is never longer than the bed it
// has to fill — a 4-second scene gets a 4-second loop, not a padded 30.
const AMBIENT_LOOP_MIN_S = 0.5;
const AMBIENT_LOOP_MAX_S = 30;
const DEFAULT_AMBIENT_BED_MS = 60000;

const LOCATION_TO_AMBIENT = {
    'office': 'quiet office ambiance, distant keyboard typing, air conditioning hum, muffled phone ringing',
    'street': 'city street sounds, passing cars, distant sirens, pedestrian footsteps, pigeons',
    'forest': 'forest ambiance, birdsong, rustling leaves, gentle wind, distant stream',
    'beach': 'ocean waves crashing, seagulls, gentle wind, distant conversation',
    'restaurant': 'restaurant ambiance, clinking glasses, muffled conversation, light background music',
    'bar': 'bar ambiance, glasses clinking, jukebox music, pool balls, muffled chatter',
    'hospital': 'hospital ambiance, beeping monitors, distant PA announcements, footsteps on linoleum',
    'car': 'car interior, engine hum, road noise, occasional turn signal',
    'subway': 'subway ambiance, train rumble, announcements, crowd noise, doors closing',
    'park': 'park ambiance, children playing, birdsong, dog barking, wind in trees',
    'library': 'library silence, page turning, distant whisper, clock ticking',
    'warehouse': 'warehouse ambiance, echo, distant machinery, dripping water',
    'church': 'church ambiance, reverberant space, distant organ, creaking pews',
    'apartment': 'apartment ambiance, muffled TV from neighbor, traffic outside, heating system',
    'courtroom': 'courtroom ambiance, murmuring gallery, gavel, paper shuffling',
    'school': 'school hallway, distant bell, children talking, lockers closing',
    'airport': 'airport ambiance, flight announcements, rolling luggage, distant jet engines',
    'rain': 'heavy rain on windows, thunder rumbling, rain on pavement',
};

// ── Time of Day → Ambient Modifier ──────────────────────────────────

const TIME_AMBIENT_MODIFIER = {
    'day': '', // No modifier
    'night': ', nighttime atmosphere, quieter, occasional distant sound',
    'dawn': ', early morning, birds waking up, quiet',
    'dusk': ', evening atmosphere, cicadas, settling quiet',
    'morning': ', morning activity, birds chirping',
    'evening': ', evening wind down, distant sounds',
};

/**
 * Build an SFX generation payload from a scene card.
 * Extracts action-based sound effects.
 *
 * @param {object} sceneCard - Parsed scene_card_yaml
 * @param {object} scene - film_scenes row
 * @returns {Array<object>} Array of payloads for POST /music (type: 'sfx')
 */
function buildSFXPrompts(sceneCard, scene) {
    const sfxCues = [];

    // Extract from explicit sfx_cues if present
    if (sceneCard.sfx_cues && Array.isArray(sceneCard.sfx_cues)) {
        for (const raw of sceneCard.sfx_cues) {
            /*
             * A cue may be a STRING or an object, like every other list on a
             * scene card — characters and props both take either.
             *
             * Found on the live database: two shots carry string cues, and
             * reading `cue.description` off a string gives undefined, so both
             * would have generated a request with NO PROMPT — a paid call with
             * nothing in it, or a provider rejection, and neither says why. The
             * MCP tool describes sfx_cues as "an array" with no shape, so an
             * agent writing strings is doing the obvious thing.
             */
            const cue = typeof raw === 'string' ? { description: raw } : (raw || {});
            const text = String(cue.description || cue.sound || '').trim();
            // A cue with nothing usable in it is DROPPED rather than sent
            // empty: a request with no prompt costs money and returns noise.
            if (!text) continue;
            sfxCues.push({
                type: 'sfx',
                prompt: text,
                duration_s: cue.duration_s || 3.0,
                model: 'audiogen',
                category: cue.category || 'foley',
                output_format: 'wav',
                sample_rate: 48000,
                seed: null,
                stream: true,
            });
        }
    }

    return sfxCues;
}

/**
 * Build an ambient audio generation payload from scene context.
 *
 * @param {object} scene - film_scenes row
 * @param {object|null} location - film_locations row
 * @returns {object} Payload for POST /music (type: 'ambient')
 */
/**
 * The bed a scene sits in.
 *
 * This read the scene's LOCATION NAME and its TIME OF DAY and nothing else, so
 * every ambient bed in a production was assembled from a lookup table and a
 * director had no way to say a word about it. Two things it never read:
 *
 * `film_locations.sound_notes` — a column called sound notes, with a textarea on
 * the Locations page placeholdered "Traffic two streets over, a screen door,
 * gulls...", stored since migration 006 and reaching nothing but the call sheet.
 * The one field in this database whose entire purpose is to describe how a place
 * SOUNDS was invisible to the only thing that generates how a place sounds.
 *
 * `direction` — what this scene needs, as opposed to what the place is like.
 * The room tone of a diner is a property of the diner; "the fridge compressor
 * cuts out halfway through" is a property of the scene, and the two are
 * different notes that were both unsayable.
 *
 * The direction LEADS, because it is the specific thing about this scene; the
 * place and the hour follow. Nothing is invented — a scene with neither gets
 * exactly the bed it got before.
 */
function buildAmbientPrompt(scene, location, opts) {
    let promptParts = [];
    const options = opts || {};

    const direction = String(options.direction || '').trim();
    if (direction) promptParts.push(direction);

    /*
     * A CUE SOMEBODY WROTE BEATS THE DERIVATION — INCLUDING BY SILENCE.
     *
     * This appended the location's generic ambience, the INT/EXT modifier and a
     * time-of-day modifier on TOP of whatever the director wrote, unconditionally.
     * For a bed that nobody briefed that is the whole value of the function. For
     * a written cue it is the derivation arguing with the brief.
     *
     * It is not a cosmetic overlap. A diegetic element — a radio playing out of
     * a drive-in speaker — was briefed as exactly that and sent as
     *
     *   "...cone crackle, carrier hiss., ambient sounds of DRIVE-IN THEATRE - LOT,
     *    outdoor, nighttime atmosphere, quieter, occasional distant sound"
     *
     * so the generator was asked for a tinny radio AND for the open-air lot it
     * is heard in, at once, while the cue's own negative prompt was busy
     * excluding crickets. The scene already has a separate bed cue for the lot;
     * this one asked for the lot a second time and diluted the thing it was for.
     *
     * It also blew the provider's limit: ElevenLabs documents 450 characters and
     * a written brief plus this tail reached 461, so the call 400'd on length
     * for a prompt the author never saw.
     *
     * So the derivation now fills a GAP rather than decorating an answer.
     */
    if (!direction) {
        // Try to match location to known ambient
        const locationName = (scene.location || '').toLowerCase();
        let matchedAmbient = null;
        for (const [key, ambient] of Object.entries(LOCATION_TO_AMBIENT)) {
            if (locationName.includes(key)) {
                matchedAmbient = ambient;
                break;
            }
        }

        if (matchedAmbient) {
            promptParts.push(matchedAmbient);
        } else if (location && location.description) {
            promptParts.push(`ambient sounds of ${location.description}`);
        } else if (scene.location) {
            promptParts.push(`ambient sounds of ${scene.location}`);
        } else {
            promptParts.push('quiet room ambiance');
        }
    }

    // What the location's own sound notes say. Appended rather than leading:
    // it describes the place in general, and the scene's direction is about
    // this scene.
    const soundNotes = String((location && location.sound_notes) || '').trim();
    if (!direction && soundNotes) promptParts.push(soundNotes);

    // INT/EXT and time-of-day modifiers, on the same terms: they describe the
    // place in general, and a written cue has already said where it is.
    if (!direction) {
        if (scene.int_ext === 'EXT') promptParts.push('outdoor');
        const timeKey = (scene.time_of_day || 'day').toLowerCase();
        const timeMod = TIME_AMBIENT_MODIFIER[timeKey] || '';
        if (timeMod) promptParts.push(timeMod.trim().replace(/^,\s*/, ''));
    }

    // An ambient bed is a loop, not a full-length render. Scenes run minutes and
    // generators cap well below that, so we ask for a short seamless loop and
    // tile it to length at mix time (see buildMixPayload). duration_s is the
    // LOOP; bed_duration_s is what that loop has to cover.
    /*
     * How long the bed has to cover.
     *
     * `scene.estimated_duration` is 0 on every scene in every real project, and
     * 0 is falsy — so this fell to a 30-second default for a scene of any
     * length, exactly as the SCORE did until it was measured. The caller passes
     * what the cut actually measures; the fallback is named rather than silent.
     */
    const measured = Number(options.bed_ms) > 0 ? Number(options.bed_ms) : 0;
    const bedMs = measured || scene.estimated_duration || DEFAULT_AMBIENT_BED_MS;
    const bedSeconds = bedMs / 1000;
    const loopSeconds = Math.max(AMBIENT_LOOP_MIN_S, Math.min(AMBIENT_LOOP_MAX_S, bedSeconds));

    /*
     * The provider's documented ceiling, enforced here rather than discovered as
     * a 400. ElevenLabs takes 450 characters; a prompt assembled past that
     * failed the whole call, and the author could not have known because the
     * assembled string is not what they wrote. Trimmed at a boundary so the
     * tail reads as a sentence rather than a severed word.
     */
    const AMBIENT_PROMPT_MAX = 450;
    let prompt = promptParts.join(', ');
    if (prompt.length > AMBIENT_PROMPT_MAX) {
        const cut = prompt.slice(0, AMBIENT_PROMPT_MAX);
        const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '));
        prompt = (at > AMBIENT_PROMPT_MAX * 0.6 ? cut.slice(0, at) : cut).trim();
    }

    return {
        type: 'ambient',
        prompt,
        prompt_trimmed: promptParts.join(', ').length > AMBIENT_PROMPT_MAX,
        prompt_parts: promptParts.filter(Boolean),
        negative_prompt: String(options.negative_prompt || '').trim(),
        bed_source: measured ? (options.bed_source || 'measured')
            : (scene.estimated_duration ? 'scene estimate' : 'default'),
        duration_s: loopSeconds,
        bed_duration_s: bedSeconds,
        model: 'musicgen-ambient',
        loopable: true,
        crossfade_s: 5.0,
        output_format: 'wav',
        sample_rate: 48000,
        seed: null,
        stream: true,
    };
}

module.exports = {
    buildSFXPrompts,
    buildAmbientPrompt,
    LOCATION_TO_AMBIENT,
    TIME_AMBIENT_MODIFIER,
};
