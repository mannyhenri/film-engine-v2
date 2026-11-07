import { beforeEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
const bridge = vi.hoisted(() => ({ state: { currentProject: { id: 'A' } }, api: vi.fn() }));
const scope = vi.hoisted(() => ({ epoch: 0 }));
vi.mock('../../lib/legacy.js', () => ({ legacy: bridge }));
vi.mock('../../lib/project-epoch.js', () => ({ projectEpoch: () => scope.epoch }));
import StoryboardPrint from './StoryboardPrint.jsx';

const response = (paper, project = 'A', per_page = 4) => ({ project_id: project, title: 'My film', paper, per_page, shot_count: 5, continuation_count: 2,
    pages: [{ number: 1 }, { number: 2 }, { number: 3 }], html: '<!doctype html><html><body>Selected originals</body></html>' });
beforeEach(() => {
    scope.epoch = 0; bridge.state.currentProject = { id: 'A' };
    bridge.api.mockReset().mockImplementation(async url => {
        const query = new URLSearchParams(url.split('?')[1]);
        return response(query.get('paper'), url.split('/')[2], Number(query.get('per_page')));
    });
});

it('opens a free Letter preview, switches to A4, and prints only after an explicit loaded-preview click', async () => {
    render(<StoryboardPrint />);
    expect(bridge.api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Print storyboard' }));
    const frame = await screen.findByTitle('Storyboard print preview');
    expect(bridge.api).toHaveBeenCalledWith('/projects/A/storyboard/print?paper=letter&per_page=4');
    expect(frame.getAttribute('srcdoc')).toContain('Selected originals');
    expect(screen.getByRole('button', { name: 'Print / Save PDF' }).disabled).toBe(true);
    const print = vi.spyOn(frame.contentWindow, 'print').mockImplementation(() => {});
    vi.spyOn(frame.contentWindow, 'focus').mockImplementation(() => {});
    expect(print).not.toHaveBeenCalled();
    frame.contentDocument.head.innerHTML = '<meta name="fe-storyboard-print" content="A:letter:4">';
    fireEvent.load(frame);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print / Save PDF' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Print / Save PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Paper size'), { target: { value: 'a4' } });
    await waitFor(() => expect(bridge.api).toHaveBeenLastCalledWith('/projects/A/storyboard/print?paper=a4&per_page=4'));
    expect(screen.getByText(/5 shots.*2 continuation panels/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close print preview' }));
    expect(screen.queryByRole('dialog')).toBeNull();
});

it('switches to two boards per page, keeps the paper choice, and only enables print for the matching preview', async () => {
    render(<StoryboardPrint />);
    fireEvent.click(screen.getByRole('button', { name: 'Print storyboard' }));
    await screen.findByTitle('Storyboard print preview');
    fireEvent.change(screen.getByLabelText('Paper size'), { target: { value: 'a4' } });
    await waitFor(() => expect(bridge.api).toHaveBeenLastCalledWith('/projects/A/storyboard/print?paper=a4&per_page=4'));
    fireEvent.change(screen.getByLabelText('Boards per page'), { target: { value: '2' } });
    await waitFor(() => expect(bridge.api).toHaveBeenLastCalledWith('/projects/A/storyboard/print?paper=a4&per_page=2'));
    expect(screen.getByText(/Two shots per landscape page/)).toBeTruthy();
    const frame = await screen.findByTitle('Storyboard print preview');
    frame.contentDocument.head.innerHTML = '<meta name="fe-storyboard-print" content="A:a4:4">';
    fireEvent.load(frame);
    expect(screen.getByRole('button', { name: 'Print / Save PDF' }).disabled).toBe(true);
    frame.contentDocument.head.innerHTML = '<meta name="fe-storyboard-print" content="A:a4:2">';
    fireEvent.load(frame);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print / Save PDF' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Close print preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Print storyboard' }));
    await waitFor(() => expect(bridge.api).toHaveBeenLastCalledWith('/projects/A/storyboard/print?paper=a4&per_page=2'));
});

it('a late project A response is discarded after A → B → A and on unmount', async () => {
    let finish; bridge.api.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<StoryboardPrint />);
    fireEvent.click(screen.getByRole('button', { name: 'Print storyboard' }));
    scope.epoch += 2;
    await act(async () => finish(response('letter')));
    expect(screen.queryByTitle('Storyboard print preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close print preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Print storyboard' }));
    view.unmount(); await act(async () => finish(response('letter')));
    expect(screen.queryByRole('dialog')).toBeNull();
});

it('closing a loading preview invalidates its answer and reopening uses the current project', async () => {
    let finish; bridge.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<StoryboardPrint />);
    fireEvent.click(screen.getByRole('button', { name: 'Print storyboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close print preview' }));
    bridge.state.currentProject = { id: 'B' };
    fireEvent.click(screen.getByRole('button', { name: 'Print storyboard' }));
    await screen.findByTitle('Storyboard print preview');
    await act(async () => finish({ ...response('letter'), html: 'Stale A' }));
    expect(screen.getByTitle('Storyboard print preview').getAttribute('srcdoc')).not.toContain('Stale A');
    expect(bridge.api).toHaveBeenLastCalledWith('/projects/B/storyboard/print?paper=letter&per_page=4');
});

it('shows read failures and requires an open project without sending a request', async () => {
    bridge.api.mockRejectedValueOnce(Error('Originals unavailable'));
    render(<StoryboardPrint projectId="given" />);
    fireEvent.click(screen.getByRole('button', { name: 'Print storyboard' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Originals unavailable');
    expect(screen.queryByRole('button', { name: 'Print / Save PDF' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close print preview' }));
    bridge.state.currentProject = null;
    render(<StoryboardPrint />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Print storyboard' })[1]);
    expect(await screen.findByText('Open a project to print its storyboard.')).toBeTruthy();
    expect(bridge.api).toHaveBeenCalledTimes(1);
});

it('a failed original image decode is visible and prevents silently printing a blank image', async () => {
    render(<StoryboardPrint />);
    fireEvent.click(screen.getByRole('button', { name: 'Print storyboard' }));
    const frame = await screen.findByTitle('Storyboard print preview');
    frame.contentDocument.head.innerHTML = '<meta name="fe-storyboard-print" content="A:letter:4">';
    const image = frame.contentDocument.createElement('img');
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 0 } });
    frame.contentDocument.body.append(image);
    const print = vi.spyOn(frame.contentWindow, 'print').mockImplementation(() => {});
    fireEvent.load(frame);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'An original image could not be displayed. Review the preview before printing.');
    fireEvent.click(screen.getByRole('button', { name: 'Print / Save PDF' }));
    expect(print).not.toHaveBeenCalled();
});
