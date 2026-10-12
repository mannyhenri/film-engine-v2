import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,act} from '@testing-library/react';
import MovingReview from './MovingReview.jsx';
it('metadata bounds the seek control and synchronized playback follows the selected source offset',async()=>{vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();vi.spyOn(window,'requestAnimationFrame').mockReturnValue(1);vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});const view=render(<MovingReview beforeUrl="/before.mp4" afterUrl="/after.mp4" startSeconds={2} fixture/>);const [before,after]=document.querySelectorAll('video');Object.defineProperty(after,'duration',{value:5,configurable:true});fireEvent.loadedMetadata(after);expect(screen.getByLabelText('Review time').max).toBe('5');fireEvent.change(screen.getByLabelText('Review time'),{target:{value:'1'}});fireEvent.seeked(after);expect(before.currentTime).toBe(3);expect(screen.getByRole('status').textContent).toContain('does not demonstrate subject isolation');fireEvent.click(screen.getByText('Play synchronized review'));await Promise.resolve();expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);view.unmount();expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();vi.restoreAllMocks();});

it('repeated Play maintains one sync loop and Pause cancels pending starts',async()=>{
 const pending=new Map();let id=0;
 vi.spyOn(window,'requestAnimationFrame').mockImplementation(fn=>{pending.set(++id,fn);return id;});
 vi.spyOn(window,'cancelAnimationFrame').mockImplementation(key=>pending.delete(key));
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(function(){Object.defineProperty(this,'paused',{value:true,configurable:true});});
 vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(function(){Object.defineProperty(this,'paused',{value:false,configurable:true});return Promise.resolve();});
 const view=render(<MovingReview beforeUrl="/before.mp4" afterUrl="/after.mp4"/>);
 await act(async()=>{fireEvent.click(screen.getByText('Play synchronized review'));});
 expect(pending.size).toBe(1);
 await act(async()=>{fireEvent.click(screen.getByText('Play synchronized review'));fireEvent.click(screen.getByText('Play synchronized review'));});
 expect(pending.size).toBe(1);
 fireEvent.click(screen.getByText('Pause review'));expect(pending.size).toBe(0);
 const releases=[];vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(()=>new Promise(resolve=>{releases.push(resolve);}));
 fireEvent.click(screen.getByText('Play synchronized review'));fireEvent.click(screen.getByText('Pause review'));
 await act(async()=>{releases.forEach(resolve=>resolve());});expect(pending.size).toBe(0);
 view.unmount();vi.restoreAllMocks();
});
