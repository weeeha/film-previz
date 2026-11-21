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
