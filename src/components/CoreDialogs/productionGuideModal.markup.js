// productionGuideModal: the app's own markup, moved verbatim from the source (see CoreDialogs.jsx). A string module.
export default `
    <!-- Production Guide Modal -->
    <div class="modal-overlay" id="productionGuideModal">
        <div class="modal guide-modal">
            <div class="modal-header">
                <h3>Production Guide</h3>
                <button class="modal-close" onclick="closeProductionGuide()">&times;</button>
            </div>
            <div class="modal-body">
                <div id="productionGuideIntro"></div>
                <div class="guide-toolbar">
                    <input type="text" class="guide-search" id="productionGuideSearch" placeholder="Search sections, workflow, prerequisites..." oninput="renderProductionGuide()">
                    <div class="guide-tabs">
                        <button class="guide-tab active" data-guide-tab="sections" onclick="setGuideTab('sections')">Sections</button>
                        <button class="guide-tab" data-guide-tab="readiness" onclick="setGuideTab('readiness')">Readiness</button>
                    </div>
                </div>
                <div id="productionGuideBody"></div>
            </div>
        </div>
    </div>
`;
