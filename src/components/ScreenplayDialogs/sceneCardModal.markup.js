// Independent scene summaries and notes; screenplay source remains read-only here.
export default `
<div class="modal-overlay" id="sceneCardModal">
        <div class="modal">
            <div class="modal-header"><h3 id="sceneCardTitle">Scene</h3><button class="modal-close" onclick="closeModal('sceneCardModal')">&times;</button></div>
            <div class="modal-body">
                <input type="hidden" id="sceneCardIndex">
                <p id="sceneCardHeading"></p>
                <div class="form-group"><label for="sceneCardSynopsis">Summary</label>
                    <textarea id="sceneCardSynopsis" rows="7" maxlength="20000"></textarea></div>
                <div class="form-group"><label for="sceneCardNotes">Your notes</label>
                    <textarea id="sceneCardNotes" rows="5" maxlength="20000"></textarea></div>
                <p class="text-muted text-sm">Summary and notes are saved separately. The screenplay stays unchanged.</p>
                <p id="sceneCardError" role="alert"></p>
                <div class="btn-row">
                    <button id="sceneCardSave" class="btn btn-primary" onclick="saveIndexCard()">Save</button>
                    <button class="btn btn-secondary" onclick="closeModal('sceneCardModal')">Cancel</button>
                </div>
            </div>
        </div>
    </div>
`;
