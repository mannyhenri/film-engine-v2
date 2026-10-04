// The location and prop sheet's modal frame: the app's own markup, moved verbatim from the source's
// subjectSheetModal (its header's inline handlers are what the backend's layout checks read). A string module, not
// an .html?raw import, so the static render (tools/assemble-page.js, esbuild) can bundle it as it is.
export default `
    <!--
      A LOCATION AND A PROP ARE WORKSPACES TOO.
      The character card became a sheet and these stayed a form in a modal — the
      same gap seen from two other subjects. Regions are declared in
      lib/subject-sheets.js and the renderer is held to drawing every one, so a
      sheet cannot show the plates and silently drop the continuity states.
    -->
    <div class="modal-overlay cs-overlay" id="subjectSheetModal">
        <div class="modal cs-modal">
            <div class="cs-head">
                <div class="cs-head-left">
                    <h2 id="ssName">SUBJECT</h2>
                    <div class="cs-chips" id="ssChips"></div>
                </div>
                <div class="cs-head-right">
                    <button class="btn btn-primary btn-sm" id="ssGenerateBtn" onclick="generateSheetPlate()">Generate plate</button>
                    <button class="btn btn-sm" id="ssModeBtn" onclick="toggleSheetMode()">Edit</button>
                    <button class="btn btn-sm" onclick="exportSubjectSheet()">Export sheet</button>
                    <button class="modal-close" onclick="closeModal('subjectSheetModal')">&times;</button>
                </div>
            </div>
            <div class="cs-body" id="ssBody"></div>
        </div>
    </div>
`;
