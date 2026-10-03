import { legacy } from './legacy.js';

/*
 * What the three subject pages (characters, locations, props) share. In the legacy app this was the
 * `subjects` chunk; with all three pages React, it is here.
 */

/**
 * Write the missing descriptions from the screenplay.
 *
 * The route has existed since the screenplay-to-entities work and was
 * reachable only over HTTP: no button, and deliberately no MCP tool, since
 * it hands the reasoning to a server-side LLM and the agent host IS the
 * model. So in the app, descriptions were typed by hand — and an entity
 * with no description generates a bare name, which is how a character
 * becomes a different person in every frame.
 *
 * Fills only what is BLANK. A description someone wrote is a decision, and
 * a button that quietly replaced it would be unusable twice.
 *
 * `reload` is the page's own loader (the legacy version took its name and looked it up on window).
 */
export async function describeFromScreenplay(reload) {
    if (!legacy.state.currentProject) return;
    legacy.setStatus('Reading the screenplay...', true);
    try {
        const r = await legacy.api('/projects/' + legacy.state.currentProject.id + '/entities/describe', {
            method: 'POST', body: JSON.stringify({}),
        });
        const n = r.described_count || (r.described || []).length;
        // Named, not counted. An entity that stays blank generates a bare
        // name and must not look like success.
        const missed = (r.still_blank || []).map(x => x.name || x).filter(Boolean);
        legacy.setStatus(
            (n ? `Described ${n} entit${n === 1 ? 'y' : 'ies'}` : (r.message || 'Nothing was blank'))
            + (missed.length ? ` — still blank: ${missed.join(', ')}` : '')
            + (r.provider ? ` (via ${r.provider})` : ''));
        if (typeof reload === 'function') await reload();
    } catch (err) {
        legacy.setStatus('Could not describe from the screenplay: ' + err.message);
    }
}

export const DESCRIBE_TITLE = 'Write the missing descriptions from the screenplay. Only fills what is blank — a description you wrote is a decision and is never overwritten.';

/**
 * A record as the legacy setModalData() put it into a form: a number field with no value shows EMPTY,
 * not 0 (a size of zero is not a thing, and showing one reads as a declared measurement); anything else
 * absent is ''. A value a select does not offer is '' too: assigning it to the legacy select left it with
 * no selection, so getModalData() read '' and the body left the field out.
 */
export function formFrom(record, fields, selects = {}) {
    const values = {};
    for (const f of fields) {
        const v = record ? record[f] : undefined;
        values[f] = (v === null || v === undefined) ? '' : String(v);
        if (selects[f] && !selects[f].includes(values[f])) values[f] = '';
    }
    return values;
}

/** The plate on a location or prop card: a banner across the top. */
export const BANNER_STYLE = { width: 'calc(100% + 24px)', height: 120, objectFit: 'cover', borderRadius: '8px 8px 0 0', margin: '-12px -12px 8px -12px', cursor: 'zoom-in' };
