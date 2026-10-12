'use strict';
const CHATGPT_APP='/Applications/ChatGPT.app';
function createDesktopHandoff({platform=process.platform,exists=require('fs').existsSync,clipboard,execFile=require('child_process').execFile,readHandoff,openBrowser,disabled=false}) {
    function availability(){
        if(disabled)return {available:false,reason:'Desktop handoff is disabled in this test run.'};
        if(platform!=='darwin')return {available:false,browser_available:!!openBrowser,reason:'ChatGPT Desktop launch is currently available on macOS.'};
        if(!exists(CHATGPT_APP+'/Contents/Info.plist'))return {available:false,browser_available:!!openBrowser,reason:'ChatGPT Desktop was not found in /Applications.'};
        return {available:true,browser_available:!!openBrowser,manual_paste:true};
    }
    async function copyAndOpen(id,destination='desktop') {
        if(!['desktop','browser'].includes(destination))throw new Error('Unsupported manual handoff destination');
        const available=availability();if(destination==='desktop'?!available.available:!available.browser_available)return available;
        if(!/^[a-f0-9-]{36}$/i.test(String(id)))throw new Error('Invalid saved image handoff ID');
        const h=await readHandoff(id);
        if(h.state!=='prepared' || h.snapshot?.capability!=='image' || typeof h.prompt!=='string')throw new Error('Use a prepared image handoff.');
        try {clipboard.writeText(h.prompt);if(clipboard.readText()!==h.prompt)throw new Error('Clipboard verification failed');}
        catch(error){return {available:true,copied:false,opened:false,error:error.message};}
        try {
            if(destination==='browser')await openBrowser('https://chatgpt.com/');
            else await new Promise((resolve,reject)=>execFile('/usr/bin/open',['-a',CHATGPT_APP],{timeout:10000},error=>error?reject(error):resolve()));
            return {available:true,copied:true,opened:true,note:destination==='browser'?'Prompt copied. Paste in ChatGPT web and attach the exported numbered references yourself.':'Prompt copied. Switch to Chat in the ChatGPT app, paste with Cmd-V, and attach the exported numbered references yourself.'};
        } catch(error){return {available:true,copied:true,opened:false,error:'Prompt copied; ChatGPT could not be opened: '+error.message};}
    }
    return {availability,copyAndOpen};
}
function registerDesktopHandoff({ipcMain,BrowserWindow,clipboard,shell,getApiBase,disabled}) {
    const h=createDesktopHandoff({clipboard,disabled,openBrowser:url=>shell.openExternal(url),readHandoff:async id=>{
        const base=getApiBase();const url=new URL(base);
        if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Desktop handoff requires the local Film Engine backend.');
        const response=await fetch(base+`/film/final-request-review/handoffs/${id}`);
        const data=await response.json();if(!response.ok)throw new Error(data.error || 'Could not read saved handoff');return data;
    }});
    const check=event=>{if(!BrowserWindow.fromWebContents(event.sender))throw new Error('Handoff is available only from a Film Engine window');};
    ipcMain.handle('fe-image-handoff-availability',event=>{check(event);return h.availability();});
    ipcMain.handle('fe-image-handoff-open',(event,id,destination)=>{check(event);return h.copyAndOpen(id,destination);});
}
module.exports={createDesktopHandoff,registerDesktopHandoff,CHATGPT_APP};
