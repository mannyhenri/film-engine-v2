import {Fragment} from 'react';
import './Markdown.css';

/** Model replies as Markdown. Builds React elements only (never HTML), so reply text cannot inject markup. */
const INLINE=/(`[^`\n]+`)|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(\*[^*\s][^*\n]*?\*|_[^_\s][^_\n]*?_)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;
function inline(text,key=''){
 const out=[];let last=0,i=0;
 for(const m of text.matchAll(INLINE)){
  if(m.index>last)out.push(text.slice(last,m.index));
  const k=key+'-'+i++,[all,code,strong,em,link]=m;
  if(code)out.push(<code key={k}>{code.slice(1,-1)}</code>);
  else if(strong)out.push(<strong key={k}>{inline(strong.slice(2,-2),k)}</strong>);
  else if(em)out.push(<em key={k}>{inline(em.slice(1,-1),k)}</em>);
  else if(link){const [,label,href]=link.match(/^\[([^\]]+)\]\((.+)\)$/);out.push(<a key={k} href={href} target="_blank" rel="noreferrer noopener">{label}</a>);}
  last=m.index+all.length;
 }
 if(last<text.length)out.push(text.slice(last));
 return out;
}
const withBreaks=(lines,key)=>lines.map((l,i)=><Fragment key={i}>{i>0&&<br/>}{inline(l,key+'-'+i)}</Fragment>);
const LIST=/^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
export function blocks(text){
 const lines=String(text||'').replace(/\r\n?/g,'\n').split('\n'),out=[];let i=0;
 while(i<lines.length){
  const line=lines[i];
  if(!line.trim()){i++;continue;}
  const fence=line.match(/^```(\S*)/);
  if(fence){const body=[];i++;while(i<lines.length&&!/^```\s*$/.test(lines[i]))body.push(lines[i++]);i++;out.push({type:'code',lang:fence[1],text:body.join('\n')});continue;}
  const heading=line.match(/^(#{1,6})\s+(.*)$/);
  if(heading){out.push({type:'heading',level:Math.min(heading[1].length+2,6),text:heading[2]});i++;continue;}
  if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)){out.push({type:'rule'});i++;continue;}
  if(/^>\s?/.test(line)){const body=[];while(i<lines.length&&/^>\s?/.test(lines[i]))body.push(lines[i++].replace(/^>\s?/,''));out.push({type:'quote',lines:body});continue;}
  const item=line.match(LIST);
  if(item){const ordered=/\d/.test(item[2]),items=[];
   while(i<lines.length){const m=lines[i].match(LIST);if(m&&/\d/.test(m[2])===ordered){items.push([m[3]]);i++;}else if(items.length&&lines[i].trim()&&/^\s{2,}\S/.test(lines[i])){items.at(-1).push(lines[i].trim());i++;}else break;}
   out.push({type:'list',ordered,start:ordered?parseInt(item[2],10):1,items});continue;}
  const para=[];while(i<lines.length&&lines[i].trim()&&!/^```|^#{1,6}\s|^>\s?/.test(lines[i])&&!LIST.test(lines[i]))para.push(lines[i++]);
  out.push({type:'paragraph',lines:para});
 }
 return out;
}
export default function Markdown({text,className='',streaming=false}){
 const parts=blocks(text);
 return <div className={'ai-markdown'+(streaming?' ai-streaming':'')+(className?' '+className:'')}>{parts.map((b,k)=>{
  if(b.type==='code')return <pre key={k} className="ai-markdown-code" data-lang={b.lang||undefined}><code>{b.text}</code></pre>;
  if(b.type==='heading'){const H='h'+b.level;return <H key={k}>{inline(b.text,String(k))}</H>;}
  if(b.type==='rule')return <hr key={k}/>;
  if(b.type==='quote')return <blockquote key={k}>{withBreaks(b.lines,String(k))}</blockquote>;
  if(b.type==='list'){const L=b.ordered?'ol':'ul';return <L key={k} start={b.ordered&&b.start!==1?b.start:undefined}>{b.items.map((lines,j)=><li key={j}>{withBreaks(lines,k+'-'+j)}</li>)}</L>;}
  return <p key={k}>{withBreaks(b.lines,String(k))}</p>;
 })}</div>;
}
