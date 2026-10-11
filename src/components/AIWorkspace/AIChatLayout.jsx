import {useEffect,useId,useRef,useState} from 'react';
import './AIChatLayout.css';

/** Shared presentation; each workspace keeps its own durable context/task contracts. */
export default function AIChatLayout({dialogRef,dialogName,variant,title,onClose,status,projectPicker,options,history,provider,message,onMessage,onSend,sendDisabled,attachmentSummary,onAttach,fileInput,preview}){
 const [optionsOpen,setOptionsOpen]=useState(false),anchor=useRef(null),id=useId();
 useEffect(()=>{if(!optionsOpen)return;const outside=e=>{if(!anchor.current?.contains(e.target))setOptionsOpen(false);};const escape=e=>{if(e.key==='Escape'&&!document.querySelector('.ai-connections-panel')){e.preventDefault();e.stopPropagation();setOptionsOpen(false);anchor.current?.querySelector('button').focus();}};document.addEventListener('mousedown',outside);document.addEventListener('keydown',escape,true);return()=>{document.removeEventListener('mousedown',outside);document.removeEventListener('keydown',escape,true);};},[optionsOpen]);
 return <section className={"ai-workspace ai-chat-workspace"+(variant?" "+variant:"")} role="dialog" aria-modal="true" aria-label={dialogName} ref={dialogRef} tabIndex={-1}>
  <header className="ai-chat-title"><div><h2>{title}</h2><p>Film Engine</p></div><button className="btn ai-chat-close-button" aria-label="Close" onClick={onClose}>×</button></header>
  {status}
  <div className="ai-chat-topbar">{projectPicker}<div className="ai-options-anchor" ref={anchor} onKeyDown={e=>{if(e.key==='Escape'&&optionsOpen){e.preventDefault();e.stopPropagation();setOptionsOpen(false);anchor.current.querySelector('button').focus();}}}>
   <button className="btn ai-options-button" aria-label="AI options" aria-expanded={optionsOpen} aria-controls={id} onClick={()=>setOptionsOpen(v=>!v)}>⋯</button>
   <div className="ai-options-dropdown" role="region" aria-label="AI options panel" id={id} hidden={!optionsOpen}><h3>Options</h3>{options}{preview}</div>
  </div></div>
  <div className="ai-chat-conversation">{history}</div>
  <div className="ai-chat-composer">
   <label className="ai-sr-only" htmlFor={id+'-message'}>Message</label>
   <textarea id={id+'-message'} rows={3} maxLength={12000} value={message} onChange={e=>onMessage(e.target.value)} placeholder="What would you like to work on?"/>
   <div className="ai-chat-composer-controls"><button className="btn ai-attach-button" aria-label="Attach" onClick={()=>{setOptionsOpen(true);if(onAttach)onAttach();}}>+ <span>Attach</span></button>{fileInput}{provider}<span className="ai-chat-attachment-summary">{attachmentSummary}</span><button className="btn btn-primary ai-chat-send" aria-label="Send" disabled={sendDisabled} onClick={onSend}>↑</button></div>
  </div>
 </section>;
}

export function selectedSavedSceneIndex(){
 const items=Array.from(document.querySelectorAll('.scene-nav-item'));
 const index=items.findIndex(e=>e.classList.contains('current'));
 return index>=0?index:null;
}

export function activeProjects(projects=[]){return projects.filter(p=>!p.archived_at);}
