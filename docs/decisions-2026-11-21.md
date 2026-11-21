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

## Quest phase

(added as tasks land)
