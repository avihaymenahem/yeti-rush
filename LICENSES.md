# Third-party assets

Every 3D model bundled in `src/assets/models/` is listed here with its source
and licence. Nothing goes into that directory without an entry.

## Kenney — Holiday Kit

- **Source:** https://kenney.nl/assets/holiday-kit
- **Licence:** Creative Commons CC0 1.0 Universal (public domain dedication)
- **Downloaded:** 2026-07-27, `kenney_holiday-kit.zip` (4.27 MB)
- **Full licence text:** `assets-src/kenney_holiday-kit-License.txt`

Models used:

| File | Used for |
| --- | --- |
| `snow-pile.glb` | `drift` obstacle (jump over) |
| `tree-snow-a.glb` | Treeline scenery |
| `tree-snow-b.glb` | Treeline scenery |
| `tree-snow-c.glb` | Treeline scenery |

Also extracted and available but not yet wired in: `bench`, `cabin-roof-snow`,
`cabin-wall-roof`, `cabin-window-a`, `lantern`, `present-a-cube`, `rocks-large`,
`sled`, `snow-bunker`, `snowman`.

## Kenney — Nature Kit

- **Source:** https://kenney.nl/assets/nature-kit
- **Licence:** Creative Commons CC0 1.0 Universal (public domain dedication)
- **Downloaded:** 2026-07-27, `kenney_nature-kit.zip` (10.05 MB)
- **Full licence text:** `assets-src/kenney_nature-kit-License.txt`

Models used:

| File | Used for |
| --- | --- |
| `log_large.glb` | `log` obstacle (jump over) |
| `rock_tallD.glb` | `boulder` obstacle (dodge) |

Also extracted and available but not yet wired in: `fence_simple`, `log`,
`rock_largeA`, `stump_old`, `tree_pineSmallA`, `tree_pineTallA`.

`cliff_block_stone.glb` was used for an `iceWall` obstacle and has been removed.
It is a 1:1:1 block, so fitting it to the 1.9 x 3.2 x 0.8 collider stretched it
into a flat slab that read as a blue rectangle. The `woodpile` that replaced it
is built in code.

## CC0 summary

CC0 places the work in the public domain. There is no attribution requirement -
this file exists so the project can prove provenance, not because the licence
demands it. Kenney asks for a credit as a courtesy, which the game should carry
in a credits screen before release.

## Not third-party

The yeti, chalets, ramps, coins, power-up pickups, ski patrol and overhead
barriers are all built procedurally from primitives in `src/game/render/`. The
yeti in particular is kept procedural because it is animated from simulation
state; a static imported mesh would be a downgrade.

## Adding an asset

1. Download the pack into `assets-src/` (gitignored; keep the archive out of git).
2. Extract only the `.glb` files needed into `src/assets/models/`.
3. Add a row above, with the source URL and licence.
4. Register it in `src/game/content/models.ts`, fitted to the existing collider.
   Colliders are authoritative - art is scaled to them, never the reverse.
