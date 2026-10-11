import {it,expect,vi} from 'vitest';
import {compositeNodeHtml,compositeWireAllowed} from './composite-nodes.js';
import {pgOpenDepth,pgOpenComposite} from './engine.js';
it('composite output lineage exposes video, refined alpha and foreground separately',()=>{
 const port=(dir,type,name)=>`<span data-dir="${dir}" data-type="${type}" data-port="${name}"></span>`;
 document.body.innerHTML=compositeNodeHtml({key:'composite:c',id:'c',type:'composite',name:'Composite',w:320,h:390,input_types:{alpha:'AlphaSequence',depth:'DepthSequence'},output_types:{video:'CompositeVideo',alpha:'AlphaSequence',foreground:'ForegroundLayer'}},{esc:String,port,src:String,selected:'',pos:''});
 for(const [name,type] of [['video','video'],['alpha','alpha'],['foreground','video']])expect(document.querySelector(`[data-dir="out"][data-port="${name}"][data-type="${type}"]`)).not.toBeNull();
 const target={type:'composite',input_types:{alpha:'AlphaSequence',depth:'DepthSequence'}};
 expect(compositeWireAllowed({asset_id:'a',output_type:'AlphaSequence'},target,'alpha')).toBe(true);expect(compositeWireAllowed({asset_id:'d',output_type:'DepthSequence'},target,'alpha')).toBe(false);
});
it('bridge actions dispatch the exact node and pending input to their React workbench',()=>{
 const depth=vi.fn(),composite=vi.fn();window.addEventListener('film-open-depth',depth);window.addEventListener('film-open-composite',composite);
 try{pgOpenDepth('d','source');pgOpenComposite('c',{alpha_asset_id:'alpha'});expect(depth.mock.calls[0][0].detail).toEqual({node_id:'d',source_asset_id:'source'});expect(composite.mock.calls[0][0].detail).toEqual({node_id:'c',input:{alpha_asset_id:'alpha'}});}finally{window.removeEventListener('film-open-depth',depth);window.removeEventListener('film-open-composite',composite);}
});
