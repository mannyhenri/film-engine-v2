// The Screenplay's newSceneCardModal: the app's own markup, moved verbatim from the source (its inline handlers call the
// Screenplay engine, which the Screenplay page puts on window, and core). A string module (see ScreenplayDialogs.jsx).
export default `
<div class="modal-overlay" id="newSceneCardModal">
        <div class="modal">
            <div class="modal-header"><h3>New scene</h3><button class="modal-close" onclick="closeModal('newSceneCardModal')">&times;</button></div>
            <div class="modal-body">
                <div class="form-group"><label>Scene heading</label>
                    <input type="text" id="newSceneHeading" placeholder="INT. KITCHEN - DAY"></div>
                <div class="form-group"><label>What happens</label>
                    <textarea id="newSceneSynopsis" rows="6" placeholder="Ray waits by the window."></textarea></div>
                <div class="btn-row">
                    <button class="btn btn-primary" onclick="createIndexCard()">Add</button>
                    <button class="btn btn-secondary" onclick="closeModal('newSceneCardModal')">Cancel</button>
                </div>
            </div>
        </div>
    </div>
`;
