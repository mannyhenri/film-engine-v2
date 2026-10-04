// The Screenplay's versionDiffModal: the app's own markup, moved verbatim from the source (its inline handlers call the
// Screenplay engine, which the Screenplay page puts on window, and core). A string module (see ScreenplayDialogs.jsx).
export default `
    <!-- FILM-125: Version Diff Modal -->
    <div class="modal-overlay" id="versionDiffModal">
        <div class="modal modal-lg">
            <div class="modal-header">
                <h3>Compare Script Versions</h3>
                <button class="modal-close" onclick="closeModal('versionDiffModal')">&times;</button>
            </div>
            <div class="modal-body">
                <div class="diff-stats" id="diffStats"></div>
                <div class="diff-view" id="diffView"></div>
            </div>
        </div>
    </div>
`;
