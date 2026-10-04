// plateViewerModal: the app's own markup, moved verbatim from the source (see CoreDialogs.jsx). A string module.
export default `
    <!-- Create Prop -->
    <!-- The style-book editor. Every camera facet the card carries has a
         control, and each says what it is FOR — height in particular, which is
         the facet that makes a low-angle sayable and the one nobody fills in. -->
    <!--
      THE PLATE VIEWER — any reference picture, at the size it was generated.

      A plate conditions every frame its subject appears in, and until now it
      could only be seen at the width of whatever box it sat in: a 48px avatar,
      a 120px banner, a 340px column. The storyboard has had a full-screen frame
      viewer since it shipped; the plates had nothing.

      Deliberately NOT the frame viewer. That one carries a markup canvas and
      shot-to-shot stepping, both meaningless for a plate — reusing it would
      mean either dead controls or a second set of conditions inside it.
    -->
    <div class="modal-overlay" id="plateViewerModal" onclick="closeModal('plateViewerModal')">
        <div class="modal" style="max-width:min(96vw,1400px);width:auto;" onclick="event.stopPropagation()">
            <div class="modal-header">
                <strong id="plateViewerTitle"></strong>
                <button class="modal-close" onclick="closeModal('plateViewerModal')">&times;</button>
            </div>
            <div class="modal-body" style="padding-top:0;">
                <!-- contain, never cover: a viewer that crops hides exactly the
                     edges a director is checking. -->
                <img id="plateViewerImg" alt=""
                     style="max-width:100%;max-height:78vh;object-fit:contain;display:block;margin:0 auto;border-radius:6px;background:#08080a;">
                <p id="plateViewerMeta" class="text-sm text-muted" style="margin-top:8px;text-align:center;"></p>
            </div>
        </div>
    </div>
`;
