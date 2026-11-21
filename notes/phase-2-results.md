# Phase 2 results

## Real-input test (spec section 8): not run

Status: not run. There is no result, and the four numbers below are empty on purpose.

Why it was not run: the test needs a real photo from the owner and a Marble world generated from that photo. The owner has not supplied a photo, and generating the world is a paid step that has not been approved. A made-up photo would not test anything, so none was used.

What the owner needs to supply to run it:

1. One real reference photo of a room or street scene with a visible door or other object of known size.
2. The photo's focal length (EXIF 35 mm equivalent) and roughly how high the camera was held.
3. A Marble world generated from that photo (image input), exported as SPZ plus the collider mesh GLB. This is a paid step and needs the owner's go.

Then the steps are: load the world, mark the door height and confirm scale, place the camera at eye height (1.6 m, or the real height if known) on a full frame sensor at 35 mm (a second shot at the photo's own focal length if that is not 35 mm), aim to match the photo, save the shot, open the compare view, and read the guides.

| Measure | Photo | Frame |
|---|---|---|
| Horizon, percent of frame height from the top | not run | not run |
| Door height, percent of frame height | not run | not run |

Pass rule: horizon positions within 5 points of each other and door heights within 15 points. Verdict: not run.

How to read the numbers in the app: Stage, Reference photo section. Add the photo, turn on Look through shot camera, drag the horizon line and the ruler on each image (or type the percents), and read the two "Read as" lines. Each shows horizon percent and ruler height percent. The side-by-side screenshot stays in a local folder and is not committed unless the photo is the owner's to publish.

## Box test (task 11), already measured

The synthetic box test checks the lens math against a box of known size rendered through the app's frame grab. Chromium and WebKit agree.

| Lens | Box height, percent of frame height | Expected |
|---|---|---|
| 50 mm | 13.96 | 13.9 |
| 35 mm | 9.79 | 9.7 |

If the real-input numbers miss, this result is the reference: a passing box test points at how faithfully Marble reconstructs a single photo's perspective, and the camera math is cleared.

## Reference compare (task 14), built and tested on a generated image

The compare view is built and covered by `tests/e2e/reference.spec.ts` (Chromium and WebKit) with a flat test image drawn in the test. That checks the behavior, not the camera accuracy.

- Side by side shows the photo left and the live frame right at the shot's aspect, the photo cropped to fit.
- Overlay shows the photo at 50 percent on the frame. The X key swaps the photo to full opacity and back.
- The horizon line and the ruler (percent of frame height from the top) are on both images and can be dragged or typed.
- A frame grab taken with the overlay and guides on contains none of them.
- The photo is held as an object URL only. No request carries it.
