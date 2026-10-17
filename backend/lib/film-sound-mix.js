'use strict';
/**
 * THE FILM'S OWN SOUND, MIXED INTO THE CONFORMED MASTER.
 *
 * The conform (lib/conform.js) lays the dialogue, effects, ambience and the
 * music brought in for each scene where Playback plays them, and mixes them
 * over the joined picture in one ffmpeg pass. Moved here from the score
 * approval module when music-making was retired; the mix itself is unchanged.
 */
const fs = require('fs');
const crypto = require('crypto');

/** Entries in play order from clips laid end to end (the conform's own durations). */
function entriesFromClips(clips) {
    let at = 0;
    return (clips || []).map(c => { const e = { shot_id: c.shot_id, shot_code: c.shot_code, start_ms: at, covers: c.covers }; at += Number(c.duration_ms) || 0; return e; });
}

/**
 * Mix the placed sounds over a finished film's audio, in one ffmpeg pass:
 * each delayed to its offset, summed with nothing normalised, the film's
 * length kept. Returns an argument array, never a shell string.
 */
function soundMixArgs(input, placements, output, opts) {
    const o = opts || {};
    const args = ['-y', '-loglevel', 'error', '-i', input];
    for (const p of placements) args.push('-i', p.file_path);
    const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo';
    // A film with no audio stream (silent clips, joined) gets its sound over silence of the film's own length.
    if (o.silentBaseSeconds) args.push('-f', 'lavfi', '-t', String(o.silentBaseSeconds), '-i', 'anullsrc=r=48000:cl=stereo');
    const base = o.silentBaseSeconds ? `[${placements.length + 1}:a]` : '[0:a]';
    const parts = [`${base}${fmt}[f]`];
    // A placement may also carry how much of the file plays, its fades and its level.
    const shape = p => {
        const f = [];
        const play = Number(p.play_ms) > 0 ? Number(p.play_ms) / 1000 : null;
        if (play) f.push(`atrim=0:${play.toFixed(3)}`, 'asetpts=PTS-STARTPTS');
        if (Number(p.fade_in_ms) > 0) f.push(`afade=t=in:st=0:d=${(Number(p.fade_in_ms) / 1000).toFixed(3)}`);
        if (Number(p.fade_out_ms) > 0 && play) {
            const d = Math.min(Number(p.fade_out_ms) / 1000, play);
            f.push(`afade=t=out:st=${Math.max(0, play - d).toFixed(3)}:d=${d.toFixed(3)}`);
        }
        if (Number.isFinite(Number(p.gain_db)) && Number(p.gain_db) !== 0) f.push(`volume=${Number(p.gain_db)}dB`);
        return f.length ? `,${f.join(',')}` : '';
    };
    placements.forEach((p, i) => parts.push(`[${i + 1}:a]${fmt}${shape(p)},adelay=${Math.round(p.offset_ms)}|${Math.round(p.offset_ms)}[s${i}]`));
    parts.push(`[f]${placements.map((_, i) => `[s${i}]`).join('')}amix=inputs=${placements.length + 1}:normalize=0:duration=first:dropout_transition=0[a]`);
    args.push('-filter_complex', parts.join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output);
    return args;
}

function mixSoundIntoFilm(filmPath, placements, opts) {
    const o = opts || {};
    const { resolveFfmpeg } = require('./ffmpeg');
    const found = resolveFfmpeg();
    if (!found.available) return { ok: false, error: `no encoder to mix the film's sound with: ${found.reason}` };
    const tmp = `${filmPath}.sound-${crypto.randomUUID().slice(0, 8)}.mp4`;
    const seen = require('./ffmpeg').inspectMedia(filmPath);
    const silentBaseSeconds = seen.ok && !seen.hasAudio ? Math.max(0.1, seen.durationSeconds) : null;
    const r = require('child_process').spawnSync(found.bin, ['-nostdin', ...soundMixArgs(filmPath, placements, tmp, { silentBaseSeconds })], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: o.timeoutMs || 600000 });
    if (r.status !== 0 || !fs.existsSync(tmp)) {
        try { fs.unlinkSync(tmp); } catch (_) { /* nothing written */ }
        return { ok: false, error: `mixing the film's sound into the master failed: ${String(r.stderr || r.error || '').trim().split('\n').slice(-2).join(' ')}` };
    }
    fs.renameSync(tmp, filmPath);
    return { ok: true };
}

module.exports = { entriesFromClips, soundMixArgs, mixSoundIntoFilm };
