/*
 * The Direct studio, the pure part: the vocabularies (emotions, camera moves,
 * framings), a shot's starting direction from its scene card, and the prompt
 * compiler. No React, no fetching.
 *
 * The prompt follows the shot's own time: one paragraph per beat, a beat
 * starting at 0, at each line (less its pause) and at any break the director
 * adds. Each paragraph holds what happens in it in time order: camera, acting,
 * the line, the sound. That is how the creators we studied write for Seedance
 * and Kling, and it keeps "who does what when" together for the model.
 *
 * Emotions follow the face → gaze → breath → body order of the Seedance
 * emotion-direction guide; the wording is ours. Moves cover the 46 of
 * aicameramovements.com plus focus moves it lacks. Framing, height, facing and
 * lens follow aicameracontrol.com's readout and the values Previz uses.
 */

export const INTS = ['Trace', 'Subtle', 'Medium', 'Strong', 'Explosive'];
const INT_MOD = [' — barely there', ', held in', '', ', plainly', ', uncontrolled'];
const INT_ADJ = ['a trace of', 'restrained', 'clear', 'strong', 'overwhelming'];
export const FAMS = [['joy', 'Joy'], ['love', 'Love'], ['sad', 'Sadness'], ['anger', 'Anger'], ['fear', 'Fear'], ['surprise', 'Surprise'], ['disgust', 'Disgust'], ['social', 'Social'], ['drive', 'Drive'], ['physical', 'Physical'], ['calm', 'Calm']];
// name | family | natural level 1–5 | face | gaze | breath | body
const EMO_SRC = [
  'Joy / Laughter|joy|5|eyes crinkle almost shut as the mouth opens wide|gaze drops, then comes back up bright|breath breaks into bursts of laughter|shoulders shake and the head tips back before it settles into a grin',
  'Amusement|joy|2|mouth twitches up at one corner against the effort to stay straight|eyes brighten and flick away|breath huffs once through the nose|head dips slightly',
  'Contentment|joy|1|face softens into a closed-lip smile|gaze rests easily, unfocused|breath slows and deepens|shoulders loosen and drop',
  'Awe / Wonder|joy|3|lips part as the eyes widen slowly under a relaxed brow|gaze lifts and holds on what is in front of them|breath stops for a moment, then releases|body leans in without meaning to',
  'Relief|joy|3|brows drop and the face unclenches|eyes close for a second|breath goes out in one long exhale|shoulders sag and a shaky smile follows',
  'Hope|joy|2|brows lift a little as the eyes search the other face|gaze holds, waiting|breath is held in|body tilts forward slightly',
  'Excitement|joy|4|eyes widen and a quick smile breaks|gaze darts between people|breath quickens|hands and shoulders cannot keep still',
  'Gratitude|joy|2|eyes soften and glisten|gaze holds the other person warmly|breath catches, then steadies|head gives a small nod',
  'Love|love|3|face opens, eyes warm and unguarded|gaze lingers on the other person|breath slows|body angles toward them',
  'Tenderness|love|2|mouth softens into a small private smile|gaze drifts over the other face|breath is quiet and even|hand moves as if to touch, then rests',
  'Longing|love|3|brows draw up and the lips part|gaze stays on what cannot be had|breath is slow and heavy|body is still, leaning toward it',
  'Admiration|love|2|brows lift a touch over a smile of recognition|gaze holds steady and open|breath draws in|chin lifts slightly',
  'Desire|love|3|lids lower and the lips part|gaze moves slowly down and back up|breath deepens|body shifts closer',
  'Crying|sad|5|face crumples, chin trembling, tears running|gaze blurs and drops|breath stutters in jagged gasps|shoulders heave',
  'Sadness|sad|2|brows lift at the inner corners as the mouth pulls down|gaze lowers|breath slows|chin quivers once',
  'Grief|sad|4|face goes slack, then folds|gaze fixes on nothing|breath comes ragged and uneven|body curls in, hands rising to the face',
  'Hurt|sad|3|face flinches, then freezes|eyes go bright and wet|breath catches|shoulders draw in',
  'Disappointment|sad|2|smile fades and the mouth flattens|gaze drops to the table|breath goes out through the nose|shoulders settle down',
  'Loneliness|sad|2|face is empty and still|gaze drifts to the window|breath is shallow and slow|arms close in to the body',
  'Regret|sad|3|mouth presses tight|eyes close briefly, then look away|breath leaves in a slow sigh|head shakes slightly',
  'Guilt|sad|2|lips part with nothing said|gaze slides down and away|throat works through a hard swallow|head lowers',
  'Despair|sad|4|face drains, mouth open|gaze is unfocused and far off|breath is shallow, almost stopped|body sinks into the seat',
  'Resignation|sad|2|brows lift, then let go|gaze drifts off|breath leaves in one long exhale|shoulders drop and stay down',
  'Nostalgia|sad|1|mouth finds a faint smile while the eyes stay sad|gaze goes far away|breath slows|head tilts, remembering',
  'Rage|anger|5|brows slam down and the lip pulls back from the teeth|eyes lock and narrow|breath heaves through flared nostrils|neck cords as the head thrusts forward',
  'Frustration|anger|3|eyes squeeze shut over a grinding jaw|gaze snaps away|breath blows out sharp through the nose|hands clench and release',
  'Resentment|anger|3|jaw sets and the mouth stays closed|eyes hold level, unblinking|breath goes out once, slowly, through the nose|shoulders square and stay still',
  'Irritation|anger|2|brow tightens in a small wince|gaze flicks away and back|breath clips into a short sigh|fingers tap once',
  'Indignation|anger|3|chin lifts and the nostrils flare|eyes widen, then narrow|breath draws in sharp|spine straightens',
  'Bitterness|anger|3|mouth twists into a thin half-smile|eyes stay cold and steady|breath huffs a laugh with no humour in it|body leans back',
  'Jealousy|anger|2|smile stays while the jaw tightens|eyes follow the other person sideways|breath is shallow|body turns slightly away',
  'Cold fury|anger|4|face goes completely still|eyes fix and do not blink|breath stays slow and controlled|hands lie flat on the table, motionless',
  'Terror|fear|5|brows shoot up and together, mouth stretched|eyes stay wide, unblinking|breath is fast and shallow|chin pulls back and the body freezes',
  'Panic|fear|4|face slackens, then tightens|eyes dart everywhere|breath comes rapid and gasping|hands grab at whatever is near',
  'Dread|fear|3|face tightens slowly|gaze fixes on what is coming|breath is held|body goes rigid',
  'Anxiety|fear|3|brows knit and the lower lip is bitten|eyes dart|breath is short and high|fingers fidget',
  'Suspicion|fear|2|chin dips, one brow up, a corner of the mouth tight|eyes look up and sideways without blinking|breath is held still|head stays very still',
  'Nervousness|fear|2|mouth makes a quick tight smile|gaze cannot settle|throat swallows|hands fix things that do not need it',
  'Vulnerability|fear|2|face opens, defences down|gaze meets, then drops|breath is unsteady|arms fold in',
  'Shock|surprise|5|eyes snap wide, brows up, jaw dropping|gaze freezes|breath sucks in and stops|head jerks back, then one slow blink',
  'Disbelief|surprise|3|mouth opens on half a laugh|eyes search the other face|breath goes out short|head shakes slowly',
  'Confusion|surprise|3|brows go uneven and the mouth hangs half open|eyes search|breath pauses|head tilts sharply',
  'Realization|surprise|3|thinking face breaks open and the brows jump|eyes widen and refocus|breath draws in silently|body goes still',
  'Disgust|disgust|3|nose wrinkles and the upper lip lifts|eyes squint|breath stops|head recoils and turns away',
  'Contempt|disgust|3|mouth pulls up and back at one corner|eyes look down along the nose|breath goes out short|chin lifts as the body leans away',
  'Distaste|disgust|2|lips purse|eyes narrow slightly|breath tightens|body pulls back a little',
  'Eye roll|social|3|lids go heavy|eyes roll slowly up and away|breath goes out through the nose|head tilts',
  'Flirtation|social|2|mouth lifts on one side, chin down|eyes return slowly after a deliberate blink|breath is easy|shoulder turns in',
  'Smug / Gloating|social|3|lids lower over a slow one-sided smirk, one brow flicking up|gaze holds, enjoying it|breath is relaxed|chin lifts',
  'Embarrassment|social|3|face flushes over an awkward pressed-lip smile|eyes dart down and to the side|breath escapes in a short laugh|shoulders hunch',
  'Shame|social|3|face burns, mouth tight|gaze cannot come up|breath is shallow|body shrinks in',
  'Nervous fake smile|social|2|mouth smiles while the eyes stay flat|blinks come at odd moments|breath is held behind the smile|body stays stiff',
  'Polite mask|social|1|mouth holds a pleasant neutral smile|eyes give nothing away|breath stays even|posture stays correct and closed',
  'Coldness|social|2|face is flat, without warmth|gaze is level and distant|breath stays even|body angles away, arms still',
  'Determination|drive|3|jaw sets and the eyes narrow|gaze lifts and locks forward|breath draws one deep intake|shoulders square',
  'Defiance|drive|3|chin lifts over a firm mouth|eyes hold the other person and refuse to drop|breath stays steady|body plants itself',
  'Pride|drive|2|mouth settles into a slow closed-lip smile|gaze lifts|breath fills the chest|shoulders roll back',
  'Concentration|drive|2|brows draw together slightly|gaze narrows onto one point|breath slows|body goes still',
  'Pain / Wince|physical|5|eyes clamp shut over bared teeth|gaze is gone|breath hisses in|head snaps aside, shoulder rising to the ear',
  'Boredom|physical|1|lids sit heavy over a slack jaw|gaze drifts, unfocused|breath leaves in a long sigh|body slumps',
  'Exhaustion|physical|2|lids drag down, a blink held too long|gaze is dull|breath is slow and heavy|head droops, then lifts',
  'Cold|physical|2|face pinches, lips pressed|gaze stays down|breath shivers|arms wrap the body',
  'Calm|calm|1|face is relaxed and still|gaze is steady|breath is slow and even|body is settled',
  'Numbness|calm|2|face is blank|gaze is unfocused and far off|breath barely moves|body is very still',
  'Listening|calm|1|face stays attentive, with small reactions only|gaze stays on the speaker|breath is quiet|body turns toward them',
  'Serenity|calm|1|mouth rests in a faint easy smile|gaze is soft|breath is long and slow|shoulders sit low and loose'
];
export const EMOS = EMO_SRC.map(s => { const p = s.split('|'); return { name: p[0], fam: p[1], lvl: +p[2], face: p[3], gaze: p[4], breath: p[5], body: p[6] }; });
export const emoBy = (name) => EMOS.find(e => e.name === name) || null;

export const MV_GROUPS = ['Pan/Tilt', 'Zoom/Lens', 'Dolly/Track', 'Physical', 'Human', 'Drone/Crane', 'Specials', 'Focus & more'];
// id | name | group | how the prompt says it | what it is | preview: scale, x%, y%, roll°
const MV_SRC = [
  'static|Static shot|Pan/Tilt|holds perfectly still|Locked off; nothing moves but the scene.|0,0,0,0',
  'pan-r|Pan right|Pan/Tilt|pans right|Turns right on a fixed point.|0,-7,0,0', 'pan-l|Pan left|Pan/Tilt|pans left|Turns left on a fixed point.|0,7,0,0',
  'whip-r|Whip pan right|Pan/Tilt|whip-pans right|A blurred snap to a new target.|0,-16,0,0', 'whip-l|Whip pan left|Pan/Tilt|whip-pans left|A blurred snap to a new target.|0,16,0,0',
  'tilt-u|Tilt up|Pan/Tilt|tilts up|Turns upward on a fixed point.|0,0,7,0', 'tilt-d|Tilt down|Pan/Tilt|tilts down|Turns downward on a fixed point.|0,0,-7,0',
  'zin-s|Slow zoom in|Zoom/Lens|zooms in slowly|Lens tightens; the camera stays put.|.14,0,0,0', 'zout-s|Slow zoom out|Zoom/Lens|zooms out slowly|Lens widens; the camera stays put.|-.14,0,0,0',
  'zin-f|Fast zoom in|Zoom/Lens|zooms in fast|A quick lens push onto the subject.|.22,0,0,0', 'zout-f|Fast zoom out|Zoom/Lens|zooms out fast|A quick lens pull away.|-.18,0,0,0',
  'crash-in|Crash zoom in|Zoom/Lens|crash-zooms in|An abrupt punch to a much tighter frame.|.4,0,0,0', 'crash-out|Crash zoom out|Zoom/Lens|crash-zooms out|An abrupt snap to a much wider frame.|-.18,0,0,0',
  'dolly-in|Dolly in|Dolly/Track|dollies in|Travels toward the subject.|.16,0,0,0', 'dolly-out|Dolly out|Dolly/Track|dollies out|Travels away from the subject.|-.16,0,0,0',
  'track|Tracking shot|Dolly/Track|tracks with the subject|Travels through the scene with them.|.04,-5,0,0', 'follow|Follow shot (over the shoulder)|Dolly/Track|follows behind at shoulder height|Rides behind the subject.|.06,0,0,0',
  'rev-track|Reverse tracking (walk and talk)|Dolly/Track|backs away ahead of the subject|Leads a subject walking toward camera.|-.05,0,0,0', 'side-track|Side tracking|Dolly/Track|tracks alongside in profile|Moves parallel to the subject.|0,-8,0,0',
  'low-track|Low tracking|Dolly/Track|tracks low along the ground|Skims near the floor with the subject.|0,-6,3,0', 'vehicle|Vehicle tracking|Dolly/Track|travels with the vehicle|Moves with a car, scenery streaming past.|0,-6,0,0',
  'chase|Chase shot|Dolly/Track|chases close behind|A fast pursuit of a moving subject.|.08,-4,0,0',
  'truck-r|Truck right|Physical|trucks right|Slides right, lens pointing the same way.|0,-6,0,0', 'truck-l|Truck left|Physical|trucks left|Slides left, lens pointing the same way.|0,6,0,0',
  'ped-u|Pedestal up|Physical|rises straight up|The whole camera lifts, lens level.|0,0,6,0', 'ped-d|Pedestal down|Physical|lowers straight down|The whole camera sinks, lens level.|0,0,-6,0',
  'slider-r|Slider right|Physical|slides right, foreground shifting against background|A short parallax slide.|0,-4,0,0', 'slider-l|Slider left|Physical|slides left, foreground shifting against background|A short parallax slide.|0,4,0,0',
  'push-past|Push past (pass-by)|Physical|pushes forward past the foreground|Glides past an edge or doorway.|.12,-3,0,0',
  'arc-r|Arc right|Physical|arcs right around the subject|A partial curve around them.|.04,-8,0,1.5', 'arc-l|Arc left|Physical|arcs left around the subject|A partial curve around them.|.04,8,0,-1.5',
  'orbit-cw|Orbit clockwise|Physical|orbits clockwise around the subject|A full circle at steady distance.|0,-12,0,2', 'orbit-ccw|Orbit counterclockwise|Physical|orbits counterclockwise around the subject|A full circle at steady distance.|0,12,0,-2',
  'handheld|Handheld|Human|is handheld, breathing with small corrections|Operator sway and small corrections.|0,0,0,0', 'snorricam|Body-mounted (Snorricam)|Human|is rigged to the actor, their face fixed as the world moves|Face locked in frame, world swinging.|.1,0,0,0',
  'crane-u|Crane up|Drone/Crane|cranes up|A smooth rise through open space.|-.06,0,10,0', 'crane-d|Crane down|Drone/Crane|cranes down|A smooth descent.|.06,0,-10,0',
  'drone-in|Drone push in|Drone/Crane|flies forward toward the subject|An aerial push to a destination.|.18,0,0,0', 'drone-out|Drone pull back|Drone/Crane|pulls back and away, revealing the world|An aerial retreat that reveals.|-.18,0,0,0',
  'heli|Helicopter shot|Drone/Crane|sweeps high and wide|A broad, gradual high flight.|-.1,-5,0,0',
  'fpv|First-person view|Specials|moves forward at eye height as the character|Hands or body visible, eye height.|.1,0,0,0', 'tiltshift|Tilt-shift (miniature)|Specials|looks down in tilt-shift, the scene like a miniature|Narrow sharp band, blurred edges.|0,0,0,0',
  'infinite|Infinite zoom|Specials|pushes continuously into the centre, speeding up|An accelerating push into the centre.|.4,0,0,0', 'earth|Earth zoom out|Specials|pulls up from street level to the whole planet|Street to city to planet.|-.18,0,0,0',
  'timelapse|Time-lapse|Specials|holds still while time races|Fixed frame, time passes fast.|0,0,0,0', 'passthru|Pass-through objects|Specials|moves into the surface and through to the space beyond|Through a barrier into the next space.|.3,0,0,0',
  'rack|Rack focus|Focus & more|racks focus|Focus moves from one subject to another.|0,0,0,0', 'follow-focus|Follow focus|Focus & more|holds focus on the subject as they move|Focus rides one subject.|0,0,0,0',
  'dolly-zoom|Dolly zoom (vertigo)|Focus & more|dolly-zooms, background stretching behind the subject|Dolly one way, zoom the other.|.1,0,0,0', 'dutch|Dutch roll|Focus & more|rolls into a dutch tilt|The horizon tips off level.|0,0,0,5',
  'drift|Slow drift|Focus & more|drifts|An almost invisible float.|.03,-2,0,0'
];
export const MOVES = MV_SRC.map(s => { const p = s.split('|'); const f = p[5].split(',').map(Number); return { id: p[0], name: p[1], grp: p[2], v: p[3], desc: p[4], fx: { s: f[0], x: f[1], y: f[2], r: f[3] } }; });
export const MV = Object.fromEntries(MOVES.map(m => [m.id, m]));

export const FRAMINGS = [['EWS', 'Extreme wide'], ['WS', 'Wide'], ['FS', 'Full'], ['MWS', 'Medium wide'], ['MS', 'Medium'], ['MCU', 'Medium close-up'], ['CU', 'Close-up'], ['ECU', 'Extreme close-up'], ['OTS', 'Over the shoulder'], ['2S', 'Two-shot'], ['INS', 'Insert']];
export const ANGLES = ['Eye', 'Shoulder', 'Hip', 'Knee', 'Ground', 'Low', 'High', 'Overhead'];
export const FACINGS = ['Front', 'Three-quarter', 'Profile', 'Back'];
export const LENSES = [14, 18, 24, 28, 32, 40, 50, 65, 75, 85, 100, 135];
export const TECHS = ['Three-point', 'Rembrandt', 'Loop', 'Butterfly', 'Clamshell', 'Split', 'Broad', 'Short', 'Backlight'];
export const TRANS = [['continuous', 'Continuous', 'No cut; the camera keeps going.'], ['cut', 'Hard cut', 'A clean cut to the next framing.'], ['match', 'Match cut', 'Cut on matching action or shape.'], ['whip', 'Whip-pan join', 'Blur out, blur in.']];
export const TRANS_SHORT = { continuous: '∞ no cut', cut: 'cut', match: 'match', whip: 'whip' };
export const SFX_QUICK = ['Footsteps', 'Door opens', 'Door closes', 'Cup set down', 'Chair scrapes', 'Paper rustles', 'Glass clinks', 'Phone buzzes', 'Car passes outside', 'Wind gusts', 'Rain on glass', 'Distant traffic'];
export const CAST_COLORS = ['#9ec5ff', '#f2b38b', '#b9e58f', '#e6a3ff', '#ffd66b', '#7fe0d2', '#ff9f9f', '#c9c9d1'];

let UID = 0;
export const nid = (p) => `${p}${Date.now().toString(36)}${(UID += 1).toString(36)}`;
export const words = (t) => String(t || '').split(/\s+/).filter(Boolean).length;
export const lineLen = (l) => Math.max(0.8, words(l.text) / 2.6 + 0.3);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const half = (t) => Math.round(t * 2) / 2;
export function fmt(t) { t = Math.max(0, Number(t) || 0); const m = Math.floor(t / 60); const s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1).replace(/\.0$/, ''); }
const sec = (t) => (Math.round(t * 10) / 10) + 's';
const clone = (o) => JSON.parse(JSON.stringify(o));

/** A cast member's short name, as the prompt says it: "RAY MERCER" → "Ray". */
export function shortName(key) {
    const first = String(key || '').trim().split(/\s+/)[0] || '';
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/**
 * One key per person: "RAY", "Ray" and "RAY MERCER" are the cast member RAY MERCER when the cast has one
 * by that full name or first name; anyone else keeps their name, upper-cased.
 */
export function canonOf(castNames) {
    const full = new Map(castNames.map(n => [String(n).toUpperCase(), String(n).toUpperCase()]));
    const first = new Map();
    for (const n of castNames) { const f = String(n).toUpperCase().split(/\s+/)[0]; if (!first.has(f)) first.set(f, String(n).toUpperCase()); else first.set(f, null); }
    return (name) => { const u = String(name || '').trim().toUpperCase(); return full.get(u) || first.get(u.split(/\s+/)[0]) || u; };
}

/* ---------- a shot's starting direction, read off its scene card ---------- */

const FRAMING_WORDS = [[/extreme\s*wide|establish/i, 'EWS'], [/medium\s*wide|cowboy/i, 'MWS'], [/extreme\s*close|ecu/i, 'ECU'], [/medium\s*close|mcu/i, 'MCU'],
    [/over.?the.?shoulder|\bots\b/i, 'OTS'], [/two.?shot|\b2s\b/i, '2S'], [/insert|detail/i, 'INS'], [/close/i, 'CU'], [/full/i, 'FS'], [/wide|\bws\b|long shot/i, 'WS'], [/medium|\bms\b|mid/i, 'MS']];
export function framingOf(text) { for (const [re, f] of FRAMING_WORDS) if (re.test(String(text || ''))) return f; return 'MS'; }

const MOVE_WORDS = [[/push.?in|dolly.?in/i, 'dolly-in'], [/pull.?(back|out)|dolly.?out/i, 'dolly-out'], [/pan.?right/i, 'pan-r'], [/pan.?left/i, 'pan-l'], [/whip/i, 'whip-r'],
    [/tilt.?up/i, 'tilt-u'], [/tilt.?down/i, 'tilt-d'], [/crash/i, 'crash-in'], [/zoom.?out/i, 'zout-s'], [/zoom/i, 'zin-s'], [/track.*left|truck.?left/i, 'truck-l'], [/track.*right|truck.?right/i, 'truck-r'],
    [/track|follow/i, 'track'], [/orbit|circle/i, 'orbit-cw'], [/arc/i, 'arc-r'], [/crane.?down|jib.?down/i, 'crane-d'], [/crane|jib|boom/i, 'crane-u'], [/pedestal.?down/i, 'ped-d'], [/pedestal/i, 'ped-u'],
    [/drone|aerial/i, 'drone-in'], [/hand.?held/i, 'handheld'], [/steadicam|glide/i, 'track'], [/rack/i, 'rack'], [/dutch/i, 'dutch'], [/drift|float/i, 'drift'], [/static|lock|still|hold/i, 'static']];
export function moveOf(text) { for (const [re, id] of MOVE_WORDS) if (re.test(String(text || ''))) return id; return null; }

const firstSentence = (t) => { const s = String(t || '').trim(); const m = /^(.+?[.!?])(\s|$)/.exec(s); return (m ? m[1] : s).slice(0, 260); };

export function blankMove(type, start, end, o = {}) { return { id: nid('m'), type, start, end, speed: 'slow', subj: '', ends: '', from: '', to: '', curve: 'ease', ...o }; }

/**
 * What the card already says, as direction: its lines spaced through the shot
 * by how long they take to say, its framing, lens and move, its light note.
 * Nothing here is invented beyond timing; the director changes any of it.
 */
export function seedShot(card = {}, fallbackSeconds = 5, canon = (n) => String(n || '').toUpperCase()) {
    const dur = Math.max(2, Math.round(Number(card.duration_s) || fallbackSeconds || 5));
    const src = (card.dialogue || []).filter(l => String(l.line || '').trim());
    const lines = src.map(l => ({ id: nid('l'), ch: canon(l.character), text: String(l.line), orig: String(l.line), t: 0, del: l.parenthetical ? String(l.parenthetical).replace(/^\(|\)$/g, '') : '', pause: 0, src: 'native' }));
    const speech = lines.reduce((a, l) => a + lineLen(l), 0);
    const gap = lines.length ? Math.max(0.3, (dur - 0.5 - speech) / lines.length) : 0;
    let t = 0.5;
    for (const l of lines) { l.t = Math.round(Math.min(t, Math.max(0, dur - 0.8)) * 10) / 10; t += lineLen(l) + gap; }
    const cam = card.camera || {};
    const lensNum = /(\d{2,3})\s*mm/i.exec(String(cam.lens || ''));
    const lens = lensNum ? Number(lensNum[1]) : 40;
    const lensNote = String(cam.lens || '').replace(/\d{2,3}\s*mm/i, '').trim() || '';
    const framing = framingOf(cam.shot_type || card.shot_type);
    const camState = { framing, angle: /low/i.test(cam.angle || '') ? 'Low' : /high/i.test(cam.angle || '') ? 'High' : 'Eye', facing: 'Three-quarter', lens, lensNote };
    const mv = moveOf(cam.movement);
    const moves = mv ? [blankMove(mv, 0, dur, mv === 'static' ? { speed: 'steady' } : {})] : [];
    const sfx = (card.sfx_cues || []).map(c => typeof c === 'string' ? c : (c && (c.description || c.sound || c.cue)) || '').filter(Boolean)
        .map((text, i) => ({ id: nid('f'), t: half(Math.min(dur - 0.5, 0.5 + i * 2)), text }));
    return { v: 1, dur, cardDur: dur, cam: camState, inh: { ...camState }, start: firstSentence(card.direction || card.description), end: String(card.end_state || ''),
        lines, moves, perf: {}, sfx, lit: String(card.lighting?.notes || ''), tech: '', cuts: [], transOut: 'continuous' };
}

/* ---------- acting ---------- */

/** The beats an emotion plays as, from what sets it off: face, gaze, breath, body, voice; listening reactions on request. */
export function genBeats(ch, name, emoName, inten, trigT, dur, lines, listen) {
    const e = emoBy(emoName); if (!e) return [];
    const k = clamp(inten, 1, 5) - 1;
    const parts = [['face', e.face, 1.2, true], ['gaze', e.gaze, 0.2, false], ['breath', e.breath, 2.6, false], ['body', e.body, 0, true]];
    const out = parts.map(p => ({ id: nid('b'), part: p[0], t: clamp(half(trigT + p[2]), 0, Math.max(0, dur - 0.5)), text: `${name}'s ${p[1]}${p[3] ? INT_MOD[k] : ''}`, on: true, src: 'emotion' }));
    out.push({ id: nid('b'), part: 'voice', t: clamp(trigT + 0.5, 0, Math.max(0, dur - 0.5)), text: `${name}'s voice carries ${INT_ADJ[k]} ${emoName.toLowerCase().replace(/ \/.*/, '')}`, on: true, src: 'emotion' });
    if (listen) for (const l of lines) if (l.ch !== ch && l.t >= trigT) out.push({ id: nid('b'), part: 'listen', t: clamp(l.t + lineLen(l) * 0.6, 0, Math.max(0, dur - 0.5)), text: `${name} listens; ${e.gaze}`, on: true, src: 'listening' });
    return out;
}

/** A character's performance with a new emotion, intensity, trigger or listening: the director's own beats are kept. */
export function applyEmotion(shot, ch, name, emo, inten, trig, trigT, listen) {
    const s = clone(shot);
    const cur = s.perf[ch] || { ch, beats: [] };
    const kept = (cur.beats || []).filter(b => b.src !== 'emotion' && b.src !== 'listening');
    const gen = genBeats(ch, name, emo, inten, trigT, s.dur, s.lines, listen).filter(g => !kept.some(b => b.src === 'yours' && b.part === g.part));
    s.perf[ch] = { ch, emo, inten, trig, trigT, listen: !!listen, beats: [...kept, ...gen].sort((a, b) => a.t - b.t) };
    return s;
}

/* ---------- the prompt ---------- */

export function movePhrase(m, off) {
    const d = MV[m.type]; if (!d) return '';
    if (m.type === 'static') return 'The camera holds perfectly still' + (m.end > m.start ? ' until ' + fmt(off + m.end) : '') + '.';
    if (m.type === 'rack') return 'Focus ' + (m.speed === 'fast' ? 'snaps' : 'pulls') + ' from ' + (m.from || 'the foreground') + ' to ' + (m.to || 'the subject') + '.';
    if (m.type === 'follow-focus') return 'Focus stays on ' + (m.subj || 'the subject') + ' as they move.';
    const sp = { slow: 'slowly', steady: 'steadily', fast: 'quickly' }[m.speed] || '';
    const curve = m.curve === 'ease' ? '' : m.curve === 'linear' ? ' at an even pace' : ' with a sudden start';
    return 'The camera ' + (sp ? sp + ' ' : '') + d.v + (m.subj ? ', led by ' + m.subj : '') + curve + ' over ' + sec(m.end - m.start).replace('s', ' seconds') + (m.ends ? ', ending ' + m.ends : '') + '.';
}
const PAUSE_WORDS = { 0.5: 'A half-second pause.', 1: 'A one-second pause.', 1.5: 'A beat and a half of silence.', 2: 'A two-second pause.', 2.5: 'A long pause.', 3: 'A three-second silence.' };

/** Where beats start in a shot: 0, each line less its pause, each break the director added. */
export function beatStarts(s) {
    return [0, ...s.lines.map(l => Math.max(0, l.t - (l.pause || 0))), ...(s.cuts || [])]
        .filter((v, i, a) => v < s.dur && a.indexOf(v) === i).sort((a, b) => a - b);
}

/**
 * One shot as paragraphs, one per beat. `ctx`: { bracket, nameOf(ch), flash, off, first }.
 * Each paragraph: { lab, t0, t1, hot, segs: [{ t, cls }] } with cls cam | act | dlg | sfx | lit.
 */
export function compileShot(s, ctx) {
    const { bracket: br, nameOf, flash, off = 0, first = true, code } = ctx;
    const starts = beatStarts(s);
    const acts = [], voice = {};
    for (const [ch, p] of Object.entries(s.perf || {})) for (const b of p.beats || []) {
        if (!b.on) continue;
        if (b.part === 'voice') voice[ch] = b; else acts.push(b);
    }
    const fr = FRAMINGS.find(f => f[0] === s.cam.framing);
    return starts.map((t0, i) => {
        const t1 = i + 1 < starts.length ? starts[i + 1] : s.dur;
        const items = [];
        if (i === 0) {
            const lens = s.cam.lens + 'mm' + (s.cam.lensNote ? ' ' + s.cam.lensNote : '');
            items.push({ t: -2, cls: 'cam', x: (s.start ? (first ? 'Opening frame: ' : '') + s.start + ' ' : '') + 'Framing: ' + (fr ? fr[1] : s.cam.framing).toLowerCase() + ', ' + s.cam.angle.toLowerCase() + ' height' + (s.cam.facing && s.cam.facing !== 'Three-quarter' ? ', ' + s.cam.facing.toLowerCase() + ' to camera' : '') + ', ' + lens + '.' });
            const lit = (s.tech ? s.tech + ' lighting. ' : '') + (s.lit || '');
            if (lit.trim()) items.push({ t: -1, cls: 'lit', x: 'Light: ' + lit.trim() });
        }
        for (const m of s.moves) if (m.start >= t0 && m.start < t1) items.push({ t: m.start, cls: 'cam', x: movePhrase(m, off) });
        for (const b of acts) if (b.t >= t0 && b.t < t1 && String(b.text).trim()) items.push({ t: b.t, cls: 'act', x: String(b.text).trim().replace(/[.;,]?$/, '.') });
        for (const l of s.lines) {
            const ls = Math.max(0, l.t - (l.pause || 0));
            if (ls < t0 || ls >= t1) continue;
            if (l.pause) items.push({ t: ls, cls: 'act', x: PAUSE_WORDS[l.pause] || `A ${l.pause}-second pause.` });
            const who = nameOf(l.ch);
            const del = [l.del, voice[l.ch] && voice[l.ch].t <= l.t ? voice[l.ch].text.replace(/^.*voice carries /, '') : ''].filter(Boolean).join('; ');
            let x = br ? '{' + who.toUpperCase() + (del ? ' (' + del + ')' : '') + ': “' + l.text + '”}' : who + (del ? ', ' + del + ',' : '') + ' says: “' + l.text + '”';
            if (l.src === 'eleven') x += br ? ' [recorded voice to be lip-synced]' : ' (recorded voice; lip-sync later)';
            items.push({ t: l.t + 0.01, cls: 'dlg', x });
        }
        for (const f of s.sfx) if (f.t >= t0 && f.t < t1 && String(f.text).trim()) items.push({ t: f.t + 0.02, cls: 'sfx', x: br ? '<' + f.text + '>' : 'Sound: ' + f.text + '.' });
        if (i === starts.length - 1 && String(s.end || '').trim()) items.push({ t: 999, cls: 'cam', x: 'End frame: ' + s.end });
        items.sort((a, b) => a.t - b.t);
        const hot = !!flash && (flash.shot === code || flash.shot === null) && (flash.t === null || flash.t === undefined || (flash.t >= t0 && flash.t < t1));
        return { lab: fmt(off + t0) + '–' + fmt(off + t1), t0: off + t0, t1: off + t1, hot, shot: code, segs: items.map(it => ({ t: it.x, cls: it.cls })) };
    });
}

const TRANS_WORDS = { continuous: 'Continuous, no cut: the camera carries straight on into the next framing.', cut: 'Hard cut.', match: 'Match cut on the movement.', whip: 'Whip pan into the next framing.' };

/**
 * The whole prompt for what will be generated: one shot, or the sequence as one clip.
 * `ctx`: { codes, shots (id → direction), labelOf(id), one, bracket, flash, nameOf, refOf, ageOf,
 *          setting, amb, music, prevTrans (transition into codes[0] when generated separately) }.
 */
export function compile(ctx) {
    const { codes, shots, one, bracket, nameOf, refOf, ageOf, setting, amb, music, prevTrans, flash, labelOf } = ctx;
    if (!codes.length) return null;
    const paras = [];
    let off = 0;
    codes.forEach((id, i) => {
        const s = shots[id]; if (!s) return;
        if (i > 0) paras.push({ lab: '→', cut: true, t0: off, t1: off, segs: [{ t: TRANS_WORDS[shots[codes[i - 1]].transOut || 'continuous'], cls: '' }] });
        paras.push(...compileShot(s, { bracket, nameOf, flash, off: one ? off : 0, first: i === 0, code: id }));
        off += s.dur;
    });
    const chars = [];
    for (const id of codes) for (const k of [...shots[id].lines.map(l => l.ch), ...Object.keys(shots[id].perf || {})]) if (k && !chars.includes(k)) chars.push(k);
    const who = chars.map(k => nameOf(k) + (refOf(k) ? ` (${refOf(k)})` : '')).join(' and ');
    const ages = chars.map(k => ageOf(k) ? `${nameOf(k)} ${ageOf(k)}` : '').filter(Boolean).join(', ');
    const cont = !one && prevTrans === 'continuous' ? ' Continues from the previous shot; its last frame is this first frame.' : '';
    const pre = (who ? who + ', exactly as in their reference images' + (ages ? '; ' + ages : '') + '. ' : '') + (setting ? setting.trim().replace(/[^.]$/, m => m + '.') + ' ' : '') + (one && codes.length > 1 ? 'One clip, in the order below.' : '') + cont;
    const post = [];
    if (amb?.on && amb.text) post.push(bracket ? '<' + amb.text + ', under everything>' : 'Throughout: ' + amb.text + '.');
    post.push(music?.on ? (bracket ? '(' + (music.text || 'score') + ')' : 'Music: ' + (music.text || 'score') + '.') : 'No music.');
    post.push('No subtitles, no on-screen text.');
    return { pre: pre.trim(), paras, post: post.join(' '), codes, one, label: codes.map(labelOf || (x => x)).join('+') };
}
export function compileText(c) {
    if (!c) return '';
    return [c.pre, ...c.paras.map(p => p.lab + '  ' + p.segs.map(g => g.t).join(' ')), c.post].filter(Boolean).join('\n\n');
}

/* ---------- checks before paying ---------- */

/**
 * What would go wrong with this request, worst first. `ctx`: { units: [{ ids, dur, label }], one, shots,
 * facts: { label, min, max, refs }, alternatives: [{ id, label, max }], refsNeeded(unit), nameOf, conflicts, hand, blocked }.
 * Each: { k: err | warn | info | ok, text, fixes: [{ lab, act: { type, … } }] } — the page performs the act.
 */
export function checks(ctx) {
    const { units, one, shots, facts, alternatives = [], refsNeeded, conflicts = [], hand, blocked } = ctx;
    const out = [];
    if (blocked) out.push({ k: 'err', text: `${facts?.label || 'This model'} can't take this request: ${blocked}`, fixes: alternatives.slice(0, 2).map(a => ({ lab: 'Use ' + a.label, act: { type: 'model', id: a.id } })) });
    for (const u of units) {
        if (facts && Number.isFinite(facts.max) && u.dur > facts.max) {
            const fixes = [];
            if (one) fixes.push({ lab: 'Generate as separate shots', act: { type: 'mode', mode: 'sep' } });
            if (u.ids.length === 1) fixes.push({ lab: `Trim ${u.label} to ${facts.max}s`, act: { type: 'trim', id: u.ids[0], to: facts.max } });
            for (const a of alternatives) if (a.max >= u.dur && fixes.length < 4) fixes.push({ lab: `Use ${a.label} (up to ${a.max}s)`, act: { type: 'model', id: a.id } });
            out.push({ k: 'err', text: `${u.label} is ${u.dur}s. ${facts.label} makes at most ${facts.max}s per clip. Nothing is split or trimmed without you.`, fixes });
        } else if (facts && Number.isFinite(facts.min) && u.dur < facts.min) {
            out.push({ k: 'warn', text: `${u.label} is ${u.dur}s; ${facts.label} makes at least ${facts.min}s, so the clip comes back longer and is trimmed in Cut.`, fixes: [] });
        }
        const w = u.ids.reduce((a, id) => a + shots[id].lines.reduce((b, l) => b + words(l.text), 0), 0);
        const wps = w / Math.max(1, u.dur);
        if (wps > 2.4) out.push({ k: 'warn', text: `${u.label}: ${w} words in ${u.dur}s (${wps.toFixed(1)} per second). Lines may be rushed or dropped.`,
            fixes: u.ids.length === 1 ? [{ lab: `Lengthen to ${Math.ceil(w / 2.2)}s`, act: { type: 'trim', id: u.ids[0], to: Math.ceil(w / 2.2) } }] : [] });
        const need = refsNeeded ? refsNeeded(u) : 0;
        if (facts && Number.isFinite(facts.refs) && need > facts.refs) {
            const alt = alternatives.find(a => Number.isFinite(a.refs) && a.refs >= need);
            out.push({ k: 'warn', text: `${facts.label} takes ${facts.refs} reference picture${facts.refs === 1 ? '' : 's'}; ${u.label} has ${need}. The rest are left out of the request.`, fixes: alt ? [{ lab: 'Use ' + alt.label, act: { type: 'model', id: alt.id } }] : [] });
        }
    }
    if (one && units[0] && units[0].ids.length > 2) out.push({ k: 'warn', text: `${units[0].ids.length} shots in one clip: the model may merge or skip a framing. Review before paying.`, fixes: [] });
    const el = units.reduce((a, u) => a + u.ids.reduce((b, id) => b + shots[id].lines.filter(l => l.src === 'eleven').length, 0), 0);
    if (el) out.push({ k: 'info', text: `${el} line${el > 1 ? 's use' : ' uses'} an ElevenLabs recording. The clip speaks it natively and Cut lip-syncs the recording over it.`, fixes: [] });
    for (const c of conflicts) out.push({ k: 'warn', text: c.text, fixes: c.fixes });
    if (hand) out.push({ k: 'info', text: 'Sending your hand-edited text.', fixes: [] });
    if (!out.some(x => x.k === 'err')) out.unshift({ k: 'ok', text: 'Length, references and model all fit.', fixes: [] });
    return out;
}

const DECADES = { twenties: 2, thirties: 3, forties: 4, fifties: 5, sixties: 6, seventies: 7, eighties: 8 };
const AGE_PHRASE = /\b((?:early|mid|late)[- ]?(twenties|thirties|forties|fifties|sixties|seventies|eighties)|(\d{2})[- ]year[- ]old)/gi;
/**
 * A character whose age in a shot's notes disagrees with their profile ("late forties" against 57). An age
 * phrase belongs to the nearest name before it (within a sentence), so "June … Ray, late forties" is Ray's.
 * `everyone`: every cast key, so a phrase about someone else is never pinned on this character.
 * Returns [{ ch, profile, card, shot }]; the prompt leaves the age out until the director chooses.
 */
export function ageConflicts(chars, cards, ageOfProfile, nameOf, everyone = chars) {
    const out = [];
    const firsts = [...new Set([...everyone, ...chars])].map(k => [k, nameOf(k).toLowerCase()]).filter(([, f]) => f);
    for (const ch of chars) {
        const profile = Number(ageOfProfile(ch)); if (!Number.isFinite(profile) || !profile) continue;
        let found = null;
        for (const [code, card] of cards) {
            const text = [card.notes, card.direction, card.description].join(' ');
            for (const m of text.matchAll(AGE_PHRASE)) {
                const before = text.slice(Math.max(0, m.index - 80), m.index).toLowerCase().split(/[.!?]/).pop();
                let owner = null, at = -1;
                for (const [k, f] of firsts) { const i = before.lastIndexOf(f); if (i > at) { at = i; owner = k; } }
                if (owner !== ch) continue;
                const said = m[3] ? Number(m[3]) : null; const dec = m[2] ? DECADES[m[2].toLowerCase()] : null;
                if (!(said ? Math.abs(said - profile) <= 2 : Math.floor(profile / 10) === dec)) { found = { ch, profile: String(profile), card: m[1], shot: code }; break; }
            }
            if (found) break;
        }
        if (found) out.push(found);
    }
    return out;
}
