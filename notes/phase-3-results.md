# Phase 3 results

## Task 18: zip library

Two candidates, both installed in a scratch folder and read from their own files on 2026-11-21.

| | fflate 0.8.3 | JSZip 3.10.2 |
|---|---|---|
| Licence (own LICENSE file) | MIT, Copyright (c) 2026 Arjun Barrett | MIT or GPL-3.0, at the user's choice (LICENSE.markdown) |
| Browser build, minified, gzipped | ESM build 90,922 bytes, 22,403 gzipped (unminified browser entry) | `dist/jszip.min.js` 97,781 bytes, 28,539 gzipped |
| Dependencies | none | several, bundled in `dist` |
| API | `zipSync` on byte arrays, no DOM, no streams needed | Promise API, `generateAsync` |
| Safari | plain typed arrays and Blob, no feature that WebKit lacks; the e2e export test downloads and unzips the file in WebKit | not tested |

Choice: fflate, pinned to exact 0.8.3. It is plain MIT with no dual-licence choice to make, it is smaller, and the export only needs to pack a few byte arrays. This resolves the spec's unverified JSZip licence: JSZip is MIT or GPL-3.0, so it would have been usable under MIT too, but there was no reason to take it.

JPEG frames are stored without recompression (level 0). Text files use level 6.

## Task 18: deviations

- `floor-plan.png` is not exported. It depends on the stand-ins work (tasks 21 to 24), which is not built. The export panel keeps the draft's floor plan row and says "Not included yet. Top-down view with numbered cameras arrives with stand-ins." The location sheet says the floor plan is not included in this export yet.
- The Shots view notice for unconfirmed scale says "height unverified" (singular) in the quoted text, to match the cell text in `shot-list.md`.

## Task 18: checks

- `npm test` with `FILM_CRAFT_SHOT_LIST` set to film-craft's `templates/shot-list.md`: 83 tests in total, 8 of them new, all passed. Unset: the header test is skipped and its title says why.
- Planted fault: swapping the Job and Size header cells made `shot_list_header_matches_film_craft` fail; reverted.
- e2e `tests/e2e/export.spec.ts` (Chromium and WebKit): saves 3 shots on the 500k set, clicks Export, captures the download, unzips it in Node. 3 JPEGs with JPEG magic bytes, `shots.json` records pass `validateShot`, 3 table rows, location sheet and `scene-ref.json` present, the scene file's first 64 bytes are in neither the zip nor any file in it. Planting those 64 bytes in a file made the check fail; reverted.
- Hand check of the fit: the exported `shot-list.md` rows were put under the template's own header region in a scratch file under `out/` (git-ignored). The header line and separator line are byte-identical to the template's, and the header and each of the 3 rows parse to 12 cells. No browser rendering inside film-craft was done, and no markdown renderer was run; the table was checked by script.

## Task 20: audit and fixes

The states walk (`notes/phase-3-states.md`) found six defects and twelve differences from the draft. The 17 fixes below came from that list, the unslop review and the controller's own look. Evidence: `tests/e2e/audit-fixes.spec.ts` (Chromium and WebKit), before and after screenshots in the git-ignored `reference/app/audit-fix/` (Chromium and WebKit, light; dark for the Shots size select and the Stage footer), and the numbers printed by the tests.

### The 17 items

1. Fixed. Scenes preview 420 px to 190 px, and the Scenes spacing tightened (page padding and gap, Scale block margin and gap, file row and facts padding, an empty measure line no longer takes a row). With a loaded 500k scene, collider and confirmed scale at 1440 x 900, "Open Stage" has its top at y 767 (Chromium) and 783 (WebKit), against the limit of 800. Asserted with `getBoundingClientRect` in `audit_fixes_first_screen_...`. Planted fault: the old 420 px preview put it at 966 and the test failed.
2. Fixed. `.size-edit` is `width: auto`, so the select takes its widest option. Measured select width 75 px (Chromium) and 77 px (WebKit) against a widest option of 44 px, asserted at least 20 px more than the text. "Not set" is whole in `shots-default-*` light and dark.
3. Fixed. The hash mismatch state shows the collider line and a "Choose collider mesh" button under the warning (`scenes-mismatch-*`).
4. Fixed. Below 0.1 s the fact reads "under 0.1 s" (`scenes-loaded-*`). The tiny-scene e2e accepts both forms.
5. Fixed. The scale chip is hidden until a scene is open, so the header reads only "No scene loaded" (`scenes-empty-*`, `scenes-error-spz-*`). Asserted in `stage.spec.ts`.
6. Fixed. With no scene the Stage disables Save shot, Save frame and the look-through switch, draws no frame mask, hides the "Frame mask" text and hides the scale-not-confirmed notice (`stage-noscene-*`). Asserted in `stage.spec.ts`.
7. Fixed. The count line in the Shots page head is gone. The table footer and the Export line keep it (`shots-default-*`). Asserted: `#shot-count-head` is absent and `#row-count` reads "3 shots".
8. Fixed. The export row reads "Saved at the shot's aspect, without overlays." The floor plan row is unchanged. Asserted.
9. Fixed. "Scene source" and "Scale source".
10. Fixed. The footer is two rows in every state: the filled control (with "Save as new shot" beside it while a shot is open), then "Save frame" full width. Measured in the 500k test: "Save frame" is below the filled control both with no shot open and with "Update shot 40", and "Save as new shot" shares the first row (`stage-default-*`, `stage-editing-*`, light and dark).
11. Fixed. `.inspector-scroll` has 24 px bottom padding. Scrolled to the end, the last section ends at least 8 px above the footer (asserted) and the cut falls between rows (`stage-inspector-scrolled-*`).
12. Fixed. The parse error has a plain first sentence, the reader's message on a smaller second line ("Reader message: ...") and then the advice. "Choose another file" is filled and "Try as PLY" is outlined (`scenes-error-spz-*`). The existing e2e now asserts this.
13. Fixed. "Open Stage" on Scenes, "Open Stage" and "Open Scenes" in the empty states and the Stage strip shots are buttons. Header tabs and the logo stay links. New e2e in both browsers: plain Tab reaches each one and Enter does the action. WebKit needed 1 Tab press to "Open Stage" on Shots, 3 to the first strip shot, 6 to "Open Stage" on Scenes and 1 to "Open Scenes". The existing e2e that clicked strip links now uses buttons.
14. Fixed. Cause confirmed: the visually hidden `<p id="preset-reason" class="sr">` is `position: absolute` with no positioned ancestor, so it sat below the fold and stretched the document to 924 px. Setting `position: relative` on `main` clips it. Measured before: 924 of 900. After: 900 of 900. Asserted in both Stage tests, including the state with the scale notice showing. Planted fault: removing `position: relative` gave 924 and the test failed. Note the first assertion alone did not catch it, because with a confirmed scale the notice is hidden and the paragraph sits higher; the second test covers that.
15. Fixed. Reads "Floor was 1.230 m below the origin" (or "above", or "at the origin" under 0.5 mm). Direction follows `applyScale`: the content is moved down by the offset, so a positive offset means the floor was above the origin. The maths is unchanged. Asserted by pattern.
16. Fixed. Without WebGL 2 the Stage and Shots routes replace the hash with `#/`, so the Scenes tab is current. Asserted in `scenes_without_webgl2_says_so_on_every_route`.
17. Fixed. Removed `.draftbar`, the `.r-*` drawing classes, `.viewport > svg.room`, `.ref-lines`, `.ref-on`, `--draft-bg`, the draft-only `--vp-*` greys (ceil, wall, wall-side, floor, line, obj, door, figure) and the "static draft" comment. Grep of `src/` and `index.html` found no use. `--vp-bg`, `--vp-ref`, `--vp-ref-case`, `--vp-text` and `--vp-scrim` stay because the frame mask and compare layer use them.

17 of 17 are fixed.

### Open differences from the draft (kept on purpose, for the owner)

- The Scenes preview viewport (the draft has none). It is now 190 px high.
- The two Source fields, now labelled "Scene source" and "Scale source".
- The Markers section.
- The editable Size select in the Shots table (the draft shows plain text).
- The "Save frame" button (the draft has none).
- The no-scene states on Stage and Shots (the draft has neither).
- "Mark the floor again" stays out: no behaviour sits behind it.
- Viewport grey 74,77,83 (a cool grey) stays.
- The Stand-ins section with its "Later step" badge stays as in the approved draft.

### Not fixed, as ruled

The Undo notice pushing the table down, the name cell growing on focus, the Sensor select label offset in WebKit, and the Stage hint text (it still reads "Arrow keys nudge the shot camera." with no scene open, where the switch is now disabled).

### Noticed, not fixed

- The "Set scale" links in the Stage notice and the Shots unverified notice are still `<a>` links, so plain Tab skips them in Safari.
- The states walk script (`tests/audit/states-walk.mjs`) was written against the old markup (strip links, the filled "Try as PLY"). It needs updating before its next run.

### Test results for the fixes

- `npm run typecheck`: clean. `npm test` with `FILM_CRAFT_SHOT_LIST` set: 8 files, 93 tests passed.
- `npm run test:e2e` full run (load average about 20): 73 passed, 3 failed. `export_three_shots...` (Chromium) timed out on a 5 s poll for the open scene while the machine was loaded, and passed on a rerun (1.1 m). `reference_compare...` (Chromium and WebKit) failed because it used the Stage with no scene, where look-through is now disabled (item 6); the test now opens a small scene first and passes in both browsers (4.8 s and 2.0 s).
- Existing e2e updated to the new behaviour, none deleted: strip links to buttons, the header chip with no scene, the no-scene Stage notice, the "First frame" pattern, the Try as PLY button class, the Shots page head count, and the WebGL2 route check.
