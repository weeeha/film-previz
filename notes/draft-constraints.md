# Draft constraints

Read time: about two minutes. This note fixes what the static HTML draft (`draft/`) must show, and what it must avoid, before any page is built.

## Who uses it

A filmmaker planning shots, at a desk, with a mouse and a keyboard. They open a generated 3D set, put a virtual camera in it, pick a lens, and leave with a shot list. They know lenses and shot sizes. They do not need the tool to explain what a focal length is.

Desktop only. Below 900 px wide the app shows one message and nothing else.

## The three views

| View | Job | The one decision |
|---|---|---|
| Scenes | Open a scene file, confirm its scale, keep past scenes | Is the scale right, so heights can be trusted |
| Stage | Look through the shot camera, set lens and height, save the shot | Is this the frame I want |
| Shots | Review saved shots, reorder, export | Is the list ready to export |

## What the first screen must show

On open, Scenes answers three things without scrolling:

1. Which scene file is loaded: name, size, splat count, time to first frame.
2. The scale state, with its source and the known object it came from, as a word (confirmed, not confirmed), never colour alone.
3. The next action: a single filled control. With scale confirmed it is "Open Stage". With no scene it is "Choose scene file".

The scale state also sits in the header of every view, so it is visible on Stage and Shots.

## Density

It is a tool. The viewport is the largest element on Stage. Panels are plain sections separated by spacing and hairlines, not cards. Numbers are readable at a glance: tabular figures, units next to every value, the lens readout in one sentence.

## Fixed data

Use these values as given in the spec, verbatim.

- Lens set: 14, 18, 24, 28, 35, 50, 85, 100, 135 mm, plus a free field.
- Sensors: Full frame 36 x 24 mm, Super 35 24.89 x 18.66 mm, Custom.
- Aspects: 16:9, 1.85:1, 2.39:1, 3:2, 4:3, 1:1.
- Height presets: low 0.3 m, hip 1.0 m, eye 1.6 m, high 2.5 m, labelled as editable assumptions.
- Field of view: hfov = 2 atan(w / 2f), vfov = 2 atan((w / a) / 2f). Example: 35 mm on a 36 mm sensor at 16:9 reads 54.43 degrees horizontal, 32.27 vertical.
- Scene in the draft: the phase 0 test set, `set-01-2m.spz`, 8.4 MB, 1,999,628 splats, first frame about 0.6 s, scale reference "door, 2.00 m", scale source "manual".

## Constraints from `unslop` (constraints mode)

Result of running the skill before designing. Tier in brackets: floor means never waived, reflex means waivable on the record.

**Avoid, with what to do instead**

| Avoid | Use instead for this tool |
|---|---|
| Generic hero or marketing header (CPY-1, LAY-7) | No hero. The page opens on the work: the scene file, the viewport, the table. |
| Decorative gradients, glows, glass, blurred orbs (EFF-1 to EFF-6, floor) | Flat tokens. Separation by spacing, then a hairline, then a surface tint. The viewport is flat greys. |
| Icon-in-tile card grids, exactly three equal cards, stat-card strips (CMP-3, LAY-4, LAY-5) | Panels as plain sections. Stage is a viewport with an inspector. Shots is a table. |
| A default dashboard shell with a stat row (LAY-14) | Each view is named by its job and its one decision (table above). The deciding object is the page. |
| Cards inside cards (LAY-1) | One level of container at most. |
| Eyebrows, tracked-caps labels, section numbers (TYP-5, TYP-6, LAY-8) | Plain sentence-case labels. Numbers appear only where order is information, in the 6-step flow. |
| Template punctuation: middle dots, arrows glued to links, status dots (CPY-8 to CPY-10) | Line breaks, columns, hairlines. Status is a word. |
| Colour-only state (STA-6) | Every state carries a word: "Confirmed", "Not confirmed", "Editing". |
| Colored left-border accent strips (CMP-2) | Notices use a full hairline border and a tinted surface. |
| Filler people, fake celebration, cheerleading copy (CPY-6, CPY-11) | Neutral shot content. Results are reported plainly: "6 shots exported". |
| Fabricated stats and metrics (CPY-7) | Numbers are either from the spec or computed with the formula. Fake data is plausible and says nothing about real films or clients. |
| Mono as a costume (TYP-13) | Mono only for file names, hashes and measurements. |
| More than one filled control per view (CMP-7) | One filled control per view: the way forward. Everything else is outlined or plain. |
| Layout moving on hover, focus or selection (LAY-15) | Hover and focus change colour or ring only. Borders reserve their width at rest. |

**Choose**

- A viewport-first layout on Stage: viewport and shot strip on the left, a readable numeric inspector on the right.
- Plain labels, verb plus object on buttons ("Save shot", "Choose scene file", "Apply scale").
- Type: system font stack, at most five sizes (12, 13, 14, 16, 20 px), nothing under 12 px, tabular figures.
- Colour: one accent, used for the filled control, focus and the selected state. Neutral greys otherwise. The viewport background is one fixed neutral grey in both themes.
- Both themes from custom properties: dark mode reads flipped roles, it is not a second set of components.
- Every control reachable by keyboard with a visible focus style.
- All states designed: default, empty, loading, error, long content, no scale.

**Audit before calling the draft done (Phase 2 of the skill)**

Run the render tier (overflow, focus style, contrast, text size, heading order) on each page at 1280 px, light and dark, and the rule list over `draft/`. Report as violation, tier, fix. A clean run counts only after the self-test passed.

## The flow, in six steps

1. Open scene: choose the scene file; it loads and reports size and first frame. (Scenes)
2. Set scale: use Marble's scale or mark a known distance, such as a door of 2.00 m, and apply it. (Scenes)
3. Place camera: set height, heading and pitch of the shot camera. (Stage)
4. Pick lens: choose focal length, sensor and aspect; read the field of view. (Stage)
5. Save shot: name it, set job and size, and save it with its frame grab. (Stage)
6. Export: download the folder with the shot list, frames and metadata. (Shots)

## Limits of the draft

Static HTML and one CSS file. No build step, no network, no images; the viewport is drawn with CSS and inline SVG. A few lines of script switch the `?state=` view, the frame mask and the lens readout. Controls are not wired to anything else. The draft is for review and approval before any application code.

## Audit findings (task 8)

Every item of the fix list, checked in Chromium and WebKit at 1440 x 900, light and dark, and at 900 and 880 px for the default states.

| Item | What | Result |
|---|---|---|
| 1 | Drawing follows the lens | Fixed. The room, door, chair, stand-ins and reference outline scale about the viewport centre by (f / 35) x (36 / sensor width), relative to the frame width. Door width at 85 mm is 2.4286 times its width at 35 mm in both engines; 14, 135, Super 35, 2.39:1, 1:1 and 3:2 agree with the readout. The room art is extended past its old edges so wide lenses show no blank area. |
| 2 | Shot details first | Fixed. Order is Shot details, Lens, Camera. |
| 3 | X and Z only | Fixed, with the hint about height. |
| 4 | Strip in noscale | Fixed. Model units and the word "unverified". |
| 5 | Missing states | Fixed. Scenes nowebgl and toolarge, collider line in loading, Shots exported and deleted (Undo, rows renumbered), all in the state switcher. |
| 6 | Scale chip | Fixed. "Scale confirmed, door 2.00 m". |
| 7 | Scene name in header | Fixed on all three views. In the Scenes loading state the saved name is shown, a first-time file would have none. |
| 8 | Thumbnail aspect | Fixed. 3:2, 2.39:1 and 1.85:1 rows letterbox inside a fixed cell. |
| 9 | Four columns | Fixed. SHA-256 moved to the file row; three facts remain. |
| 10 | Sentence beside h1 | Fixed, deleted. |
| 11 | Name column offset | Fixed. Text x matches the header at rest, hover and focus. Left: names sit 1 px (Chromium) to 1.8 px (WebKit) off the neighbouring cells because of line-box rounding. |
| 12 | Clamp, count, sticky header | Fixed. Two-line clamp with full text in the title, "40 shots" under the table, header stays while the table scrolls. A focused name unclamps so it can be edited, which grows that row. |
| 13 | Mask chips | Fixed. Plain text that follows the Aspect select. |
| 14 | Collapsible sections | Fixed. Stand-ins and Reference photo are details, closed when empty. |
| 15 | Filled control follows mode | Fixed. "Update shot 2" filled with "Save as new shot" outlined; "Save shot" filled in noshots. |
| 16 | Empty strip | Fixed. Dashed box, one line. |
| 17 | Hint at 900 to 1099 | Fixed. It wraps under the bar. |
| 18 | Scene name field | Fixed. Two-row textarea. |
| 19 to 22 | Copy and titles | Fixed. The floor plan note moved to the draft-only bar. |
| 23 | film-craft columns | Left as ruled. |
| 24 | Inspector scroll by keyboard | Fixed. tabindex, role and label; PageDown scrolls it in both engines. |
| 25 | Selected chip mark | Fixed. 2 px ring. |
| 26 | Reference line | Fixed. Dark casing with a white dash. |
| 27 | Row buttons | Fixed. 32 px. |
| 28 | Click on 85 | Page is correct. A real pointer click selects 85 and reads "85 mm on 36 mm: 23.91 degrees horizontal, 13.59 vertical". The earlier click on 14 came from clicking the hidden radio input through its accessibility ref, which sits over the first chip. |

Unslop audit: render tier clean in light and dark at 1280 px on 6 screens (one warning: 180 controls on the long Shots state, only 80 driven). The rule list reports one LAY-4 hit on the three-column facts row, which is data, not cards.

## Owner approval (task 8)

- 2026-11-21: the owner approved the HTML draft in the build session ("Approve, build on"), with no changes requested. Spec criterion 13 is met. Phases 2 and 3 may start.
