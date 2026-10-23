import { describe, it, expect } from 'vitest';
import { mergePrompt } from './prompt-merge.js';

const BASE = '0:00–0:05  Framing: medium, eye height, 35mm. Ray sets the cup down.\n\n0:05–0:10  June looks up.\n\nNo music. No subtitles, no on-screen text.';
describe('direction reaches a hand-edited prompt', () => {
    it('a sound added by the controls goes into the edited text, and the edit stays', () => {
        const mine = BASE.replace('Ray sets the cup down.', 'Ray sets the chipped cup down slowly.');
        const theirs = BASE.replace('June looks up.', 'June looks up. <a bell rings>');
        expect(mergePrompt(BASE, mine, theirs)).toEqual({ text: mine.replace('June looks up.', 'June looks up. <a bell rings>'), conflicts: 0 });
    });
    it('music switched on replaces "No music." even after an edit elsewhere', () => {
        const mine = BASE.replace('35mm', '40mm anamorphic');
        const theirs = BASE.replace('No music.', '(a single low cello note)');
        expect(mergePrompt(BASE, mine, theirs).text).toBe(mine.replace('No music.', '(a single low cello note)'));
    });
    it('both changed the same words: the director\'s words stay, and it is counted', () => {
        const mine = BASE.replace('June looks up.', 'June freezes.');
        const theirs = BASE.replace('June looks up.', 'June looks away.');
        expect(mergePrompt(BASE, mine, theirs)).toEqual({ text: mine, conflicts: 1 });
    });
    it('nothing new from the controls leaves the edit exactly as it is', () => {
        expect(mergePrompt(BASE, 'whatever I wrote', BASE)).toEqual({ text: 'whatever I wrote', conflicts: 0 });
    });
    it('a whole new paragraph (a second shot) arrives intact', () => {
        const mine = BASE.replace('Ray', 'RAY');
        const theirs = BASE.replace('\n\nNo music.', '\n\n0:10–0:14  Close-up on the cup.\n\nNo music.');
        expect(mergePrompt(BASE, mine, theirs).text).toBe(mine.replace('\n\nNo music.', '\n\n0:10–0:14  Close-up on the cup.\n\nNo music.'));
    });
});
