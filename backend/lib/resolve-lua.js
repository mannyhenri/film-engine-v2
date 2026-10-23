'use strict';
/**
 * RESOLVE LUA: the cut into a NEW Resolve project, from inside free DaVinci Resolve.
 *
 * Free Resolve 21 has no external scripting (Film Engine cannot drive it from outside) and dropped Python, so
 * "Import into Resolve.py" cannot run there: a send opened Resolve on its project screen and stopped. Its Lua scripts
 * DO reach the Resolve API from Workspace › Scripts (verified on this Mac: a Utility script read the project and its
 * media pool), but get no `io`, so they cannot list a folder. This writes the import as Lua with every file of the
 * package written into it, and installs it as Workspace › Scripts › "Film Engine - Load Latest Cut":
 *
 *   a new project (the film and the cut's name; " (2)" and on when that name is taken), its frame rate and size,
 *   a bin per scene with a bin per kind (Video, Stills, Sound) holding the package's media, the cut's timeline
 *   (the FCP7 XML, its clips matched to the media just imported), the shot markers, and the Edit page.
 *
 * One click in Resolve (with any project open, since Resolve shows its Scripts menu only inside a project).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MENU_NAME = 'Film Engine - Load Latest Cut';
const scriptsDir = () => process.env.FILM_RESOLVE_SCRIPTS_DIR
    || path.join(os.homedir(), 'Library', 'Application Support', 'Blackmagic Design', 'DaVinci Resolve', 'Fusion', 'Scripts', 'Utility');

/** A Lua string literal. */
function lq(s) {
    return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
}
const list = items => '{ ' + items.map(lq).join(', ') + ' }';

function filesIn(dir) {
    const out = [];
    const walk = d => {
        let names = []; try { names = fs.readdirSync(d).sort(); } catch (_) { return; }
        for (const n of names) {
            if (n.startsWith('.')) continue;
            const p = path.join(d, n);
            const st = fs.statSync(p);
            if (st.isDirectory()) walk(p); else out.push(p);
        }
    };
    walk(dir);
    return out;
}

/** The bins as the package lays them out: a scene folder's own files, then a bin per kind folder inside it. */
function binsOf(dest, folders) {
    return (folders || []).map(folder => {
        const full = path.join(dest, folder);
        let names = []; try { names = fs.readdirSync(full).sort(); } catch (_) { return null; }
        const own = names.filter(n => !n.startsWith('.') && fs.statSync(path.join(full, n)).isFile()).map(n => path.join(full, n));
        const kinds = names.filter(n => !n.startsWith('.') && fs.statSync(path.join(full, n)).isDirectory())
            .map(n => ({ name: n, files: filesIn(path.join(full, n)) })).filter(k => k.files.length);
        return own.length || kinds.length ? { name: folder, files: own, kinds } : null;
    }).filter(Boolean);
}

function buildLuaScript(plan, dest, xmlName, markers) {
    const [w, h] = String(plan.resolution || '1920x1080').split('x');
    const project = plan.cut ? `${plan.title} - ${plan.timeline_name || 'cut'}` : plan.title;
    const bins = binsOf(dest, plan.folders);
    return `-- ${MENU_NAME}: written by Film Engine for "${String(plan.timeline_name || plan.title).replace(/\n/g, ' ')}" on ${new Date().toISOString()}.
-- Makes a NEW project with this cut's timeline and media. Run it from Workspace > Scripts with any project open.
local HERE = ${lq(dest)}
local PROJECT = ${lq(project)}
local TIMELINE = ${lq(plan.timeline_name || plan.title + ' - first edit')}
local XML = ${lq(path.join(dest, xmlName))}
local SETTINGS = { timelineFrameRate = ${lq(String(plan.fps))}, timelinePlaybackFrameRate = ${lq(String(plan.fps))}, timelineResolutionWidth = ${lq(w)}, timelineResolutionHeight = ${lq(h)} }
local BINS = {
${bins.map(b => `  { name = ${lq(b.name)}, files = ${list(b.files)}, kinds = {
${b.kinds.map(k => `    { name = ${lq(k.name)}, files = ${list(k.files)} },`).join('\n')}
  } },`).join('\n')}
}
local MARKERS = {
${(markers || []).map(m => `  { frame = ${Number(m.frame) || 0}, color = ${lq(m.color || 'Blue')}, name = ${lq(m.name)}, note = ${lq(m.note)} },`).join('\n')}
}

local r = resolve or (bmd and bmd.scriptapp and bmd.scriptapp("Resolve"))
if not r then print("Film Engine: run this from DaVinci Resolve's Workspace > Scripts menu.") return end
local pm = r:GetProjectManager()
local name, n = PROJECT, 2
local project = pm:CreateProject(name)
while not project and n < 100 do name = PROJECT .. " (" .. n .. ")"; n = n + 1; project = pm:CreateProject(name) end
if not project then print("Film Engine: could not make a new project named " .. PROJECT) return end
for k, v in pairs(SETTINGS) do project:SetSetting(k, v) end
local pool = project:GetMediaPool()
local root = pool:GetRootFolder()
local imported = 0
for _, b in ipairs(BINS) do
  local bin = pool:AddSubFolder(root, b.name)
  if #b.files > 0 then pool:SetCurrentFolder(bin); local got = pool:ImportMedia(b.files); imported = imported + (got and #got or 0) end
  for _, k in ipairs(b.kinds) do
    pool:SetCurrentFolder(pool:AddSubFolder(bin, k.name))
    local got = pool:ImportMedia(k.files); imported = imported + (got and #got or 0)
  end
end
pool:SetCurrentFolder(root)
local tl = pool:ImportTimelineFromFile(XML, { timelineName = TIMELINE, importSourceClips = false, sourceClipsPath = HERE })
if not tl then print("Film Engine: the media is in, but the timeline did not import. File > Import > Timeline and pick " .. XML) return end
project:SetCurrentTimeline(tl)
local marked = 0
for _, m in ipairs(MARKERS) do if tl:AddMarker(m.frame, m.color, m.name, m.note, 1) then marked = marked + 1 end end
pm:SaveProject()
r:OpenPage("edit")
print("Film Engine: project " .. name .. ", timeline " .. TIMELINE .. ", " .. imported .. " clips, " .. marked .. " markers.")
`;
}

/** Write the script into the package (every export). */
function writeLuaScript(plan, dest, xmlName, markers) {
    fs.writeFileSync(path.join(dest, 'Load into Resolve.lua'), buildLuaScript(plan, dest, xmlName, markers), 'utf8');
    return { script: 'Load into Resolve.lua', menu: `Workspace › Scripts › ${MENU_NAME}` };
}

/** Put a package's script in Resolve's Scripts menu, replacing the previous send's: only when the user sends. */
function installLuaScript(dest) {
    try {
        fs.mkdirSync(scriptsDir(), { recursive: true });
        const installed = path.join(scriptsDir(), `${MENU_NAME}.lua`);
        fs.copyFileSync(path.join(dest, 'Load into Resolve.lua'), installed);
        return { installed, menu: `Workspace › Scripts › ${MENU_NAME}` };
    } catch (err) { return { installed: null, install_error: err.message }; }
}

/** Free Resolve (no Studio app installed): external scripting is not there, so the menu script is the way in. */
function isFreeResolve(platform = process.platform) {
    if (platform !== 'darwin') return false;
    const root = '/Applications/DaVinci Resolve';
    return fs.existsSync(path.join(root, 'DaVinci Resolve.app')) && !fs.existsSync(path.join(root, 'DaVinci Resolve Studio.app'));
}

module.exports = { buildLuaScript, writeLuaScript, installLuaScript, binsOf, isFreeResolve, MENU_NAME, scriptsDir, lq };
