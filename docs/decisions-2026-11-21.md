# Decisions taken on 2026-11-21 without waiting for the owner

The owner asked for the remaining tasks to be built with the recommended option taken at every gate. Each line is a decision and its reason. Any of them can be reversed; nothing here was pushed, deployed or paid for.

## Gates

1. **The phase 4 draft gate (P4-1) is skipped.** The stand-in editor, the action axis control and the floor plan are built straight from the field list and copy in `docs/phase-4-plan.md`. Reason: a draft exists to be looked at before code, and the owner said not to wait; the built screens are what he reviews.
2. **The seven decisions in `docs/phase-4-plan.md` stand as written** (stand-ins carry over between shots, facing arrow in the grab, section-cut floor plan, front up, no plan without a confirmed scale, action axis on the scene, one mark per stand-in place). Reason: each was the recommended option.
3. **The synthetic room stays the test set.** Task 2 (Marble cost gate) and the real-input step of task 14 are not run. Reason: paid generation is off limits.
4. **No Vercel preview** (the open step of task 20). Reason: deploying is off limits. The preview is the local dev server.
5. **Quest tasks 25 and 26 are built as code and tested with a stand-in for the headset.** Their hardware checks (door looks 2.0 m tall, frame rate, tape-measured eye height) are not run. Reason: they need the headset and the owner in it.

## Phase 4 (stand-ins and floor plan)

- **A figure cut by the frame edge shows its percent with "partly out of frame" on the info line.** Behind the camera and fully outside the frame show words instead of a number. Reason: the percent is still true for the whole figure and is what the filmmaker checks, but it must not read as a figure that is wholly in the shot.
- **Add stand-in finds the floor height with a downward ray from the shot camera's eye height** at the point 3 m ahead (first up-facing collider face, else y = 0), because `pickFloor` takes a screen point and there is none for a point on the ground. Reason: a figure placed on a platform or step stands on it.
- **Clicking a stand-in row, or a figure in the viewport, selects it and opens its editor in place; clicking the open row closes it.** Reason: one open row at a time is the plan's rule, and the selection and the open row are the same state.
- **The e2e spec uses a 300 splat file with almost transparent splats for the fast tests** and the 500k set only for the measurement against the chair. Reason: a coloured splat in front of a figure tints the pixel the frame grab test checks, and 500k splats at SwiftShader speed make eight tests too slow.

- **The action axis and the export read the scene record from the store, not the session copy.** Reason: the session copy is older than a scale confirmed after it was loaded, and saving it with the axis undid the scale (found by the export e2e). The Shots view also refreshes the session when it opens.
- **The floor plan is built with the scale that was confirmed, so a plan from a slightly short door mark is scaled by that factor.** Reason: the plan shows what the scene record says; it does not correct it.

## Phase 5 (camera moves)

- **The end pose is set by one amount per kind and computed from the start pose; there is no "capture the end view" step.** Reason: one number is unambiguous, keyboard friendly and testable.
- **A pan is limited to 179 degrees either way.** Reason: the preview turns the short way round, so a larger pan would play backwards.
- **"Show end" is a toggle ("Show end", then "Show start") and holds the end pose until pressed again.** While a preview plays or the end is held, the Lens and Camera sections and the nudge keys ignore input, and saving a shot or a frame says "Stop the move preview before saving." Reason: a grab taken from the end pose would be saved as the start frame.
- **A scale change ends a running preview.** Reason: the scale moves the shot camera and re-reads its pose, which would take a point mid-move as the start.
- **The end frame is stored in the same frames store as the first frame, under the shot id plus "-end".** The store keeps, duplicates and deletes it with the shot, and a shot saved again as static loses it. Reason: the smallest change that fits the existing frame handling, with no new object store and no database version bump.
- **A saved shot with a move that has an end pose is grabbed twice, the second time with the camera put on the end pose and then back.** Handheld has no end pose, so it has no end frame. Reason: the end pose is the only thing the second grab needs, and the shot camera is the only camera a grab reads.
- **The track side in the camera sentence uses the scene's front heading.** Reason: a record keeps the heading relative to the front and the position in world axes, so left and right depend on both.

Open question, not acted on: whether any video tool the owner uses accepts the end frame or the camera sentence is untested.

## Quest phase

- **Spark's own `SparkXr` helper is not used; the session is started on the page's renderer through three's `renderer.xr`.** Reason: the app needs its own thumbstick rules, its own button in the Stage bar and a clean handover back to the normal loop, and Spark already skips its pre-render update while `renderer.xr.isPresenting`.
- **The walk camera moves under a rig group for the length of a session and is restored when it ends.** Reason: three's XR manager rewrites the camera's own transform and projection every frame, so the walk pose and projection must be saved and put back.
- **A snap turn keeps the head where it is.** Reason: turning the rig about its own origin would swing the view sideways by the head's offset from the rig.
- **The move stick also strafes (left and right along the head's side).** Reason: the brief fixes only forward movement, and a stick has two axes; strafing is the usual default and costs nothing.
- **Shots placed in VR carry no reference photo and only a name ("From headset N").** Reason: the job, notes and reference belong to the shot being edited on the Stage, not to a pose placed from the headset.

- **Saving placed shots reports failures through a callback, and throws an AggregateError after trying every pose when no callback is given.** Reason: one failed save must not drop the rest, and the error must not be swallowed.
- **Dev builds expose `window.__xrSession` so a test can stand in for the headset.** Reason: Chromium and WebKit here have no immersive session, and the Stage's save path after a session is otherwise untestable.

## Postponed

- Quest Browser run: scene loads, door at 2.0 m looks 2.0 m tall, frame rates for the 500k and the 2M file, thumbstick feel, comfort. Needs the Quest 3 headset and the owner (checklist in `notes/xr-results.md`).
- Tape-measured eye height against a shot placed at the door (within 0.05 m). Needs the headset, a tape and the owner.
- Whether the frame grab on the Stage matches what the user saw in the headset. Needs the headset and the owner.

