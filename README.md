# Yeti Rush

A 3-lane snow endless runner. A yeti snowboards down an alpine village: swipe
between lanes to dodge obstacles, collect coins, ramp over chalets, grind rails
over what is in the way, and grab timed power-ups. Structurally Subway Surfers,
thematically an alpine winter.

React 19 + TypeScript + Three.js (react-three-fiber) + Capacitor.

Contributing or picking this up with an agent? [CLAUDE.md](CLAUDE.md) is the
working agreement — the invariants that must not be broken and the mistakes
already paid for.

## Commands

```bash
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on :5173 |
| `npm run dev:host` | Same, exposed on the LAN for phone testing |
| `npm run check` | typecheck + lint + tests (run before calling anything done) |
| `npm test` | Vitest suite |
| `npm run build` | Production web bundle into `dist/` |
| `npm run cap:sync` | Build and copy the bundle into the native projects |
| `npm run cap:android` | Build, sync and launch on a connected Android device |

## The game

- **Three lanes.** Swipe left/right to change, up to jump, down to slide. Arrow
  keys and WASD work on desktop. Gestures fire on `pointermove` the instant the
  threshold is crossed, not on release, and each axis latches independently - so
  a swipe registers as soon as it is recognisable, and ducking then steering in
  one continuous motion produces both actions rather than one net direction.
- **Obstacles** each have exactly one answer: jump a drift or log, slide under a
  banner or bough, steer around a boulder, woodpile or chalet. This is enforced
  by test, not by convention (`tests/obstacles.test.ts`).
- **Stumbling.** Clipping a *low* obstacle trips you rather than ending the run:
  you lose speed and your combo, and the ski patrol closes in. Trip again before
  you have shaken them off and you are caught. Anything solid still kills outright.
- **Ramps** launch you over a chalet along an arc that is the same shape in world
  space at every speed, with a coin line tracing the flight.
- **Grind rails** are the other optional route, and deliberately a different
  shape of decision. A ramp is a commitment — hit it and you fly a fixed arc you
  cannot abort. A rail is *held*: it carries you up for as long as you stay in
  its lane, steering off drops you, and it throws you off the far end with a pop.
  Getting on one takes no input and no timing — ride into the low near end and
  you step on, or jump and the bar catches your arc wherever it crosses. Coins
  climb with the bar, so the reward sits exactly where the route puts you.
- **Five power-ups**: Hot Cocoa (magnet), Avalanche Board (invincible, faster,
  smashes obstacles), Chairlift (fly above the track), Snow Angel (double jump),
  Double Score.
- **Boards handle differently.** Each is a colour scheme *and* a profile across
  speed, control, grip and fortune - all trade-offs, never an upgrade ladder, so
  none is strictly better than the free one. A test enforces that: any board
  that beat Classic on every axis would make the shop a paywall on the only
  sensible choice rather than a decision.
- **Meta**: coin wallet, records, a local top-ten leaderboard, five boards,
  three upgrade levels per power-up, three rotating daily missions and a daily
  login streak.

### Modes

Four rule sets layered on one simulation - there is no separate loop per mode.
A mode can move where the difficulty curve starts, cap the run with a timer,
make a trip immediately fatal, and fix the seed.

| Mode | Rules |
| --- | --- |
| Endless | Ride until you crash. The baseline. |
| Time Attack | 90 seconds, starting at pace. |
| Blizzard | Top speed from the gate, and one slip ends it. |
| Daily Challenge | Seeded from the date, so it is the same slope for everyone that day. |

Harder modes carry a score multiplier, and **scores are ranked per mode** - a
Time Attack score and an Endless score are not comparable, and one pooled table
would make the timed modes look worthless. The leaderboard trims per mode too,
so a strong run in one can never evict another mode's history.

### Screens

Home is a full screen rather than a card over the game - it is where a session
starts and where the player returns between runs. From it: Play, Boards, Daily,
Scores and Settings. The 3D scene keeps running behind every screen, dimmed by a
scrim, because the Canvas is never unmounted.

The leaderboard is **local**. There is no backend, so it is the player's own best
runs on that device, and the screen says so - a "leaderboard" someone assumes is
global and later discovers is not feels like a broken promise.

The save is **never written before it has been read**. The store is constructed
holding a default save and reading storage is asynchronous, so a mutation
landing in that gap would persist defaults straight over real progress. Writes
are refused until the load completes, which makes destroying a save on startup
impossible rather than merely unlikely.

Settings carry independent **music and effects volume sliders**, 0-100, mapped
to gain by squaring so the travel feels even to the ear rather than bunching
everything audible into the top fifth. A legacy on/off toggle migrates to 0/100.

Icons are [lucide-react](https://lucide.dev), keyed to what each power-up
actually does — a magnet for Hot Cocoa, a cable car for Chairlift, chevrons for
the Snow Angel's double jump.

Board previews in the shop are **SVG, not 3D**. A live preview per row would
need a WebGL context per row; mobile browsers cap those at a handful and evict
the oldest, which would take the game's own canvas down with it. The SVG
re-colours from the same five skin values the 3D model uses, so a board reads
the same in the shop as in play.

## Architecture

Two rules drive everything:

**1. The game loop never touches React state.** Re-rendering React at 60 fps
will not hold frame rate on a mid-range Android device. So:

- Simulation state is a mutable plain object: `src/game/state/runtime.ts`.
- It is advanced by exactly one `useFrame`, in `src/game/render/GameLoop.tsx`,
  through a fixed 60 Hz timestep.
- Object3D transforms are mutated directly via refs, never through `useState`.
- React renders only HUD and menus, fed by a ~10 Hz snapshot published into
  `src/game/state/gameStore.ts`.
- Sound and haptics fire from `GameLoop` by diffing the runtime between frames,
  so the simulation stays pure and runs headless in tests.

**2. The player never moves forward.** The player sits at `z = 0` and the world
scrolls past (a treadmill). This avoids float precision drift on long runs and
makes culling, pooling and chunk recycling trivial. Entity positions are stored
as absolute track distances; world Z is derived (`worldZOf`).

### Layout

```
src/
  app/            App shell, input surface, HUD, Menu, GameOver, Shop, Missions
  game/
    core/         loop, rng, math - no game knowledge
    config/       tuning.ts - every gameplay constant
    content/      obstacles, chunks, power-ups, skins, missions (pure data)
    systems/      pure simulation logic (testable without a DOM)
    render/       R3F components; the only place three.js is touched
    state/        runtime (mutable, 60 Hz), stores (React-facing), save schema
  platform/       Capacitor wrappers - storage, haptics, lifecycle, audio, shell
  dev/            debug bridge, development builds only
tests/            mirrors src/game/**
```

### Where the constants live

`src/game/config/tuning.ts` holds every gameplay number - speeds, jump arc, ramp
arc, lane width, camera framing, collision forgiveness, stumble recovery.
Nothing outside that file should hard-code a gameplay magic number. Game feel is
found by tweaking these on a device, and hunting constants across a dozen files
kills that loop.

### No physics engine

Collision is AABB overlap over a narrow z-window (`systems/collision.ts`).
A runner needs collision that is deterministic, forgiving and tunable; a solver
gives none of those cheaply. Hitboxes are deliberately ~15% smaller than the
visuals so near-misses feel generous.

Vertical motion integrates with the exact closed form for constant acceleration
(`y += vy*dt - 0.5*g*dt²`) rather than plain Euler. Euler accumulates a
systematic `0.5*g*dt*t` error, which at ramp gravity is over 20 cm by mid-flight
- enough to clip a chalet the arc was authored to clear.

### Track generation and the solvability guarantee

The track is assembled from hand-authored 20 m chunks
(`src/game/content/chunks.ts`), weighted by difficulty tier. Every chunk is laid
into fixed-size pools; nothing is allocated during a run.

`systems/solvability.ts` proves a stretch of track can actually be run through,
checking both steering (lanes reachable in the distance available) and action
spacing (jumps and slides cannot be stacked back to back). It is deliberately
conservative: it may reject a stretch an expert could scrape through, but it can
never pass one that is impossible.

`tests/solvability.test.ts` drives the **real** spawner over 500 seeds and
4,000 m each and asserts every metre is solvable. An unsolvable stretch is the
one bug in an endless runner that is invisible in review and unarguable in play.

It validates at the **worst case any board can produce**, not the baseline -
derived from the skins table, so adding a faster board fails the tests rather
than silently making stretches impassable. That is also why no board may steer
slower than the baseline: it is a correctness floor, not a balance preference.

**Committed flight is protected track.** A launch commits the player to a 22
metre flight they cannot abort, and the chalet at the apex hides whatever is
behind it until they are over the roof. Left to chance the generator will put an
obstacle in the descent or at the touchdown point - a failure the player cannot
see coming or learn from. The spawner lays an obstacle-free runway chunk after
any chunk containing a ramp, and a 300-seed test asserts nothing sits in a
descent or landing zone.

A **rail exit** needs exactly the same protection and did not get it at first:
the reward route ended in an obstacle the player was already airborne for. The
two are not the same shape, which is the whole reason a shared constant would
not do. A ramp arc is defined over *distance* and is speed-invariant; a rail
exit is a *fall taking fixed time*, so it covers more ground the faster the run
gets - nearly 20 metres at top speed. Its protection is computed from the real
ballistic fall at the worst case, and a test asserts the zone grows with speed,
because otherwise the guarantee would hold at whatever speed it was tuned at and
silently fail above it.

**Rows are paced to a human, not to the character.** Solvability answers "is a
lane reachable and can the first action finish before the second" - it models a
player who already knows what is coming and inputs it frame-perfectly. It has no
model of a person. Measured against the generator that shipped, half of all
required actions arrived within 0.35 s of the previous one at top speed, median
0.33 s. That is not difficulty, it is a coin flip. `REACTION_SECONDS` now keeps
decision rows a reactable distance apart *across chunk boundaries* as well as
within a chunk, which took the median to 0.88 s with nothing under 0.35 s.

**Obstacles are spread across the lanes.** The player occupies one lane at a
time, so a library that leans on the centre does not read as slightly uneven -
it reads as *everything* being in the middle, because the middle ones are the
only ones that have to be answered. Measured over 200 seeds, the centre lane
once held 51.6% of every obstacle laid and tier 0 held 100%: its three teaching
chunks were all centre-lane at the highest weight in the library, and because
the tier pool is cumulative that bias leaked into every later tier. Now 36.2%
overall, with no tier outside 35-38%.

Left/right balance is **structural rather than authored**: the spawner mirrors
each chunk on a coin toss. A reflection is the only symmetry a three-lane track
has - it preserves lane adjacency, so solvability, forced rows and row spacing
are provably unchanged, and a test re-runs the solvability DP on every mirrored
chunk rather than trusting the argument. An arbitrary lane permutation would
not do: swapping lanes 0 and 1 turns a one-step dodge into a two-step one.

### Determinism

All randomness goes through the seeded RNG in `core/rng.ts` - never
`Math.random()`. A run is reproducible from its seed, which is what makes the
track generator fuzz-testable and lets a reported bad run be replayed exactly.

### Audio

Sound effects **and the music** are synthesised at runtime with Web Audio
(`platform/audio.ts`, `platform/music.ts`) rather than loaded from files. No
audio assets in the bundle, no decode latency on the first coin, and a few
kilobytes of code instead of megabytes. The context is unlocked on the first
user gesture, as mobile browsers require.

The score is the interesting one. A licensed loop would cost around 3 MB against
a 6 MB app and would play identically whatever is happening on screen. This one
**reacts**: the arpeggio moves from eighths to sixteenths and climbs an octave as
the run speeds up, and a low tritone creeps in against the root when the ski
patrol closes in - so the player hears the danger before they turn to look. On
the menus it idles to a pad and a little bass.

Notes are queued with the standard Web Audio lookahead pattern: a 40 ms timer
schedules the next 160 ms of music at sample-accurate times. Firing notes
straight from a timer would put every one of them a few milliseconds late and
the result would audibly stagger. The scheduler stops when the app backgrounds,
so it is not queueing notes in someone's pocket.

If you would rather have a produced track, the CC0 sources are
[OpenGameArt](https://opengameart.org/content/cc0-music-0),
[Pixabay](https://pixabay.com/music/search/game%20loop/) and
[Freesound](https://freesound.org/browse/tags/cc0/) - drop it on the same music
bus and mute the generator.

## Development tools

In dev builds only, `window.yeti` exposes the live simulation: `snapshot()`,
`nearby()`, `stage()` to place an exact layout ahead of the player, `startRun(seed)`,
and the meta store. This is how gameplay bugs get diagnosed against the running
game rather than a reconstruction of it. It is loaded through a dynamic import
behind `import.meta.env.DEV` and never reaches production.

Press `P` (or load `?perf`) for the frame-rate and draw-call overlay. `r3f-perf`
is likewise dynamically imported behind a DEV guard - a static import would ship
220 kB to every player for a tool none of them can open.

## Performance

Budget: 60 fps and under ~60 draw calls on a mid-range Android device.

Measured on desktop at 375x812: **35 draw calls, ~23,000 triangles** (before
rails, which add one instanced mesh). Everything repeated is instanced - one
draw call for all coins, one per obstacle kind, one per tree variant, one for
the ramps, one for the rails, one for the snow (900 flakes animated entirely in
the vertex shader), one for the snow spray - and the yeti is ten.

Merging is what keeps that number flat while the content grows: importing real
models moved it by one, and rebuilding the yeti from a handful of capsules into
a shaggy, goggled, scarf-trailing rider took it *down* by two.

Known slack if it is ever needed: each mountain range draws two copies of its
geometry side by side to hide the parallax seam, which could be merged into one
geometry per layer and save three calls.

No real-time shadows (the player gets a blob shadow), no environment maps, no
post-processing, `dpr` capped at 2, fog hiding the spawn distance. The render
loop stops entirely when the app is backgrounded, and the fixed timestep is reset
on resume so the simulation never lurches forward.

**On device** (Samsung SM-S938B, Android 16): **121 fps, 0 missed vsync, 0.47%
jank** over a sustained run. Frame time sits around 8 ms at p50, up from 6 ms
before the specular materials and the longer draw distance - comfortably inside
budget, but with less headroom than there was. `track.drawDistance` is the first
lever if a weaker device ever struggles.

## Android

The native project **is committed** - it carries hand-edited config that
`cap sync` does not regenerate (portrait lock, edge-to-edge theme, permissions).
Only the copied web bundle is gitignored.

Requires the Android SDK and a JDK. Verified building against JDK 21; both
`assembleDebug` (6.2 MB) and `assembleRelease` (4.3 MB unsigned) succeed.

```bash
npm run cap:android
```

Shipping to the Play Store additionally needs a keystore and a signing config in
`android/app/build.gradle` - create those yourself; they are credentials.

iOS is not set up; it needs macOS. The project is structured so `npx cap add ios`
is the only step required.

## Art direction

One palette and one set of atmosphere numbers in `src/game/config/visuals.ts`,
so the sky, fog, lighting, snow and grade all agree. The look is late-afternoon
alpine: a low warm sun, deep blue overhead fading to gold at the horizon, warm
highlights on the snow and distinctly cool violet-blue shadows.

Two ideas do most of the work:

**Hue, not brightness.** Flat-shaded low-poly geometry has no surface detail to
catch light, so a face turning away from the sun has to change *colour* rather
than just get darker. A warm key against a cool rim and a low blue ambient is
what gives the geometry form; a bright even ambient fills every shadow and
flattens it straight back out.

**The piste is a mid-tone, not white.** Everything the player must read at speed
- the yeti, the snow spray, drifts, the ice wall - is near-white, and on a
near-white run none of it has a silhouette. Dropping the groomed run several
steps down the value scale is a readability fix as much as an aesthetic one.

Surfaces are `MeshPhongMaterial` with a specular tuned per material class in
`visuals.ts` - polished steel on the rails, a warm sheen on props, a soft
blue-white on snow. Fur gets its own *dark* specular rather than none: specular
colour is what sets highlight strength, and giving the yeti the prop sheen made
him read as painted plastic.

The rest is depth: a gradient sky dome with a sun and glow (one draw call), three
parallax mountain ranges built procedurally from the seeded RNG, exponential fog
balanced against the draw distance so nothing pops into clear air, snow spray off
the board, a field-of-view kick with speed, and a camera rumble that builds as
the ski patrol closes in.

The grade and vignette are a **DOM overlay, not a post-processing pass**. A
render-target chain costs an extra full-resolution draw plus the target itself,
which on a mid-range mobile GPU is a real slice of the frame budget - and the
compositor gives an identical vignette and warm lift for free.

## Models

CC0 models from Kenney's [Holiday Kit](https://kenney.nl/assets/holiday-kit) and
[Nature Kit](https://kenney.nl/assets/nature-kit), plus procedural primitives
where no model reads better. Every file is recorded in [LICENSES.md](LICENSES.md)
with its source and licence.

Models are loaded and normalised by `src/game/render/useModel.ts`, which:

- **Merges multi-primitive models into one geometry**, baking each primitive's
  material colour into a vertex-colour attribute. Nature Kit models carry two or
  three plain-colour materials; without this, every obstacle kind would cost a
  draw call per material instead of one instanced call in total.
- **Assigns the shared texture atlas explicitly.** The Holiday Kit GLBs
  reference `Textures/colormap.png` by relative path, which resolves differently
  under the dev server than in a hashed production build - the loader fails to
  find it in at least one, and silently renders flat white. The atlas is
  imported through the bundler and applied here, with nearest filtering, because
  a palette atlas sampled linearly bleeds neighbouring swatches into every model.
- **Bakes the fit transform into the geometry**, so instancing only ever writes a
  position matrix.
- **Re-tints imported colours** where a pack's palette clashes. The Nature Kit is
  a green-and-earth set; its rock is sandy brown and reads as desert against an
  alpine sky, so it is blended towards slate.

**Colliders are authoritative.** Art is scaled to the hitbox defined in
`content/obstacles.ts`, never the reverse, and `tests/models.test.ts` reads the
real GLB files to prove the fitted size still matches - so changing a collider
without the art (or swapping in a model with different proportions) fails the
suite rather than shipping a hitbox that disagrees with what the player sees.

### The yeti

Built and animated entirely in code, in `yetiGeometry.ts` and `Player.tsx`.
Every joint angle is a function of simulation state - lane offset, vertical
velocity, motion, speed - so the pose is always exactly consistent with the
physics rather than a clip playing alongside it. A static imported mesh would be
a downgrade, and `Player.tsx` is written as the rig a *rigged* character GLTF
would slot into if one ever arrives.

Two things drive the design:

**The camera is behind the player.** We see the yeti's back for practically the
whole run, so the detail budget goes where it is visible from there: a shaggy
shoulder silhouette, ears, a goggle strap banding the back of the skull, a
trailing scarf, mitts and boots. There is a face, because a ramp flight spins
the character far enough round to show it, but it is not what sells it.

**three.js issues one draw call per mesh.** It does not batch siblings even when
they share a material, so a character assembled from thirty little meshes would
cost thirty calls. Instead each independently animated part - torso, head, each
arm, each leg, board, scarf link - is merged into a *single* geometry with its
colours baked into vertex attributes, and the whole character shares one
material. Ten draw calls for a far denser model than the capsule-and-spheres
version it replaced, which cost eleven.

Poses are snowboarding poses, not running ones: a wide braced stance, shoulders
counter-rotating against the carve, the board rolled onto its edge, knees
tucking in the air with one hand reaching for the board, and a distinct flail
when the rider trips. The scarf is a three-link chain where each link lags the
one before it - the lag is the whole trick, since driving every link from the
same target gives a rigid plank.

Overhead barriers are also still primitives: nothing in either kit reads as
"duck under this" at a glance, and a clear silhouette matters more for an
obstacle the player has a fifth of a second to parse than fidelity does.

## Testing

670 tests, all pure logic - no jsdom, no WebGL, no mocked clocks. The suite
covers the fixed timestep, seeded RNG, lane easing, collision, the jump, ramp
and rail arcs, obstacle solvability across the real generator at the worst-case
board, ramp and rail landing safety, reaction pacing, lane distribution, mode
rules and seeding, the save schema's tolerance for corrupt data, daily-reward
date arithmetic including clock rollback, the shop economy's guards against
invalid states, board-stat balance, and the fit between every obstacle -
imported or procedural - and its collider.

That last one is asymmetric on purpose: a visual *larger* than its hitbox is
forgiving, but a visual *smaller* than its hitbox kills the player in what looks
like clear air. The test caught exactly that on the first pine bough.

Three habits do most of the work, and each came from a bug that got through:

**Measure, do not reason.** Every real defect here was found by instrumenting
the actual generator or simulation over hundreds of seeds. Reasoning about the
code produced confident wrong answers repeatedly - including a "rails mount 95%
of the time" figure whose entire shortfall turned out to be the Chairlift
power-up correctly refusing to mount.

**Every guarantee needs a counterweight.** "Nothing is unsolvable" is trivially
satisfied by generating nothing, and "the rail carries you over the boulder" is
trivially satisfied by a harmless boulder. So the suite also asserts the sample
size, that the track stays lethal to a player who never touches the screen, and
that removing the rail from the same seeds kills the run.

**A failing test after an intentional change gets rewritten to the new
invariant, never loosened.** When mounting became input-free, three tests broke
- one of them named `does not carry a player who never slid`. They had encoded a
wrong design assumption as a guarantee and were actively defending the bug.

```bash
npm run check
```

must pass before anything is called done.
