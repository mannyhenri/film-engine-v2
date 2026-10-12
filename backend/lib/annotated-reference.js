// Disposable guidance raster; never overwrite the clean frame or editable marks.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
function compose(source, marks) {
 const dimensions = require('./image-raster').readDimensions(source);
 if (!dimensions || dimensions.width*dimensions.height > 32e6) throw new Error('Reference needs a supported image under 32 megapixels');
 const pngRaster=require('./png-raster');
 const input=fs.readFileSync(source);
 let raster=pngRaster.decode(input);
 if(!raster){
  const r=spawnSync(process.env.FILM_PYTHON || 'python3',[path.join(__dirname,'annotation-decode.py'),source],{maxBuffer:160*1024*1024,timeout:30000});
  if(r.status!==0)throw new Error('Cannot decode reference orientation: local Python Pillow is required. '+String(r.stderr||r.error).slice(0,200));
  raster=pngRaster.decode(r.stdout);
 }
 if(!raster)throw new Error('Reference decoder did not return RGBA pixels');
 const {width:w,height:h,pixels}=raster;
 const scale = Math.max(w,h)/640, radius = Math.max(1,scale), head = 12*scale;
 function color(v) { const m=/^#([0-9a-f]{6})$/i.exec(v || '#f59e0b'); if(!m) throw new Error('Unsupported annotation color'); return [0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)); }
 function dot(x,y,c) { for(let yy=Math.max(0,Math.floor(y-radius));yy<=Math.min(h-1,Math.ceil(y+radius));yy++) for(let xx=Math.max(0,Math.floor(x-radius));xx<=Math.min(w-1,Math.ceil(x+radius));xx++) if((xx-x)**2+(yy-y)**2<=radius**2) { const i=(yy*w+xx)*4; pixels[i]=c[0];pixels[i+1]=c[1];pixels[i+2]=c[2];pixels[i+3]=255; } }
 function line(a,b,c) { const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*2));for(let i=0;i<=n;i++)dot(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n,c); }
 const text=[];
 for(const mark of marks) {
  const c=color(mark.color), p=(mark.points||[]).map(v=>{if(!Array.isArray(v)||v.length!==2||v.some(n=>!Number.isFinite(n)||n<0||n>1))throw new Error('Invalid annotation coordinates');return [v[0]*w,v[1]*h];});
  if(!p.length)continue;
  if(mark.kind==='text'){text.push({mark,p:p[0]});continue;}
  if(p.length<2)continue;
  if(mark.kind==='rect'){const [a,b]=p;line(a,[b[0],a[1]],c);line([b[0],a[1]],b,c);line(b,[a[0],b[1]],c);line([a[0],b[1]],a,c);}
  else if(mark.kind==='ellipse'){const [a,b]=p,cx=(a[0]+b[0])/2,cy=(a[1]+b[1])/2,rx=Math.abs(a[0]-b[0])/2,ry=Math.abs(a[1]-b[1])/2;let last=[cx+rx,cy];for(let i=1;i<=360;i++){const t=i*Math.PI/180,next=[cx+rx*Math.cos(t),cy+ry*Math.sin(t)];line(last,next,c);last=next;}}
  else if(['arrow','line','freehand'].includes(mark.kind)){for(let i=1;i<p.length;i++)line(p[i-1],p[i],c);if(mark.kind==='arrow'){const a=p[p.length-2],b=p[p.length-1],angle=Math.atan2(b[1]-a[1],b[0]-a[0]);for(const sign of [-1,1])line(b,[b[0]-head*Math.cos(angle+sign*Math.PI/6),b[1]-head*Math.sin(angle+sign*Math.PI/6)],c);}}
  else throw new Error('Unsupported annotation kind');
 }
 let png=pngRaster.encode({width:w,height:h,pixels});
 if(text.length){const r=spawnSync(process.env.FILM_PYTHON || 'python3',[path.join(__dirname,'annotation-text.py'),JSON.stringify(text)],{input:png,maxBuffer:160*1024*1024,timeout:30000});if(r.status!==0)throw new Error('Cannot render annotation labels: local Python Pillow is required. '+String(r.stderr||r.error).slice(0,200));png=r.stdout;}
 return png;
}
function annotatedReferenceForShot(db,shotId,source) {
 const rows=db.prepare('SELECT kind,points_json,text,color FROM film_storyboard_annotations WHERE shot_id=? ORDER BY created_at,id').all(shotId);
 if(!rows.length)return {path:source,annotated:false,count:0};
 const marks=rows.map(r=>({...r,points:JSON.parse(r.points_json)}));
 const digest=crypto.createHash('sha256').update('reference-v1').update(fs.readFileSync(source)).update(JSON.stringify(marks)).digest('hex');
 const directory=path.join(require('./file-storage').DATA_DIR,'annotated-references');fs.mkdirSync(directory,{recursive:true});
 const target=path.join(directory,digest+'.png');if(!fs.existsSync(target)){const bytes=compose(source,marks),tmp=target+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,bytes);fs.renameSync(tmp,target);}
 return {path:target,annotated:true,count:marks.length,digest,clean_source:source};
}
module.exports={compose,annotatedReferenceForShot};
