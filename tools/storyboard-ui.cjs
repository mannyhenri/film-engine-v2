// V2's annotation badge distinguishes visible reference marks from optional prompt notes.
function referenceBadgeCode(code) {
 return code
  .replace(/^.*\+ `<button[^\n]*onclick="exploreAngles[^\n]*>4 angles<\/button>`[^\n]*\n/gm, '')
  .replace('`${marks.length} note(s), not applied`', '`${marks.length} mark(s) in reference; text notes off`')
  .replace('`${marks.length} mark(s) — none carry a note, so none apply`', '`${marks.length} mark(s) in reference; no text directions`')
  .replace('`${noted} mark(s) steering this shot`', '`${marks.length} mark(s) in reference; ${noted} text direction(s)`')
  .replace('`${noted} of ${marks.length} steering this shot`', '`${marks.length} mark(s) in reference; ${noted} text direction(s)`');
}
module.exports={referenceBadgeCode};
