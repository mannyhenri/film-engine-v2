// Local, fixed parsers only. No document code, URLs, commands or caller paths.
const {parentPort,workerData} = require('node:worker_threads');
const bytes = Buffer.from(workerData.bytes);
// Bound DOCX expansion before member text is retained or joined. Successful
// extraction still reports exact totals before the separate 100k retention cap.
const DOCX_LIMITS={maxInflatedBytes:5*1024*1024,maxTextCharacters:1000000};
parentPort.postMessage({progress:35});
try {
 let text, details={parser:'UTF-8 text'};
 if(workerData.format==='docx') {
  const r=require('./docx-text').extractDocxText(bytes,DOCX_LIMITS);
  if(!r.ok)throw Error(r.error);text=r.text;details={parser:'Film docx-text',files_read:r.files_read,omissions:['Images and text boxes are not extracted.']};
 } else {
  text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(text.includes('\0'))throw Error('Binary content is not supported as text.');
  if(workerData.format==='fdx') {
   const r=require('./fdx-parser').parseFDX(text);
   if(r.metadata.error||!r.fountain_text)throw Error(r.metadata.error||'No readable screenplay in this FDX.');
   text=r.fountain_text;details={parser:'Film fdx-parser',omissions:['FDX converted to Fountain; document formatting is omitted.']};
  }
 }
 if(!text.trim())throw Error('The file contains no readable text.');
 parentPort.postMessage({progress:85});
 const total=text.length, limit=100000;
 parentPort.postMessage({text:text.slice(0,limit),details:{...details,extracted_characters:total,retained_characters:Math.min(total,limit),omitted_characters:Math.max(0,total-limit)}});
}catch(e){parentPort.postMessage({error:e.message});}
