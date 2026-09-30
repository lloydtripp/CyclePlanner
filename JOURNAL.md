# Journal

## 2026-08-06

- Built initial version of the trainer workout planner as a static web app: `index.html`, `style.css`, `app.js` (no server/build needed, open `index.html` directly).
- Features: drag-and-drop workout builder (Warm Up, Steady, Ramp, Interval w/ sets/reps and editable Work/Rest sub-steps, Free Ride, Cool Down blocks); reorder via drag; inline duration/power editing; watts vs %FTP toggle; live power graph colored by zone; estimated duration/kJ/TSS.
- Added export to `.fit` (hand-built encoder against FIT SDK's documented workout/workout_step message layout) and `.zwo` (Zwift XML) formats.
- Verified `.fit` output by parsing it back: header/CRC, message definitions, field sizes, and repeat-step looping (step index + rep count) all correct. Not tested on real ELEMENT hardware — no device available.
- Open next steps: test exported `.fit` file on an actual Wahoo ELEMNT with a simple workout before trusting complex ones; user was offered `/init` to set up CLAUDE.md (not yet done as of this entry).


## 2026-09-30

- Fixed inputs losing focus while typing: field edits no longer rebuild the timeline (PRs #1, #2).
- User reports ELEMNT expects `.mrc` files in `USB storage\plans`. Added `.mrc` export (MINUTES PERCENT, two points per step; free ride written as 0%) and made it the primary export; updated footer instructions.
- Open next steps: confirm `.mrc` loads on the device; `.fit` path/folder instructions removed from footer since the device uses `plans`.
