// The Screenplay's titlePageModal: the app's own markup, moved verbatim from the source (its inline handlers call the
// Screenplay engine, which the Screenplay page puts on window, and core). A string module (see ScreenplayDialogs.jsx).
export default `
    <!-- FILM-128: Title Page Modal -->
    <div class="modal-overlay" id="titlePageModal">
        <div class="modal modal-md title-page-modal">
            <div class="modal-header">
                <h3>Edit Title Page</h3>
                <button class="modal-close" onclick="closeModal('titlePageModal')">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-row">
                    <div class="form-group form-group-full">
                        <label>Title</label>
                        <input type="text" id="titlePageTitle" placeholder="Screenplay Title">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Credit</label>
                        <input type="text" id="titlePageCredit" placeholder="Written by" value="Written by">
                    </div>
                    <div class="form-group">
                        <label>Author(s)</label>
                        <input type="text" id="titlePageAuthor" placeholder="Author Name">
                    </div>
                </div>
                <div class="form-group">
                    <label>Source (Optional)</label>
                    <input type="text" id="titlePageSource" placeholder="Based on the novel by...">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Draft Date</label>
                        <input type="text" id="titlePageDraftDate" placeholder="January 2026">
                    </div>
                    <div class="form-group">
                        <label>Copyright</label>
                        <input type="text" id="titlePageCopyright" placeholder="© 2026 Author Name">
                    </div>
                </div>
                <div class="form-group">
                    <label>Contact Info</label>
                    <textarea id="titlePageContact" rows="3" placeholder="Agent Name&#10;Agency&#10;Email / Phone"></textarea>
                </div>
                <div class="form-group">
                    <label>Notes (Optional)</label>
                    <textarea id="titlePageNotes" rows="2" placeholder="Any additional notes..."></textarea>
                </div>
                <div class="btn-row mt-16">
                    <button class="btn btn-primary" onclick="saveTitlePage()">Save Title Page</button>
                    <button class="btn btn-outline" onclick="clearTitlePage()">Clear</button>
                    <button class="btn btn-secondary" onclick="closeModal('titlePageModal')">Cancel</button>
                </div>
            </div>
        </div>
    </div>
`;
