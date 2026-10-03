/*
 * The request body a legacy modal form sent, from React state: the rules of the core's
 * getModalData(), kept exactly so a converted form sends what the legacy one did.
 *
 *   - text is trimmed;
 *   - a number field is sent as a Number;
 *   - an empty string, or a number that is 0, is LEFT OUT of the body (not sent as '' or 0).
 *
 * The last rule is the legacy behaviour, quirk included: a field set to 0 is not sent, so a value
 * cannot be put back to 0 through these forms. Kept here on purpose (the port changes no behaviour);
 * to change it, change it for every form at once, here.
 */
export function formBody(values, numberFields = []) {
    const body = {};
    for (const [k, raw] of Object.entries(values)) {
        const v = numberFields.includes(k) ? Number(raw) : String(raw ?? '').trim();
        if (v !== '' && v !== 0) body[k] = v;
    }
    return body;
}
