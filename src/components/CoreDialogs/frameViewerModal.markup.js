// frameViewerModal: the app's own markup, moved verbatim from the source (see CoreDialogs.jsx). A string module.
export default `
    <!-- ════════════════════════════════════════════════════════════
         MODALS (14)
         ════════════════════════════════════════════════════════════ -->

    <!-- New Project -->
    <div class="modal-overlay" id="frameViewerModal" onclick="closeModal('frameViewerModal')">
        <div style="width:96vw;height:94vh;display:flex;flex-direction:column;gap:8px;" onclick="event.stopPropagation()">
            <div class="flex-between" style="color:var(--gl-text-primary);">
                <strong id="frameViewerTitle"></strong>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button class="btn btn-sm btn-secondary" onclick="frameViewerStep(-1)" title="previous shot">&larr;</button>
                    <button class="btn btn-sm btn-secondary" onclick="frameViewerStep(1)" title="next shot">&rarr;</button>
                    <button class="modal-close" onclick="closeModal('frameViewerModal')">&times;</button>
                </div>
            </div>
            <div style="flex:1;min-height:0;position:relative;">
                <img id="frameViewerImg" style="width:100%;height:100%;object-fit:contain;background:#000;border-radius:4px;display:block;"
                     onload="markupDraw('frameViewerAnnot','frameViewerImg',frameViewerShotId())">
                <canvas id="frameViewerAnnot" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;"></canvas>
            </div>
            <div id="frameViewerTools" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;"></div>
            <div id="frameViewerCaption" class="text-sm" style="max-height:20vh;overflow:auto;"></div>
        </div>
    </div>
`;
