# Backlog

Things agreed but not built. Each entry says what it is and, where it matters,
the constraint that makes it non-trivial - so picking one up does not start with
rediscovering why it was left.

## Cosmetic props in the shop

Attachments the yeti carries or wears: a sword, a stick, a hat, that sort of
thing. **Purely cosmetic - no gameplay effect whatsoever.** The point is to give
coins somewhere to go: boards already carry the stat trade-offs, and once a
player owns the ones they want there is nothing left to spend on.

Notes for whoever builds it:

- Keep it strictly separate from `skins.ts`. Boards have `BoardStats` that feed
  the track generator's worst-case validation (`worstCaseSpeed`,
  `worstCaseLaneChangeDuration`); a prop must never touch that path, or every
  solvability and pacing guarantee has to be re-derived against it.
- The yeti is one merged vertex-coloured geometry per skin
  (`render/yetiGeometry.ts`), built for a single instanced draw call. A prop
  should be its own small merged geometry parented to a joint in `YETI_JOINTS`,
  not merged into the body - otherwise every prop combination is a separate
  geometry to build and cache.
- Equipping is a save-schema change: an `equippedProp` field plus `ownedProps`,
  migrating to `null` for existing saves. `migrate` must keep tolerating a save
  that has never heard of props.
- The shop is already scrollable and has a boards section; this is a second
  section, not a second screen.
