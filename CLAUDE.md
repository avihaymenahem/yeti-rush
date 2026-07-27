# Working in this repo

Yeti Rush — a 3-lane snow endless runner. React 19 + TypeScript + Three.js
(react-three-fiber) + Capacitor, targeting Android.

[README.md](README.md) explains what the game is and why it is built this way.
This file is the working agreement: the rules that must not be broken, and the
mistakes already made so they are not made twice.

```bash
npm run check
```

typecheck + lint + tests. It must pass before anything is called done.

## Non-negotiable invariants

**1. The game loop never touches React state.** Simulation state is one mutable
object (`game/state/runtime.ts`), advanced by exactly one `useFrame` in
`render/GameLoop.tsx` at a fixed 60 Hz. `Object3D` transforms are mutated
through refs. React renders HUD and menus only, from a ~10 Hz snapshot. If a
change would re-render React per frame, it is the wrong change.

**2. The player never moves forward.** The player sits at `z = 0` and the world
scrolls past. Entity positions are absolute track distances; world Z is derived
via `worldZOf(trackZ, distance)`. Never give the player a forward position.

**3. Every gameplay constant lives in `game/config/tuning.ts`.** No gameplay
magic numbers anywhere else. Game feel is found by tweaking numbers on a device,
and constants scattered across a dozen files kill that loop.

**4. All randomness goes through `core/rng.ts`.** Never `Math.random()` in
gameplay. Runs must be reproducible from a seed — it is what makes the track
generator fuzz-testable and lets a reported bad run be replayed.

**5. Never break the solvability guarantee.** `systems/solvability.ts` proves a
stretch can be run through, and it is validated at the **worst case any board
can produce**, not the baseline. That is why no board may steer slower than
Classic: a correctness floor, not a balance preference.

## The two guarantees that keep the track playable

These are separate and both are load-bearing. Conflating them caused real bugs.

- **Mechanical solvability** — is a lane reachable, and are two forced actions
  far enough apart that the first can finish? DP over rows and lanes.
- **Reaction pacing** (`REACTION_SECONDS` in `systems/spawner.ts`) — can a human
  *see* the row, decide and move a thumb in time? Solvability alone models a
  player who already knows what is coming and inputs frame-perfectly. Measured
  against the old generator, half of all required actions arrived within 0.35 s
  of the previous one at top speed. That is a coin flip, not difficulty.

## Committed flight is protected track

A ramp launch and a rail exit both put the player somewhere they **cannot jump
or slide**, only steer. Anything in that span needing an action is unanswerable,
and a row sealing every lane is fatal however well it was read. The spawner
keeps those spans clear via `clearUntil`, and 300-seed tests enforce it.

The two are not the same shape, and assuming they were caused a shipped bug:

- A **ramp** arc is defined over *distance*, so it is speed-invariant.
- A **rail** exit is a *fall taking fixed time*, so it covers more ground the
  faster the run gets. Its protection must be computed from the real ballistic
  fall at the worst-case speed, never a constant.

## Ramps and rails are triggers, never obstacles

Taking one can only ever help, so the solvability guarantee never has to know
they exist — the track underneath is checked as if they were not there.

**Mounting a rail is decided by geometry alone, never by what the player
pressed.** This cost three rounds of "rails don't work" to learn:

1. Mounting required a slide, so jumping at a rail — the instinct — silently
   failed and dropped the player onto the obstacle the rail exists to clear.
2. The trigger was an AABB inside the 6 m collision window, so 16 of an 18 m
   rail was uncatchable by any input.
3. Running was rejected as "not intent", so riding straight into a solid steel
   bar passed through the middle of it.

Now: ride into the low near end and you step on; jump and the bar catches your
arc wherever it crosses; arrive past the near end and the bar is overhead, so
you pass underneath. Nothing asks what was pressed. **A route the obvious
inputs cannot take is a bug with a design rationale attached.**

## Testing discipline

Tests are pure logic — no jsdom, no WebGL, no mocked clocks. Write them for new
code, and run the suite before finishing.

- **Measure before fixing.** Every real bug here was found by instrumenting the
  actual generator or simulation over hundreds of seeds, not by reasoning about
  the code. Reasoning produced confident wrong answers more than once.
- **Every guarantee needs a counterweight.** "Nothing is unsolvable" is
  trivially satisfied by generating nothing; "rails carry you over the boulder"
  is trivially satisfied by a harmless boulder. Assert the sample size, and
  assert the danger is real with the mechanic removed.
- **Mutation-test a new threshold assertion.** Break the thing on purpose and
  confirm the test fails with the right diagnostic. A threshold that has never
  been seen to fail is not known to discriminate.
- **When a test fails after an intentional behaviour change, rewrite it to the
  new invariant — do not loosen it.** Three tests here had encoded a wrong
  assumption as a guarantee and were actively defending a bug, including one
  named "does not carry a player who never slid".
- Prefer asserting a *rate over real generated content* to asserting a staged
  case. Staged tests prove a thing can work; only rates prove it usually does.

## Style

- Comments explain **why**, especially why a number is that number or why an
  obvious simpler approach is wrong. Match the surrounding density.
- Match existing naming and idiom. British spelling in prose and comments.
- Derived state over `useEffect` in React (see the user's global preferences).
- Colliders are authoritative; art is fitted to the hitbox, never the reverse.

## Android

The native project **is committed** — it carries hand-edited config `cap sync`
does not regenerate (portrait lock, edge-to-edge theme). Only the copied web
bundle is gitignored.

```bash
npm run build && npx cap sync android
cd android && ./gradlew.bat installDebug
```

Wireless adb: enable **Developer options → Wireless debugging**, then take the
`_adb-tls-connect._tcp` entry from `adb mdns services` — the port rotates each
session. Watch out for other adb-advertising devices on the network; one here
sits at `10.0.0.18:5555` and is not the phone.

After installing, verify the packaged bundle hash matches the build:

```bash
grep -o 'index-[A-Za-z0-9_-]*\.js' dist/index.html android/app/src/main/assets/public/index.html
```

A stale APK has more than once looked exactly like a fix that did not work.

## Web demo

Published to <https://avihaymenahem.github.io/yeti-rush/> by
`.github/workflows/pages.yml` on every push to `main`.

**Never hardcode Vite's `base`.** Pages serves from `/yeti-rush/`; Capacitor
loads the identical bundle from the *root* of the Android WebView's asset
server. Hardcoding either one ships a working demo and a black screen on the
phone, or the reverse. `vite.config.ts` reads `PAGES_BASE`, set only by the
workflow. `vite preview` needs the same base or it serves at the root while the
HTML points at the subpath.
