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
