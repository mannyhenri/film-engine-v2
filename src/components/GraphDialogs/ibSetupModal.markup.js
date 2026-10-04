// ibSetupModal: the app's own markup, moved verbatim from the source (see GraphDialogs.jsx). A string module.
export default `
    <!-- Every attempt at one shot. They have always been kept on disk; this is
         the way back to one. -->

    <!-- In-betweens: how many frames, how often, between two key shots -->
    <div class="modal-overlay ib-overlay" id="ibSetupModal" onclick="ibCloseSetup()">
        <div class="modal-content" style="max-width:600px;" onclick="event.stopPropagation()" role="dialog" aria-labelledby="ibSetupTitle">
            <div class="flex-between mb-16">
                <h2 id="ibSetupTitle">In-betweens</h2>
                <button class="modal-close" onclick="ibCloseSetup()" aria-label="Close">&times;</button>
            </div>
            <div id="ibSetupBody"></div>
        </div>
    </div>
`;
