# Skyline Protocol

A browser-based naturalistic 3D game-based behavioral assessment prototype for studying response inhibition, timing, reward choice, and speed-accuracy behavior. It is not a clinical diagnostic tool.

## Run

Open `index.html` in a browser. No build step or dependencies are required.

## Architecture

- `app.js` contains the Three.js game layer: terrain, trees, branches, birds, hunter, projectile physics, camera, and effects.
- `assessment.js` contains configurable levels, seeded trial randomization, response windows, conditions, and trial lifecycle state.
- `telemetry.js` stores raw timestamped events and completed trial records for later preprocessing and machine-learning analysis.
- `index.html` and `styles.css` provide the participant HUD without exposing behavioral interpretations.

## Assessment levels

1. Familiarization: slow birds and longer response windows.
2. Basic assessment: mixed bird types and go/inhibit conditions.
3. Increased challenge: faster birds and shorter response windows.
4. Decision challenge: risk and immediate/delayed reward conditions.
5. Advanced assessment: combined conditions.

Trial time limits are configured by level as `120s`, `60s`, `15s`, `30s`, and `30s`. Each trial also selects and displays one required bird species. Hitting a different species is recorded as a wrong-target commission error and lowers the score; failing to hit the required species before the deadline is recorded as an omission/timeout.

Each level and trial records its condition, seed-derived configuration, stimulus timing, bird speed/state/position, response type, reaction time, projectile launch data, hit/miss outcome, and inhibition-related outcome fields.

## Controls

- Move with `WASD` or arrow keys.
- Aim with the mouse.
- Fire with click or `Space`.
- Enter VR with the `ENTER VR` button when a WebXR-capable headset and browser are available. In VR, use either controller trigger to fire and the controller thumbstick to move.
- Use `PLAY IMMERSIVE MODE` on desktop when no headset is available. It uses the same focused field layout with mouse aiming, click/Space firing, and WASD movement.
- Export the raw session JSON after a level.

## Data note

The exported JSON preserves raw telemetry. It does not calculate or claim an unsupported clinical “impulsivity score.” Experimental thresholds, reward values, and level parameters should be validated during pilot testing.
