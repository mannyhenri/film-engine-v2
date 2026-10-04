// The character sheet's modal frame: the app's own markup, moved verbatim from the source's characterSheetModal (its
// header's inline handlers are what the backend's layout checks read). A string module, so the static render
// (tools/assemble-page.js, esbuild) bundles it as it is.
export default `
    <!-- Create Character -->
    <!--
      The subject workspace.
      ONE modal for characters, locations and props: the three differ only in
      which foreign key holds them, and three near-identical panels is how one
      of them ends up with the promote rule and the others do not.
    -->
    <!--
      Casting a voice, and hearing a line.
      This is a PLANNING surface: nothing here attaches to a shot, so a reading
      you were only trying out can never be mistaken for the take that ships.
    -->
    <!--
      The character sheet.
      The card carried eight buttons and clicking it did nothing; every one of
      those is something you do while LOOKING at the character, so they live
      here where there is room to see what you are doing.
    -->
    <div class="modal-overlay cs-overlay" id="characterSheetModal">
        <div class="modal cs-modal">
            <div class="cs-head">
                <div class="cs-head-left">
                    <h2 id="csName">CHARACTER</h2>
                    <div class="cs-chips" id="csChips"></div>
                </div>
                <div class="cs-head-right">
                    <button class="btn btn-primary btn-sm" onclick="generateOfficialViews()">Generate views</button>
                    <!-- Not in the reference: the design has no way to change
                         anything. Styled as the other header actions so it does
                         not read as a different kind of control. -->
                    <button class="btn btn-sm" id="csModeBtn" onclick="toggleSheetMode()">Edit</button>
                    <button class="btn btn-sm" onclick="exportCharacterSheet()">Export sheet</button>
                    <button class="modal-close" onclick="closeModal('characterSheetModal')">&times;</button>
                </div>
            </div>
            <div class="cs-body" id="csBody"></div>
        </div>
    </div>
`;
