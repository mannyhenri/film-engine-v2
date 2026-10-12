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
    // Keep the writing entry in the generator so a normal build cannot restore Terms.
    const termsEntry = "    { id:'glossary',  label:'Terms', icon:'M4 3h8a1 1 0 011 1v10a1 1 0 01-1 1H4V3Zm2.4 3.4h4.2M6.4 9h3' }";
    const guideEntry = "        if (r.id === 'guide') { if (window.openProductionGuide) window.openProductionGuide(); return; }\n        if (r.id === 'glossary') { if (window.showModal) window.showModal('glossaryModal'); return; }";
    if (!shell.includes(termsEntry) || !shell.includes(guideEntry)) throw new Error('Writing rail: shell markup changed; update the v2 transform');
    shell = shell.replace(termsEntry, "    { id:'askai', label:'Ask AI', icon:'M3 3h12v9H8l-4 3v-3H3V3Zm3 3h6M6 9h4' }");
    shell = shell.replace(guideEntry, `        if (r.id === 'guide') {
          if (window.openProductionGuide) window.openProductionGuide();
          var guide = document.querySelector('#productionGuideModal .guide-toolbar');
          if (guide && !guide.querySelector('[data-guide-glossary]')) {
            var terms = document.createElement('button');
            terms.className = 'guide-tab'; terms.dataset.guideGlossary = 'true';
            terms.textContent = 'Terminology glossary';
            terms.onclick = function () { if (window.showModal) window.showModal('glossaryModal'); };
            guide.appendChild(terms);
          }
          return;
        }
        if (r.id === 'askai') { if (window.__filmOpenAskAI) window.__filmOpenAskAI({currentTarget:b}); return; }`);
    return shell.replace(/    \/\/ The glossary had exactly one way in:[\s\S]*?    \/\/ since the old sidebar that also links it is display:none in this layout\.\n/, '');
}
module.exports = { brandShell };
