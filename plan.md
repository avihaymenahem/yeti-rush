# Closing the genre gap

Working plan for the three things Yeti Rush is missing against Subway Surfers,
Temple Run 2 and Alto's. Live document: tick things off, rewrite what turns out
to be wrong once it is on a device.

The generator is already ahead of most shipped runners — the solvability proof,
the reaction-pacing floor and the protected-flight rules have no equivalent in
the games above. The gap is not the track. It is **everything wrapped around a
run**: what a moment feels like, what happens when you die, and whether the
world ever changes.

Ordered by impact per unit of work, and each phase ships on its own.

---

## Phase 1 — Feedback

**The gap:** things happen in this game without being *acknowledged*. You clear
an obstacle by four centimetres and nothing says so. You die and the screen
simply stops. This is most of the perceived-quality distance between us and the
commercial ski game, far more than lighting was.

**The principle:** every event the player caused gets a visible, audible and
tactile acknowledgement inside one frame, and its strength scales with how much
the event mattered.

**The constraint that shapes all of it:** none of this may re-render React per
frame, and none of it may touch the simulation's determinism. So feedback is a
small mutable impulse state (`game/systems/feedback.ts`) written by events,
decayed by the one `useFrame`, and read imperatively by the DOM overlay. The simulation *records* that something happened; the render layer
decides what it looks like. That split already exists for audio in
`GameLoop.tsx` and this follows it exactly.

| | What | Where | |
| --- | --- | --- | --- |
| 1a | Impact on death: a screen flash | `feedback.ts`, `screenFlash.ts`, `index.css` | done |
| 1b | Near-miss: detect, score, whoosh | `simulation.ts`, `tuning.ts`, `GameLoop.tsx` | done |
| 1c | Landing thump: sound and haptic on touchdown | `GameLoop.tsx`, `audio.ts` | done |
| 1d | HUD counters pop when they change | `Hud.tsx`, `index.css` | done |
| 1e | Results card counts up | `CountUp.tsx`, `GameOver.tsx` | done |

**And no camera shake.** It was built for crashes, landings and near misses,
and pulled out entirely on sight - along with the patrol rumble that predated
all of it. Recorded in `FEEDBACK` and guarded by a test, because shake is the
reflex answer to "this needs more impact" and would otherwise be reinvented: on
a phone held in two hands, a camera that moves when the player did not move it
reads as the game malfunctioning rather than as force. The flash does the same
job without moving what they are aiming at. The FOV kick with speed survives,
and the difference is instructive - it changes the *framing* rather than moving
the frame.

No hit-stop in 1a either. The world has already stopped by the time the
crash is drawn - `running` goes false in the same tick - so there is nothing
left to freeze, and the shake is the only motion on screen, which is what makes
a dead stop read as an impact rather than a hang.

`tests/support/autopilot.ts` came out of 1b and is worth knowing about: a
headless greedy player, so questions that depend on where the player *was* can
be measured rather than argued. It found the near-miss rate, and then found the
patrol bug below.

**1b is the only one that is a gameplay change**, not presentation: a near miss
has to be computed in the simulation to stay deterministic and seeded, and it
pays score, so it belongs in `tuning.ts` with everything else.

**Testing.** Presentation is judged by looking. What gets tested is the impulse
maths (decays to zero, clamps, never accumulates unbounded across events) and
the near-miss *rate over real generated runs* — it must fire often enough to be
a reward and rarely enough to be an achievement, asserted as a band, with the
counterweight that a player who steers into everything scores none.

---

## Found along the way — the ski patrol never caught anyone

Reported after a thousand runs, and confirmed by the pilot on the first
measurement: forty runs, forty deaths, not one of them `caught`. Not rare -
impossible. Three separate things had to change and only the first was a bug in
the ordinary sense. Written up in `tests/caught.test.ts` and in the comments on
`CAUGHT_PRESSURE` and `CHASER.recoverRate`; the short version:

1. **The fatal threshold was unreachable.** A trip put the patrol just over the
   line, but contacts are ignored for the whole 0.7 s recovery and the patrol
   dropped back throughout it. By the time a second trip was *possible* it was
   always further away than when the first one landed.
2. **Ground made back during a stumble is spent before the player can use it.**
   Recovery now pauses while they are down.
3. **Even fixed, it never actually happened.** The patrol shook a trip off in
   two seconds, so two trips never overlapped. Recovery is now slow enough that
   a second mistake inside about six seconds is fatal - measured, not guessed:
   a pilot fluffing every second jump is caught in 5 runs of 30, every third
   jump in 2 of 30, every fifth jump in none.

The lesson worth keeping: `tests/chaser.test.ts` was green throughout and every
assertion in it was correct. It tested that the patrol closes in and drops back,
which it did. Nothing tested that the mechanic those parts exist for could ever
fire. **A system with no test for its own reachability is a system that can be
entirely dead while its unit tests pass.**

---

## Phase 2 — Second chance

**The gap:** dying on a new best is exactly when a player quits, and we hand
them a results card. Every top runner in the genre sells a continue.

**Shape:** on death, offer one revive before the results screen, on a short
countdown. Costs coins, and the price doubles each time within a run so it is a
real decision rather than a formality.

**What it needs:**

- `reviveRun()` in `runController.ts`: alive again, score/coins/distance kept,
  combo reset, patrol pushed back.
- **The track has to be safe on resume.** The player restarts inside whatever
  killed them. This is the committed-flight problem in a fourth costume, and it
  gets the same answer: extend `clearUntil` past the death point by a full
  reaction gap at the current speed, and grant brief invulnerability on top.
- A `Revive` screen between `running` and `gameover`, which means a new phase in
  the store rather than overloading `gameover`.
- Price escalation and the per-run counter live in the runtime, not the save —
  a revive is a property of a run.

**Testing.** Revive preserves the run's numbers and resets the combo; the track
ahead of a revive is genuinely clear across seeds (same assertion shape as the
tunnel-exit test); invulnerability expires; the Nth revive costs what it should;
a player who cannot afford one is not offered one. Counterweight: assert the
death was real — with the revive removed the same seed ends the run.

---

## Phase 3 — Set-pieces and a second world

**3a is done; 3b is not, and not for want of trying.** See below.

**The gap:** one alpine village, end to end, for ever. Subway Surfers' longevity
is mostly World Tour reskinning the whole game monthly, and Temple Run 2's is
zones that change how you move. We have neither. Rails and tunnels are the right
instinct but they are obstacles, not events.

**Two separable pieces.**

**3a — A traversal set-piece.** Fifteen seconds where the rules change: an
avalanche pushing from behind that forces forward commitment, or a chairlift
section run above the piste. The Chairlift power-up is already most of the
machinery; the work is making it a *track event* the generator can schedule
rather than a pickup, which means the spawner needs a notion of a scripted
stretch that suspends normal chunk laying.

**3b — A second biome.** Night glacier or deep forest: palette, fog, lighting
and prop set swapped on a distance threshold, cross-faded rather than cut. This
is cosmetic by design — biomes must not touch the solvability guarantee, only
chunk *weights* and what the props look like. `visuals.ts` currently holds one
palette as module constants; this phase is mostly turning that into a small set
of palettes with an interpolator.

**Testing.** The set-piece cannot break the guarantees — solvability, reaction
pacing and protected flight all still hold across seeds with the event enabled,
which is the whole risk of adding scripted track. The biome swap is asserted to
change nothing the generator uses to decide layout.

---

---

## Phase 4 — Tricks off a ramp

**Done.** The gap this closes is one only visible from inside the codebase: a
ramp launch is twenty-two metres of committed flight in which the player can
only steer, so the most dramatic second in a run was one they spent as a
passenger. Alto's and Ski Safari make exactly that window their expressive core.

A tap mid-flight spins. Each completed rotation pays more than the last, and
landing while one is still turning forfeits **the whole flight's** chain — so
the decision is always "one more?" and the cost of greed is everything already
earned, never the run itself. The arc, the landing and the cleared track after
it are untouched, which is what let this ship without the generator having to
learn anything: `tests/tricks.test.ts` asserts a tricking flight and a plain one
follow bit-identical trajectories.

Restricted to ramp flights on purpose. A tap in ordinary airtime already buffers
the next jump so it fires on touchdown, and that is worth more than tricks would
be there. A ramp flight is the one span where a tap did nothing at all.

Two things fell out of building it. `tap()` in `systems/player.ts` is now the
single place that decides what a tap means, because the trick priority initially
lived only in the gesture handler — which quietly left the dev bridge unable to
reproduce what a thumb does, the one job it has. And the trick timer snaps to
zero rather than clamping: fifteen subtractions of 1/60 from 0.25 leave a
positive residue around 1e-17, which would have reported a trick as unfinished
on the exact frame the player landed it.

---

## Phase 5 — The opening coach

**Done.** The game shipped for months teaching none of its three inputs: a new
player was dropped onto a generated slope and had to discover that a downward
swipe existed at all.

Reactive, not scripted, and that is the whole design. Nothing lays a tutorial
lane — the prompt to jump appears when something jumpable is genuinely on its
way, in the player's own lane, so the input is taught at the moment it is needed
on the real slope rather than in a sandbox they then have to leave. It also
means the coach cannot break a single thing the generator guarantees, because it
does not touch it. The one thing it asks of the track is a quiet opening, and
that goes through `clearUntil`, which has existed for ramp landings all along.

Each prompt retires the instant the input is used, inferred from the player's
own state rather than plumbed through from the gesture handler — so a swipe, an
arrow key and a scripted tap all count identically, and an input the game
rejected does not count as learnt. A ramp launch deliberately does not count as
a jump: the ramp threw them, they pressed nothing.

Most of `tests/coach.test.ts` is about restraint rather than about prompting. A
coach that speaks constantly is worse than none, and one that prompts for
something two lanes across teaches the wrong lesson about when jumping is the
answer.

---

## Phase 6 — Riders

**Done.** Characters as a second, deliberately *cosmetic* axis: five riders,
one free, priced 900 to 9000. Boards keep every handling stat. A character that
also changed how the game plays would double the balance surface for nothing,
and would turn the one thing players pick for personality into a thing they have
to pick for performance — `tests/characters.test.ts` pins the character
definition's exact shape so a stat cannot quietly appear on one.

Building it surfaced something that had been wrong since the yeti was first
modelled: **the rider's fur was part of the board.** `buildYeti` took a
`SkinDef` and read `fur`, `furShade` and `face` off it alongside `board` and
`boardTrim`, so buying a snowboard recoloured the animal riding it. Boards now
own the deck and its trim; characters own everything above it, including the
scarf and the goggle lenses, which were the board's colour for no reason anyone
would defend. Verified on screen: Shadow on the Classic board is a slate rider
with a purple scarf standing on an unchanged orange deck.

Old saves migrate to the default rider owned and equipped, which is exactly what
everyone was already riding — nothing granted, nothing taken away.

---

## Phase 7 — The shop, and the back button

**Done.** "Boards" was the wrong name on the wrong button: the page sells
boards, riders and upgrades, and naming it after one of the three is why nobody
found the other two. It is "Shop" now, with a `Store` glyph rather than a
mountain.

Everything on sale is shown **as it will look**. A board is previewed with the
rider currently equipped and a rider with the board currently equipped, so the
page answers what the *combination* looks like rather than describing half of
it. `BoardPreview` became `RiderPreview` and takes both — it had been reading
fur off the board, which is exactly the confusion the two were split to end.
Power-ups use the icons the HUD already uses mid-run, instead of a coloured
square; a square here and a magnet there is two things to learn instead of one.

Cards replaced three bespoke row layouts, which is how the page had ended up
with three button sizes and two ideas of where the price goes. Stats and
taglines get full-width rows: squeezed into the middle column the stat values
ran under the price, and a shop card with an ambiguous price is the one kind
that must not ship.

And then **tabs**, because fourteen cards stacked is a page you have to
remember your way down - on a phone the power-ups sat four screens below the
fold. Tabs are not free, though: they trade a long page for a page whose
contents are *hidden*, and hiding two thirds of a shop is how a player never
learns the riders exist. Each tab therefore carries a dot when it holds
something unowned *and* affordable - `hasAffordable` in `content/shopTabs.ts`,
kept out of the component so the rule is testable. Both halves of that condition
are load-bearing and `tests/shopTabs.test.ts` pins each: a dot on something out
of reach is a nag, a dot on a section already cleared is a lie, and either one
teaches the player to ignore every dot including the useful one.

### On TanStack Router

Considered and **not** added. These screens are modal layers over one persistent
canvas — the whole architecture turns on that Canvas mounting exactly once — so
there is nothing to address, nothing to deep-link to, and a history stack would
be a second copy of `screen` to keep in step with the first.

But the *reason* to want routing here was real and is now fixed: the Android
hardware back button closed the app from anywhere, including mid-run. It is a
`@capacitor/app` listener over `backTarget()`, a pure function of phase and
screen — pause mid-run, decline a revive, close an open screen, and exit only
from an idle home. That is the part a router would have given us, and it is
sixty lines and a test file rather than a dependency.

---

## Later, deliberately

- **Something to open.** A crate or a spin — now the biggest remaining gap. The
  genre's reward moment is not the coins, it is the *opening*, and there is
  still nowhere in this game that has any anticipation in it.
- **Something to open.** A mystery box or collection set. The genre's reward
  loop is not coins, it is the *moment* of opening.
- **Surface sound.** A grind loop on rails, reverb inside tunnels, wind that
  builds with speed.
- **Comparison beyond a local best.** Needs a backend, which is out of scope for
  v1 and stays out until something else is worth the server.

---

## Rules this work does not get to break

The five invariants in [CLAUDE.md](CLAUDE.md) all still apply, and two of them
are directly in the firing line here:

- Feedback runs in the render layer off a mutable impulse. **If a change would
  re-render React per frame, it is the wrong change.**
- A revive and a set-piece both put the player on track that nothing has cleared.
  **Committed flight is protected track** — that rule now has three costumes in
  the codebase and both of these are a fourth and fifth.
