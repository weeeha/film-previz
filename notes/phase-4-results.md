# Phase 4 results

## How a figure sits among splats (P4-3, step 6)

Measured with `figure_behind_the_chair_among_the_splats` in `tests/e2e/stand-ins.spec.ts`, Chromium on SwiftShader, 500k set, scale confirmed on the door.

Set-up: shot camera at x -1.5, z 1.0, heading 0, low preset height, 35 mm. One stand-in (1.75 m) stands at x -1.5, z -2.6, which is 0.6 m behind the chair seat at z -2.0, in line with the camera.

Result: along the centre column of the figure, from 5 percent below the head to 5 percent above the feet, 136 of 224 pixels show the figure's grey (217, 220, 225) and the first covered pixel is the 137th. The other 88 pixels, the lower 39 percent, show the chair's splats.

So the splats in front of a figure hide it. Spark draws splats with a depth test against the opaque capsule, and a capsule behind a splat surface is covered by it. Nothing needed fixing. Known limit: this is one synthetic chair of about 500k splats at one distance. A real export with sparse or holey splats in front of a figure will show the figure through the gaps, and that is not measured here.

## Frame grab and interface

The selection ring and the name label are on the helper layer. With the ring moved to the default layer, `grab_is_the_same_with_and_without_selection` fails with a mean absolute difference of 0.263 against a limit of 0.005 (planted and reverted). With the label moved to the default layer, `figure_is_in_the_frame_grab` fails: the pixel where the label would sit differs between the grab with the figure and the grab without it (planted and reverted).
