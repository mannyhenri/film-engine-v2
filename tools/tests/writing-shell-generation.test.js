const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {readSource} = require('../split-lib');
const {brandShell} = require('../branding.cjs');
const plan = require('../port-plan.json');

test('a normal build regenerates the Ask AI rail and retains the Guide glossary', () => {
    const shell = brandShell(readSource(path.resolve(__dirname, '../..', plan.source)).shell);
    assert.match(shell, /id:'askai', label:'Ask AI'/);
    assert.match(shell, /window\.__filmOpenAskAI\(\{currentTarget:b\}\)/);
    assert.match(shell, /Terminology glossary/);
    assert.match(shell, /terms\.onclick = function \(\) \{ if \(window\.showModal\) window\.showModal\('glossaryModal'\)/);
    assert.doesNotMatch(shell, /id:'glossary',\s+label:'Terms'/);
});
