import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import Casting from './Casting.jsx';

const VOICE = (over = {}) => ({
    voice_id: 'v2', voice_name: 'Bea', cast: true, delivery: 'warm',
    deliveries: [{ id: 'warm', tag: '[warmly]' }, { id: 'flat', tag: '[flatly]' }],
    suggestions: {
        for: 'Mara', matched_on: { gender: 'female', age: 'middle_aged' }, missing: [], note: '',
        suggested: [
            { voice_id: 'v1', name: 'Ada', gender: 'female', age: 'middle_aged', accent: 'british', why: ['gender', 'age'], preview_url: 'https://p/ada.mp3' },
            { voice_id: 'v2', name: 'Bea', taken_by: 'Theo' },
        ],
    },
    ...over,
});
async function open(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /characters/c1/voice': VOICE(), ...routes } });
    window.loadCharacters = vi.fn();
    window.editCharacter = vi.fn();
    render(<Casting />);
    await act(async () => { await window.castCharacterVoice('c1', 'Mara'); });
    return legacy;
}
const body = () => document.getElementById('castingBody');
const statusText = () => document.getElementById('castingStatus').textContent;
const row = (name) => screen.getByText(name, { selector: '.vname' }).closest('.voice-row');

describe('Casting', () => {
    it('is rendered at boot, hidden, before anything opens it', () => {
        installLegacy();
        render(<Casting />);
        const modal = document.getElementById('castingModal');
        expect(modal && !modal.classList.contains('open')).toBe(true);
        expect(within(modal).getByText('Voice')).toBeTruthy();
        expect(body().textContent).toBe('');
    });

    it('opens on the character: who it is ordered for, the standing delivery, who is cast, every voice with why', async () => {
        await open();
        expect(window.showModal).toHaveBeenCalledWith('castingModal');
        expect(screen.getByText('Mara — voice')).toBeTruthy();
        expect(body().textContent).toContain('Ordered for Mara — female, middle aged.');
        expect(document.getElementById('castDelivery').value).toBe('warm');
        expect(body().textContent).toContain('Currently cast: Bea');
        expect(row('Ada').textContent).toContain('female · middle aged · british');
        expect(row('Ada').textContent).toContain('matches gender + age');
        expect(row('Ada').querySelector('audio').getAttribute('src')).toBe('https://p/ada.mp3');
        expect(row('Bea').textContent).toContain('already Theo');
        expect(row('Bea').textContent).toContain('no preview');
        // The cast voice is marked, and its button says so.
        expect(row('Bea').classList.contains('is-cast')).toBe(true);
        expect(within(row('Bea')).getByRole('button').textContent).toBe('Cast');
        expect(within(row('Ada')).getByRole('button').textContent).toBe('Cast this');
    });

    it('what the sheet does not record is named, with the way in (the casting surface asks for what it is missing)', async () => {
        await open({ 'GET /characters/c1/voice': VOICE({ suggestions: { ...VOICE().suggestions, missing: ['gender', 'age'], note: 'Ordered without gender or age.' } }) });
        expect(body().querySelector('.warning-banner').textContent).toContain('Ordered without gender or age.');
        fireEvent.click(screen.getByRole('button', { name: 'Add gender and age' }));
        expect(window.closeModal).toHaveBeenCalledWith('castingModal');
        expect(window.editCharacter).toHaveBeenCalledWith('c1');
    });

    it('no catalogue says so instead of an empty panel', async () => {
        await open({ 'GET /characters/c1/voice': VOICE({ suggestions: { suggested: [], missing: [], matched_on: {} } }) });
        expect(body().textContent).toContain('No voices available');
    });

    it('a failed read names why', async () => {
        await open({ 'GET /characters/c1/voice': () => { throw new Error('no key'); } });
        expect(body().textContent).toContain('Could not load the catalogue');
        expect(body().textContent).toContain('no key');
    });

    it('Cast this PUTs the voice, reports it, reloads, and refreshes the Characters list', async () => {
        let put;
        const { calls } = await open({ 'PUT /characters/c1/voice': (b) => { put = b; return { changed: true, note: 'Cast as Ada.' }; } });
        await act(async () => { fireEvent.click(within(row('Ada')).getByRole('button')); });
        expect(put).toEqual({ voice_id: 'v1', voice_name: 'Ada' });
        expect(statusText()).toBe('Cast as Ada.');
        expect(calls.filter(c => c.path === '/characters/c1/voice' && c.method === 'GET').length).toBe(2);
        expect(window.loadCharacters).toHaveBeenCalled();
        expect(within(row('Ada')).getByRole('button').textContent).toBe('Cast'); // the selection follows the pick
    });

    it('the standing delivery needs a cast voice; with one it PUTs the voice with the delivery', async () => {
        let put;
        await open({ 'PUT /characters/c1/voice': (b) => { put = b; return {}; } });
        await act(async () => { fireEvent.change(document.getElementById('castDelivery'), { target: { value: 'flat' } }); });
        expect(put).toEqual({ voice_id: 'v2', voice_name: 'Bea', delivery: 'flat' });
        expect(statusText()).toBe('Always flat. Their lines will regenerate next time you press Dialogue.');
        await act(async () => { fireEvent.change(document.getElementById('castDelivery'), { target: { value: '' } }); });
        expect(put.delivery).toBe(null);
        expect(statusText()).toBe('Delivery cleared.');
    });

    it('Audition: an empty line asks for one; otherwise previewed, confirmed, spoken, and played above', async () => {
        let posted;
        const { calls } = await open({
            'GET /audition/preview?text=Hi%20there&voice_id=v2&character_id=c1': { provider: 'elevenlabs', voice_id: 'v2' },
            'POST /audition': (b) => { posted = b; return { audio_url: '/film/audition/x.mp3' }; },
        });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Audition' })); });
        expect(statusText()).toBe('Type a line to hear.');
        expect(calls.some(c => c.path.startsWith('/audition'))).toBe(false);

        const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        fireEvent.change(document.getElementById('auditionLine'), { target: { value: ' Hi there ' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Audition' })); });
        expect(confirm.mock.calls[0][0]).toContain('Speak this line?\n\n"Hi there"\n\nProvider: elevenlabs\nVoice: v2');
        expect(calls.some(c => c.method === 'POST')).toBe(false); // refused: nothing spent
        expect(statusText()).toBe('');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Audition' })); });
        expect(posted).toEqual({ text: 'Hi there', voice_id: 'v2', character_id: 'c1', project_id: 'p1' });
        expect(statusText()).toBe('Playing.');
        const played = body().querySelector('.voice-row');
        expect(played.textContent).toContain('Audition');
        expect(played.querySelector('audio').getAttribute('src')).toBe('http://api.test/film/audition/x.mp3');
        confirm.mockRestore();
    });

    it('a preview that refuses says why and spends nothing', async () => {
        const { calls } = await open({ 'GET /audition/preview?text=x&voice_id=v2&character_id=c1': { error: 'No voice provider is set up.' } });
        fireEvent.change(document.getElementById('auditionLine'), { target: { value: 'x' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Audition' })); });
        expect(statusText()).toBe('No voice provider is set up.');
        expect(calls.some(c => c.method === 'POST')).toBe(false);
    });
});
