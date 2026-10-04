// newProjectModal: the app's own markup, moved verbatim from the source (see CoreDialogs.jsx). A string module.
export default `
<div class="modal-overlay" id="newProjectModal">
        <div class="modal">
            <div class="modal-header"><h3>New Project</h3><button class="modal-close" onclick="closeModal('newProjectModal')">&times;</button></div>
            <div class="modal-body">
                <!--
                    Film or Spot, and it is the highest-leverage choice in the
                    modal: it sets the frame rate, the runtime target and the
                    deliverable set in ONE action, and every one of those is
                    expensive to discover late. A spot generated at 24fps for a
                    29.97 CTV buy cannot be fixed in the grade, and a vertical
                    placement decided after the board is a crop that keeps a
                    third of the frame.
                -->
                <div class="form-group">
                    <label>What is this?</label>
                    <select id="newProjectType" onchange="onProjectTypeChange()">
                        <option value="film">Film &mdash; runs as long as it runs</option>
                        <option value="spot">Commercial &mdash; bought by the second, delivered in many shapes</option>
                    </select>
                </div>
                <div class="form-group"><label>Title</label><input type="text" data-field="title" placeholder="My Film" oninput="previewProjectFolder()"></div>
                <!--
                    WHERE THIS FILM'S FILES GO, asked up front. Every plate,
                    frame, clip and sound lands in one folder named after the
                    film, laid out in the order the film is made — instead of
                    being spread across a hidden data folder by kind.
                -->
                <div class="form-group"><label>Save files in</label>
                    <div style="display:flex;gap:6px;">
                        <input type="text" id="newProjectLocation" placeholder="~/Film Engine" oninput="previewProjectFolder()" style="flex:1;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="openFolderPicker('newProjectLocation')">Browse&hellip;</button>
                    </div>
                    <span class="text-sm text-muted" id="newProjectFolderPreview">This film gets its own folder here.</span></div>
                <div class="form-group"><label>Logline</label><textarea data-field="logline" rows="2" placeholder="A brief summary..."></textarea></div>
                <div class="form-group" data-when="film"><label>Genre</label><input type="text" data-field="genre" placeholder="Drama, Sci-Fi, Thriller"></div>

                <!-- Only for a spot. A film has no client and no bought runtime. -->
                <div class="form-group" data-when="spot" style="display:none;"><label>Client</label>
                    <input type="text" id="newProjectClient" placeholder="Who the spot is for"></div>
                <div class="form-group" data-when="spot" style="display:none;"><label>Campaign</label>
                    <input type="text" id="newProjectCampaign" placeholder="Spring launch"></div>
                <div class="form-group" data-when="spot" style="display:none;"><label>Brand kit</label>
                    <select id="newProjectBrand"></select>
                    <span class="text-sm text-muted">Kits live in <strong>Brand</strong> and outlive this project.</span></div>
                <div class="form-group" data-when="spot" style="display:none;"><label>Length</label>
                    <select id="newProjectLength">
                        <option value="30000">:30</option>
                        <option value="15000">:15</option>
                        <option value="6000">:06</option>
                        <option value="60000">:60</option>
                        <option value="0">No fixed length</option>
                    </select>
                    <span class="text-sm text-muted">A conform that misses this by more than a frame refuses rather than trimming.</span></div>
                <div class="form-group" data-when="spot" style="display:none;"><label>Deliverables</label>
                    <select id="newProjectPackage">
                        <option value="campaign">Campaign &mdash; six files, air and social</option>
                        <option value="rapid">Rapid &mdash; three files, social first</option>
                        <option value="broadcast">Broadcast &mdash; six files, air led</option>
                        <option value="">None yet</option>
                    </select>
                    <span class="text-sm text-muted">Decided now because it is what says which shots must be <em>shot</em> vertical rather than cropped later.</span></div>
                <div class="form-group"><label>Style Preset</label>
                    <select data-field="style_preset">
                        <option value="cinematic">Cinematic</option>
                        <option value="noir">Noir</option>
                        <option value="anime">Anime</option>
                        <option value="documentary">Documentary</option>
                        <option value="horror">Horror</option>
                        <option value="fantasy">Fantasy</option>
                    </select>
                </div>
                <div class="form-group"><label>Target FPS</label>
                    <select data-field="target_fps">
                        <option value="24">24 fps (Film)</option>
                        <option value="25">25 fps (PAL)</option>
                        <option value="30">30 fps (NTSC)</option>
                    </select>
                </div>
                <div class="btn-row">
                    <button class="btn btn-primary" onclick="createProject()">Create Project</button>
                    <button class="btn btn-secondary" onclick="closeModal('newProjectModal')">Cancel</button>
                </div>
            </div>
        </div>
    </div>
`;
