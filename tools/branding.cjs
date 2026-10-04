// Desktop branding is applied when generating v2, never to the pinned legacy page.
function brandShell(shell) {
    const replacements = [
        ['<div class="fe-mark">FE</div>', '<img class="fe-mark" src="./branding/filmengine-mark.svg" alt="Film Engine">'],
        ["if (nm) nm.textContent = open_ ? (open_.title || 'Film Engine') : 'Film Engine';", `if (nm) {
      if (open_) nm.textContent = open_.title || 'Film Engine';
      else if (nm.textContent !== 'Film Engine' || !nm.querySelector('.fe-wordmark')) {
        nm.textContent = 'Film Engine';
        nm.innerHTML = '<img class="fe-wordmark" src="./branding/filmengine-wordmark.svg" alt="Film Engine"><span class="fe-brand-name">Film Engine</span>';
      }
    }
    var mark = document.querySelector('#feBrand > .fe-mark');
    if (mark) mark.hidden = !open_;`],
    ];
    for (const [before, after] of replacements) {
        if (!shell.includes(before)) throw new Error('Desktop branding: shell markup changed; update the v2 transform');
        shell = shell.replace(before, after);
    }
    return shell;
}
module.exports = { brandShell };
