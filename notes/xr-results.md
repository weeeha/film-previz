# WebXR results (Quest 3, optional phase)

Nothing in this file was run on a headset. No headset was available when the code was written. Every claim below about behaviour in a headset is a check not run, listed unticked at the end.

## What is built

- `src/xr/xr.ts`: `xrSupport` (asks the browser once whether `immersive-vr` can start; "insecure-context" when the page is not a secure context), `startXr` (starts an `immersive-vr` session on the page's own renderer with the `local-floor` reference space, so the floor is y = 0), and `stepLocomotion` (pure thumbstick maths).
- Locomotion: left thumbstick moves along the head's horizontal look direction at 1.5 m/s, with a radial dead zone of 0.15. Right thumbstick snap-turns 30 degrees, fires once per push past 0.6 and re-arms below 0.3. A snap turn keeps the head where it is, so the turn does not swing the view sideways. No teleport.
- Movement is applied to a rig group (`Viewer.xrRig`) that holds the walk camera for the length of the session. The scene content is never moved. The headset starts where the walk view was, turned the way it looked, standing on the floor.
- `src/viewer/scene.ts`: while the renderer is presenting, the frame loop calls the session's tick and draws the walk camera (which the XR manager replaces with the headset cameras). Look-through and the walk keys do not apply. When the session ends the walk camera is taken out of the rig and gets its own pose, near, far and size back.
- `src/ui/xrButton.ts`: the Enter VR button in the Stage bar. It does not exist in the page until the browser reports `immersive-vr` support, so a desktop browser without a headset shows the Stage as before. With support and no confirmed scale it is disabled and the line reads "Confirm the scale before entering VR. The set is shown at real size."
- The 500k splat file is not chosen automatically. Open the file you want on Scenes. The 500k file is the suggested one for the headset until frame rates are measured.
- Placing shots from the headset: see the last section.

## What Spark's package says about WebXR

Read from `node_modules/@sparkjsdev/spark` (version 2.4.0).

- `dist/types/SparkXr.d.ts`: Spark ships its own `SparkXr` class (an Enter VR button, controller movement, hand tracking, `referenceSpaceType` option). This app does not use it, because it needs its own locomotion, its own button placement and a handover back to the normal render loop. It uses three's `renderer.xr` directly.
- `dist/spark.module.js`, in `SparkRenderer`: the pre-render sort update is skipped when `renderer.xr.isPresenting` is true (`const preUpdate = spark.preUpdate && !renderer.xr.isPresenting`), so Spark already adapts when the session is started through three's renderer. No special setup of the `SparkRenderer` was needed beyond what the viewer already does (it is created with the page's renderer and added to the scene).
- `dist/types/SparkRenderer.d.ts`: `preUpdate` is documented as "set to false in order to complete rendering as soon as possible" for WebXR, and `lodSplatCount` documents base counts of 500K to 750K for WebXR against 1M to 1.5M on mobile and 2.5M on desktop. That is the basis for suggesting the 500k file first. The numbers are Spark's own defaults for its LoD feature, which this app does not use, so they are a hint and not a measurement.
- `dist/types/controls.d.ts` and `hands.d.ts` also take a `WebXRManager`. Not used.
- The package README has no WebXR section.

## How to try it on a Quest 3

WebXR needs a secure context, so the page must be served over HTTPS or be reached as `localhost`.

1. USB cable and port forward (not run). Connect the Quest to the Mac with a cable, enable developer mode on the headset, start `npm run dev` (port 5185), and forward the port with `adb reverse tcp:5185 tcp:5185`. In the Quest Browser open `http://localhost:5185`. A forwarded localhost counts as a secure context.
2. HTTPS on the local network or a tunnel (not run). Serve the built app (`npm run build`, then any static server) behind an HTTPS address the headset can reach, with a certificate the Quest Browser accepts, and open that address in the Quest Browser. This app starts no tunnel and downloads nothing for it.

In both cases the scene file has to be opened inside the Quest Browser (Scenes, then the file picker), because scene files never leave the page. Confirm the scale on Scenes before opening the Stage, or the button stays disabled.

## Checks not run

- [ ] The scene loads in the Quest Browser.
- [ ] The door marked at 2.0 m looks 2.0 m tall in the headset.
- [ ] Frame rate with the 500k file.
- [ ] Frame rate with the 2M file.
- [ ] Thumbstick move (1.5 m/s) and snap turn (30 degrees) feel right.
- [ ] Comfort over a few minutes of walking.
- [ ] A shot placed standing at the door has a recorded height within 0.05 m of the user's real eye height, measured with a tape.
- [ ] The frame grab on the Stage matches what the user saw from that spot in the headset.
- [ ] Entering and leaving a session leaves the desktop view as it was (walk camera pose, look-through, frame grab).

## Placing a shot from the headset

- A trigger press (the session's `select` event) queues the head's pose: position in the world frame, heading and pitch from the head's forward vector by the convention in `src/camera/pose.ts`, roll set to 0, height above ground equal to the head's y (`local-floor`, so rig y plus head y).
- Shots are saved after the session ends, because a frame grab needs the normal render path, which is not available inside the XR frame loop. On session end each queued pose is put on the shot camera, grabbed and saved as a new shot named "From headset 1", "From headset 2" and so on, with the lens that was on the Stage when VR started, a static move, and the Stage's current stand-ins. They carry no reference photo, job, action or notes.
- Then the Stage's own pose is restored and the save line reads "N shots placed in VR were saved." A failed save does not stop the others; the line adds how many failed and the first reason.
- While a session is running the Save buttons say "End the VR session before saving."
- Tested without a headset: the pose maths and queue in `tests/xr/place.test.ts`, and the Stage's save path through a stand-in session handle in `tests/e2e/xr-place.spec.ts`. The stand-in handle replaces the browser's session, so it says nothing about what the Quest Browser sends on a trigger press.
