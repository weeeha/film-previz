# Phase 3 states walk

Read time: about six minutes. This is the record of the Task 20 step 2 walk: every view of the built app against the spec section 6 states checklist, in Chromium and WebKit, light and dark, with the approved draft shot beside it. Nothing here was fixed. Defects are recorded for the next step.

## How it was run

- Script: `tests/audit/states-walk.mjs`, run with `npm run audit:states`. It is not part of `npm run test:e2e`. It starts its own dev server on 5185 and a static server for `draft/` on 5191, and stops both.
- It drives the real app: files go in through `setInputFiles` on the real file inputs (and a real file chooser for "Choose file again"), clicks and keys are real. The only data made another way is the shots: 3, 4 and 40 shot records plus a noise JPEG frame each were written through the store, because saving 40 shots through the Stage takes about 3 minutes each way under SwiftShader. Their frames are random noise, so the strip and table thumbnails look like static. That is test data, not a defect.
- Chromium uses the e2e flags `--use-angle=swiftshader --enable-unsafe-swiftshader`. WebKit is Playwright's cached build, no flags. 1440 x 900, `colorScheme` light and dark.
- Screenshots are in the git-ignored `reference/app/audit/`, named `<view>-<state>-<browser>-<theme>.png`. A `-full.png` twin exists where the Scenes or Shots page scrolls inside its `main` element. Draft shots are `draft-<view>-<state>-chromium-<theme>.png`. Six `stage-*-chromium-*-full.png` files in that folder are left over from an earlier run of the script and should be ignored.
- `manifest.json` (Tab stops, pixel reads, loading observations) and `console.json` sit next to the images.
- I opened every screenshot named below, most of them in 2 x 2 or 2 x 3 contact sheets at half size, the Chromium light default pages and a few others at full size. Text under 12 px at half size was judged by layout, not read letter by letter. Contrast was judged by eye, not measured.
- Cell words: "seen" (screenshot exists and I looked at it), "not reachable" (with the reason), "defect" (one line, details below), and "not covered" (a gap in this walk, only hover).

## Results

Cells: 122 seen, 18 not reachable, 24 defect, 12 not covered (hover). 216 PNG files are in the folder (56 draft, 160 app, of which 6 are the stale files above).

### Scenes

| State | Chromium light | Chromium dark | WebKit light | WebKit dark |
|---|---|---|---|---|
| Default (scene open, scale confirmed) | seen, `scenes-default-chromium-light.png` | seen, `scenes-default-chromium-dark.png` | seen, `scenes-default-webkit-light.png` | seen, `scenes-default-webkit-dark.png` |
| Empty: no scene yet | seen, `scenes-empty-chromium-light.png` | seen, `scenes-empty-chromium-dark.png` | seen, `scenes-empty-webkit-light.png` | seen, `scenes-empty-webkit-dark.png` |
| Focus: representative control | seen, `scenes-focus-chromium-light.png` | seen, `scenes-focus-chromium-dark.png` | defect, `scenes-focus-webkit-light.png`: the filled Open Stage link is not a Tab stop, focus shown on the first button instead (D3) | defect, `scenes-focus-webkit-dark.png`: the filled Open Stage link is not a Tab stop, focus shown on the first button instead (D3) |
| Focus: full Tab walk | seen, 22 stops, 0 unreached, 0 without a ring (manifest.json) | seen, 22 stops, 0 unreached, 0 without a ring (manifest.json) | defect, 17 stops, 5 links not reached by Tab (D3) | defect, 17 stops, 5 links not reached by Tab (D3) |
| Hover | not covered: hover was not captured in this walk, only keyboard focus | not covered: hover was not captured in this walk, only keyboard focus | not covered: hover was not captured in this walk, only keyboard focus | not covered: hover was not captured in this walk, only keyboard focus |
| Loading: scene load | not reachable: the load runs in about 0.3 to 2 s; the DOM showed the loading line but the screenshot call returned only after the load ended, so the image shows the loaded scene (`scenes-loading-chromium-light.png`) | not reachable: the load runs in about 0.3 to 2 s; the DOM showed the loading line but the screenshot call returned only after the load ended, so the image shows the loaded scene (`scenes-loading-chromium-dark.png`) | not reachable: the load runs in about 0.3 to 2 s; the DOM showed the loading line but the screenshot call returned only after the load ended, so the image shows the loaded scene (`scenes-loading-webkit-light.png`) | not reachable: the load runs in about 0.3 to 2 s; the DOM showed the loading line but the screenshot call returned only after the load ended, so the image shows the loaded scene (`scenes-loading-webkit-dark.png`) |
| Loading: collider load | not reachable: no image of the reading state: the 25 s screenshot timeout hit while the page was busy | not reachable: no image of the reading state: the 25 s screenshot timeout hit while the page was busy | not reachable: the DOM showed the reading line, the screenshot shows it already read | not reachable: the DOM showed the reading line, the screenshot shows it already read |
| Error: unsupported file | seen, `scenes-error-chromium-light.png` | seen, `scenes-error-chromium-dark.png` | seen, `scenes-error-webkit-light.png` | seen, `scenes-error-webkit-dark.png` |
| Error: corrupt SPZ (offers Try as PLY) | seen, `scenes-error-spz-chromium-light.png` | seen, `scenes-error-spz-chromium-dark.png` | seen, `scenes-error-spz-webkit-light.png` | seen, `scenes-error-spz-webkit-dark.png` |
| Error: WebGL2 missing (getContext stubbed) | seen, `scenes-nowebgl-chromium-light.png` | seen, `scenes-nowebgl-chromium-dark.png` | seen, `scenes-nowebgl-webkit-light.png` | seen, `scenes-nowebgl-webkit-dark.png` |
| Error: scene too large for memory | not reachable: needs a file that exhausts memory, none in the test set | not reachable: needs a file that exhausts memory, none in the test set | not reachable: needs a file that exhausts memory, none in the test set | not reachable: needs a file that exhausts memory, none in the test set |
| Error: scale not confirmed | seen, `scenes-noscale-chromium-light.png` | seen, `scenes-noscale-chromium-dark.png` | seen, `scenes-noscale-webkit-light.png` | seen, `scenes-noscale-webkit-dark.png` |
| Error: hash mismatch on re-open | seen, `scenes-mismatch-chromium-light.png` | seen, `scenes-mismatch-chromium-dark.png` | seen, `scenes-mismatch-webkit-light.png` | seen, `scenes-mismatch-webkit-dark.png` |
| Long content: 80 character scene name | seen, `scenes-long-chromium-light.png` | seen, `scenes-long-chromium-dark.png` | seen, `scenes-long-webkit-light.png` | seen, `scenes-long-webkit-dark.png` |
| Small screen 880 x 800 | seen, `scenes-small-chromium-light.png` | seen, `scenes-small-chromium-dark.png` | seen, `scenes-small-webkit-light.png` | seen, `scenes-small-webkit-dark.png` |
| Dark mode and viewport grey | seen, `scenes-default-chromium-light.png`; viewport corner pixels 74,77,83 (all four) | seen, `scenes-default-chromium-dark.png`; viewport corner pixels 74,77,83 (all four) | seen, `scenes-default-webkit-light.png`; viewport corner pixels 74,77,83 (all four) | seen, `scenes-default-webkit-dark.png`; viewport corner pixels 74,77,83 (all four) |

### Stage

| State | Chromium light | Chromium dark | WebKit light | WebKit dark |
|---|---|---|---|---|
| Default (scene open, scale confirmed, 4 shots) | seen, `stage-default-chromium-light.png` | seen, `stage-default-chromium-dark.png` | seen, `stage-default-webkit-light.png` | seen, `stage-default-webkit-dark.png` |
| Empty: no scene yet | seen, `stage-noscene-chromium-light.png` | seen, `stage-noscene-chromium-dark.png` | seen, `stage-noscene-webkit-light.png` | seen, `stage-noscene-webkit-dark.png` |
| Empty: scene with no shots (scale not confirmed) | seen, `stage-noshots-chromium-light.png` | seen, `stage-noshots-chromium-dark.png` | seen, `stage-noshots-webkit-light.png` | seen, `stage-noshots-webkit-dark.png` |
| Empty: no stand-ins (panel open) | seen, `stage-nostandins-chromium-light.png` | seen, `stage-nostandins-chromium-dark.png` | seen, `stage-nostandins-webkit-light.png` | seen, `stage-nostandins-webkit-dark.png` |
| Empty: no reference photo (panel open) | seen, `stage-noref-chromium-light.png` | seen, `stage-noref-chromium-dark.png` | seen, `stage-noref-webkit-light.png` | seen, `stage-noref-webkit-dark.png` |
| Error: scale not confirmed (3 unverified shots) | seen, `stage-noscale-chromium-light.png` | seen, `stage-noscale-chromium-dark.png` | seen, `stage-noscale-webkit-light.png` | seen, `stage-noscale-webkit-dark.png` |
| Error: WebGL2 missing | seen, `stage-nowebgl-chromium-light.png` | seen, `stage-nowebgl-chromium-dark.png` | seen, `stage-nowebgl-webkit-light.png` | seen, `stage-nowebgl-webkit-dark.png` |
| Focus: representative control (Save shot) | seen, `stage-focus-chromium-light.png` | seen, `stage-focus-chromium-dark.png` | seen, `stage-focus-webkit-light.png` | seen, `stage-focus-webkit-dark.png` |
| Focus: full Tab walk | seen, 32 stops, 0 unreached, 0 without a ring (manifest.json) | seen, 32 stops, 0 unreached, 0 without a ring (manifest.json) | defect, 24 stops, 8 links not reached by Tab: tabs and strip shots (D3) | defect, 24 stops, 8 links not reached by Tab: tabs and strip shots (D3) |
| Hover | not covered: hover was not captured in this walk, only keyboard focus | not covered: hover was not captured in this walk, only keyboard focus | not covered: hover was not captured in this walk, only keyboard focus | not covered: hover was not captured in this walk, only keyboard focus |
| Loading | not reachable: the Stage has no loading state of its own: scene and collider loads happen on Scenes | not reachable: the Stage has no loading state of its own: scene and collider loads happen on Scenes | not reachable: the Stage has no loading state of its own: scene and collider loads happen on Scenes | not reachable: the Stage has no loading state of its own: scene and collider loads happen on Scenes |
| Long content: 40 shots, 600 character note | seen, `stage-long-chromium-light.png` | seen, `stage-long-chromium-dark.png` | seen, `stage-long-webkit-light.png` | seen, `stage-long-webkit-dark.png` |
| Small screen 880 x 800 | seen, `stage-small-chromium-light.png` | seen, `stage-small-chromium-dark.png` | seen, `stage-small-webkit-light.png` | seen, `stage-small-webkit-dark.png` |
| Dark mode and viewport grey | seen, `stage-default-chromium-light.png`; viewport corner pixels about 68,76,84 (letterbox, same in both themes) | seen, `stage-default-chromium-dark.png`; viewport corner pixels about 68,76,84 (letterbox, same in both themes) | seen, `stage-default-webkit-light.png`; viewport corner pixels about 68,76,84 (letterbox, same in both themes) | seen, `stage-default-webkit-dark.png`; viewport corner pixels about 68,76,84 (letterbox, same in both themes) |

### Shots

| State | Chromium light | Chromium dark | WebKit light | WebKit dark |
|---|---|---|---|---|
| Default (4 shots, scale confirmed) | defect, `shots-default-chromium-light.png`: Size select clips its value to 'Not se' (D1) | defect, `shots-default-chromium-dark.png`: Size select clips its value to 'Not se' (D1) | defect, `shots-default-webkit-light.png`: Size select clips its value to 'Not se' (D1) | defect, `shots-default-webkit-dark.png`: Size select clips its value to 'Not se' (D1) |
| Empty: no scene yet | seen, `shots-noscene-chromium-light.png` | seen, `shots-noscene-chromium-dark.png` | seen, `shots-noscene-webkit-light.png` | seen, `shots-noscene-webkit-dark.png` |
| Empty: scene with no shots | seen, `shots-empty-chromium-light.png` | seen, `shots-empty-chromium-dark.png` | seen, `shots-empty-webkit-light.png` | seen, `shots-empty-webkit-dark.png` |
| Error: WebGL2 missing | seen, `shots-nowebgl-chromium-light.png` | seen, `shots-nowebgl-chromium-dark.png` | seen, `shots-nowebgl-webkit-light.png` | seen, `shots-nowebgl-webkit-dark.png` |
| Error: heights unverified (3 shots) | defect, `shots-unverified-chromium-light.png`: Size select clips its value to 'Not se' (D1) | defect, `shots-unverified-chromium-dark.png`: Size select clips its value to 'Not se' (D1) | defect, `shots-unverified-webkit-light.png`: Size select clips its value to 'Not se' (D1) | defect, `shots-unverified-webkit-dark.png`: Size select clips its value to 'Not se' (D1) |
| Loading: export in progress | seen, `shots-exporting-chromium-light.png` (12 or 13 of 40 frames) | seen, `shots-exporting-chromium-dark.png` (12 or 13 of 40 frames) | not reachable: export ran in about 1 s; the DOM showed 2 of 40 but the image shows it finished (`shots-exporting-webkit-light.png`) | not reachable: export ran in about 1 s; the DOM showed 2 of 40 but the image shows it finished (`shots-exporting-webkit-dark.png`) |
| Export done | defect, `shots-exported-chromium-light.png`: Size select clips its value to 'Not se' (D1) | defect, `shots-exported-chromium-dark.png`: Size select clips its value to 'Not se' (D1) | defect, `shots-exported-webkit-light.png`: Size select clips its value to 'Not se' (D1) | defect, `shots-exported-webkit-dark.png`: Size select clips its value to 'Not se' (D1) |
| Shot deleted, with Undo | seen, `shots-deleted-chromium-light.png` | seen, `shots-deleted-chromium-dark.png` | seen, `shots-deleted-webkit-light.png` | seen, `shots-deleted-webkit-dark.png` |
| Focus: representative control (Export shot list) | seen, `shots-focus-chromium-light.png` | seen, `shots-focus-chromium-dark.png` | seen, `shots-focus-webkit-light.png` | seen, `shots-focus-webkit-dark.png` |
| Focus: full Tab walk | seen, 44 stops, 0 unreached, 0 without a ring (manifest.json) | seen, 44 stops, 0 unreached, 0 without a ring (manifest.json) | defect, 40 stops, 4 tab links not reached by Tab (D3) | defect, 40 stops, 4 tab links not reached by Tab (D3) |
| Hover | not covered: hover was not captured in this walk, only keyboard focus | not covered: hover was not captured in this walk, only keyboard focus | not covered: hover was not captured in this walk, only keyboard focus | not covered: hover was not captured in this walk, only keyboard focus |
| Long content: 40 shots, 600 character note on row 40 | defect, `shots-long-chromium-light.png`: Size select clips its value to 'Not se' (D1); rows 33 to 40 in `shots-long-bottom-chromium-light.png` | defect, `shots-long-chromium-dark.png`: Size select clips its value to 'Not se' (D1); rows 33 to 40 in `shots-long-bottom-chromium-dark.png` | defect, `shots-long-webkit-light.png`: Size select clips its value to 'Not se' (D1); rows 33 to 40 in `shots-long-bottom-webkit-light.png` | defect, `shots-long-webkit-dark.png`: Size select clips its value to 'Not se' (D1); rows 33 to 40 in `shots-long-bottom-webkit-dark.png` |
| Small screen 880 x 800 | seen, `shots-small-chromium-light.png` | seen, `shots-small-chromium-dark.png` | seen, `shots-small-webkit-light.png` | seen, `shots-small-webkit-dark.png` |
| Dark mode | seen, `shots-default-chromium-light.png` | seen, `shots-default-chromium-dark.png` | seen, `shots-default-webkit-light.png` | seen, `shots-default-webkit-dark.png` |

## Keyboard walk, numbers

Real Tab presses from the top of each page until focus left the page. A stop counts as having a ring when its computed outline is not "none" or it has a box shadow; the representative control was also checked by comparing a crop with and without focus (differs in all 12 checks).

| View | Chromium (both themes) | WebKit (both themes) |
|---|---|---|
| Scenes | 22 stops, 0 not reached, 0 without a ring | 17 stops, 5 not reached: the logo link, the three tabs and Open Stage |
| Stage | 32 stops, 0 not reached, 0 without a ring | 24 stops, 8 not reached: the logo link, the three tabs and the four strip shots |
| Shots | 44 stops, 0 not reached, 0 without a ring | 40 stops, 4 not reached: the logo link and the three tabs |

The lens and height radio chips count as reached when one chip of the group is a stop, since a radio group is one Tab stop. In WebKit every `<a href>` is skipped by plain Tab (Safari's default). With Option+Tab (`Alt+Tab` in Playwright) the same links are reached: checked on `#/shots`, the sequence was logo, Scenes, Stage, Shots, Open Scenes. The draft has the same links, so this is the same on both sides.

## Viewport grey

Read from the PNG pixels at the four corners of the viewport element, scene open. Scenes: 74,77,83 in all four browser and theme combinations. Stage (letterbox, under the frame mask): 68,76,84 to 70,78,87 in Chromium, 67,75,83 to 69,77,86 in WebKit, identical between light and dark. So the grey is the same in both themes, as the spec asks. It is not strictly neutral: blue is 9 to 10 above red (74,77,83).

## Console

All warnings and errors from every page in the walk are in `console.json`. After removing duplicates:

- Expected: for the cut-short SPZ the app logs `corrupt gzip stream does not have a matching checksum` once as an error and once as a worker warning, in all four runs. That is the error state working.
- Chromium only, SwiftShader: `GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels`, 3 to 4 times per run. Not seen in WebKit. Not investigated.
- `Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute` comes from the audit script's own pixel reading, not from the app.
- No other warnings, no page errors, no failed requests.

## Differences between the built app and the approved draft

Compared in the pairs `draft-<view>-<state>-chromium-<theme>.png` and `<view>-<state>-chromium-<theme>.png`. Data differences (scene name, 4 shots against the draft's 6, noise frames, offset values) are left out unless noted. The draft's fixed "Draft only" footer is draft chrome and is not counted.

1. Scenes, every scene-open state: the app puts a live viewport preview between the file facts and the Scale block. The draft has no preview on Scenes, only the sentence about the reference figure standing in "the preview".
2. Header, every state with no scene open (empty, errors, WebGL2 missing): the app shows the amber "Scale not confirmed" chip next to "No scene loaded". The draft shows only "No scene loaded".
3. Scenes, WebGL2 missing: the draft keeps the Scale section ("The scale step opens after a scene has loaded.") and the Past scenes list under the error. The app shows only the error notice.
4. Stage and Shots routes with WebGL2 missing: the app shows the Scenes page, with the Stage or Shots tab highlighted and a "Scenes" heading under it. The draft shows this state on Scenes only.
5. Scenes, Ground block: the draft has a "Mark the floor again" button under the floor height and offset. The app has no such button.
6. Scenes, Ground block: "Offset removed" reads -1.230 m (Chromium) and -1.226 m (WebKit) in the app, 1.200 m in the draft. The sign differs. The values come from the marked points, so this needs a look at which sign the spec means, not a pixel fix.
7. Shots table, Size column: the draft shows plain text (WS, MS); the app shows an editable select in every row.
8. Stage footer, default state: the app shows "Save shot" and "Save frame". The draft shows "Update shot 2" and "Save as new shot" because it has a shot being edited. When a shot is open the app shows "Update shot N" and "Save as new shot" too (seen in `stage-long-*`), plus "Save frame" in both cases. The draft has no "Save frame" button at all.
9. Stage hint, top right: the app says "Arrow keys nudge the shot camera." with Look through shot camera checked. The draft says "Drag to look. W A S D to move." with the same checkbox checked.
10. Stage, no scene open and Shots, no scene open: the app has a state for each (viewport with empty mask and a disabled Save shot; "No scene open" with an Open Scenes button). The draft has neither.
11. Scrolling model: the draft scrolls the document; the app scrolls inside a fixed shell (`main`), so long Scenes pages scroll under a fixed header. The draft's pages are cut by its fixed footer instead.
12. Loading state: the draft header shows a "Loading" badge. Not compared, because the app's loading state could not be captured as an image (D2).

## Defects

Tagged with the id used in the table.

- D1 (Shots, all four combinations): the Size select is too narrow for its own value. "Not set" shows as "Not se" with the chevron over the last letter. Seen in `shots-default`, `shots-unverified`, `shots-long` and `shots-exported` for every browser and theme. Rows with WS, MS or CU fit.
- D2 (Scenes loading, Scenes collider loading, Shots export in progress): the loading states could not be captured as images in most runs. What I tried: waiting for `#load-line` and shooting at once; slowing Chromium with a 6 x CPU throttle (20 x for the export); using the 2 m file (8.4 MB) for the scene load. The DOM showed the loading text in all four runs ("Read 8.4 MB. Parsing and uploading the splats. This step cannot be cancelled." in Chromium, "Reading the file: 0.5 of 8.4 MB (6 percent)" in WebKit), but `page.screenshot` waits for a frame, the page is busy until the load ends, and the picture shows the finished state. Only the Chromium export was captured (`shots-exporting-chromium-*`, 12 or 13 of 40 frames, progress bar and disabled "Exporting" button visible). Not an app defect by itself. The loading layout is therefore unchecked against the draft.
- D3 (WebKit, Scenes, Stage, Shots): with plain Tab, no link is a stop: the tabs, the logo, the filled "Open Stage" link on Scenes, "Open Scenes" and "Open Stage" in the empty states, and the Stage strip shots. The spec says every control reachable by keyboard. In Safari this follows the browser setting "Press Tab to highlight each item", off by default; Option+Tab reaches them. The Scenes primary action being an `<a>` styled as a button is what makes this bite: a keyboard user in default Safari cannot reach "Open Stage" or any strip shot. Same markup as the draft.
- D4 (Stage, Chromium): the document is 924 px high in a 900 px window, so the page can be scrolled 24 px on the Stage while the app shell is 900 px. `main` itself does not overflow (852 of 852). Probable cause, not confirmed: the visually hidden radio inputs of the lens and height chips are `position: absolute` with no positioned ancestor and sit below the fold of the inspector, which extends the document. Measured in Chromium only, on the no-scene Stage in both themes; the earlier full-page captures of the other Stage states were 924 px high too.
- D5 (Chromium and WebKit, Scenes long and Shots long): an 80 character scene name is cut with an ellipsis in the header chip, the Past scenes row and the Shots export line ("... light l.") and wraps to the zip folder name. Not clipped content, listed for the long-content check: the header has the full name in its title attribute, the folder line wraps. No fix needed unless the owner wants the name shortened.
- D6 (viewport grey): 74,77,83 is a cool grey, not a neutral one. Same in both themes.
- Script artefacts, not app defects: the viewport is blank grey in `scenes-focus-*`, `stage-focus-*`, `scenes-loading-*` and `scenes-mismatch-*` when the render loop is paused and no frame has been drawn since the route changed; the script pauses the loop because SwiftShader draws a 500k scene at about 1 fps. Other shots run the loop for 2 s before the capture.
- Not defects, checked: no text overlaps another element in the shots I opened; the small-screen message shows on all three routes at 880 x 800 in all four combinations, with nothing else rendered; dark mode flips surfaces, text, notices and focus rings with no unreadable text that I could see (by eye).

## Not reachable, in short

- Scene too large for memory: needs a scene that exhausts the browser's memory; none in the test set.
- Loading states as images: see D2.
- Hover: not covered.
- The draft's "SPZ parse failed" shows the byte offset ("stopped parsing at byte 4,194,304"); the app shows the parser's own message for a cut-short file ("corrupt gzip stream does not have a matching checksum"). Different words for the same state, recorded because the copy differs from the draft.
