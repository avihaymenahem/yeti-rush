/**
 * Every gameplay constant lives here.
 *
 * Game feel is found by tweaking numbers on a device, not by reasoning about
 * them. Hunting constants across a dozen files kills that loop, so nothing
 * outside this file may hard-code a gameplay magic number.
 *
 * Units: world units for distance (1 unit ~= 1 metre), seconds for time.
 */

/** Lane centre positions on the X axis, left to right. */
export const LANES = [-2.2, 0, 2.2] as const;

/** Valid indices into {@link LANES}. */
export type LaneIndex = 0 | 1 | 2;

export const CENTRE_LANE: LaneIndex = 1;

const jumpPeakHeight = 2.4;
const jumpRiseTime = 0.36;

const rampAirDistance = 22;

export const TUNING = {
  /** Fixed simulation step. Everything is simulated at exactly this rate. */
  sim: {
    /** Seconds per fixed tick (60 Hz). */
    step: 1 / 60,
    /** A single frame never advances the sim by more than this, no matter how
     *  long the app was backgrounded. Prevents the spiral of death. */
    maxFrameTime: 0.25,
    /** Hard cap on catch-up ticks per rendered frame. */
    maxStepsPerFrame: 5,
  },

  player: {
    /** The player never moves forward; the world scrolls past this Z. */
    z: 0,
    /**
     * Seconds to travel between two adjacent lanes.
     *
     * Tightened along with the speed increase. Steering has to get quicker as
     * the run gets faster or the same lane change eats more and more of the
     * gap between obstacles - and the track generator's guarantee is built on
     * how far the player travels during one.
     */
    laneChangeDuration: 0.15,

    jumpPeakHeight,
    jumpRiseTime,
    /** Derived: upward launch velocity that peaks at `jumpPeakHeight`. */
    jumpVelocity: (2 * jumpPeakHeight) / jumpRiseTime,
    /** Derived: gravity that brings the arc back down in `jumpRiseTime`. */
    gravity: (2 * jumpPeakHeight) / (jumpRiseTime * jumpRiseTime),
    /** Falling is faster than rising - a symmetric arc feels floaty. */
    fallGravityMultiplier: 1.35,
    /** A jump pressed this long before landing still fires on touchdown. */
    jumpBufferTime: 0.12,

    slideDuration: 0.7,

    /** Collider half-extents while running. */
    halfWidth: 0.38,
    halfHeight: 0.8,
    halfDepth: 0.38,
    /** Collider half-height while sliding. */
    slideHalfHeight: 0.34,
  },

  speed: {
    /**
     * World scroll speed at the start of a run, in units/second.
     *
     * The opening used to crawl. A runner has to feel quick from the first
     * second - the ramp is for escalation, not for getting up to a speed that
     * should have been the floor.
     */
    start: 21,
    /** Speed the run tops out at. */
    max: 36,
    /**
     * Seconds of running to reach `max`.
     *
     * Shortened along with the raised floor. The opening is the part every
     * player sees and most of them judge the game on, and starting at 16 spent
     * the first half-minute below the speed the game is actually about. The
     * ceiling is unchanged - this is about getting there sooner, not going
     * faster - so nothing the solvability check validates has moved: it is
     * proved at `max` against the fastest board, which is the same number.
     */
    rampSeconds: 115,
  },

  ramp: {
    /**
     * A ramp arc is defined in *space*, not time: the launch always covers
     * `airDistance` metres and peaks at `peakHeight`, whatever the current
     * speed. Defining it in seconds instead would make the arc shrink as the
     * run speeds up, and a chalet placed to be clearable at 12 u/s would
     * become a wall at 30 u/s.
     */
    airDistance: rampAirDistance,
    peakHeight: 4.6,
    /** Collider of the ramp trigger itself. */
    halfWidth: 0.9,
    halfHeight: 0.5,
    halfDepth: 1.0,
    centreY: 0.5,
    /**
     * Metres from the ramp to the chalet it clears - the apex of the arc.
     *
     * Not a free parameter. A chalet is over 3m deep, so its front face is
     * more than a metre before its centre; placed anywhere but the apex, the
     * player meets that face while still climbing and clips it. Deriving the
     * gap from the arc keeps the two from drifting apart.
     */
    chaletGap: rampAirDistance / 2,
    /**
     * Metres of obstacle-free track required after a ramp touches down.
     *
     * A launch commits the player to a 22 metre flight they cannot abort, and
     * the chalet at the apex hides whatever is behind it until they are over
     * the roof. Without a protected landing they come down onto an obstacle -
     * or clip one while still descending - with no way to have known it was
     * there. The spawner enforces this by laying an obstacle-free chunk after
     * any chunk containing a ramp.
     */
    landingClearance: 10,
  },

  /**
   * Grind rails.
   *
   * A level steel bar running down the track, mounted by *jumping onto it* -
   * a skate rail. Ride into one on the ground and you go down; ollie onto it and
   * you grind until it runs out or you steer off.
   *
   * The first version was a ramp wearing a rail's name: it rose from ankle
   * height to nearly four metres and was ridden onto at the low end, so it
   * carried the player over obstacles rather than asking anything of them, and
   * the one input everybody tries at a rail was not how you got on. A level bar
   * pays in coins and score rather than in rescue, which is what a grind is.
   */
  rail: {
    /**
     * Height of the bar. Low, like the handrail it is imitating.
     *
     * Two things set it. High enough that a standing player cannot ride under
     * it, and low enough that its underside clears no one at all - a sliding
     * player is `slideHalfHeight * 2` tall, and the bar sits below that, so
     * ducking is not a second way past. There is one answer to a rail and it is
     * to jump.
     *
     * Generous against the jump arc even so: the player's feet are above the bar
     * from roughly a twentieth of a second after take-off until just before
     * landing, so the ollie has to be in the right place, not at the right instant.
     */
    height: 0.8,
    /**
     * Metres from mount to dismount, rolled per rail from the run's seed.
     *
     * Randomised rather than authored, and long. Hand-picked lengths gave every
     * rail of a given chunk the same shape for ever, and the ones first written
     * were far too short to be worth catching - four metres is a seventh of a
     * second at top speed, which is not a grind, it is a bump. A rail wants to
     * be held long enough that steering off it early actually costs something.
     *
     * A rail may outrun its own chunk, which is fine and handled: the spawner
     * extends `clearUntil` past the far end, so whatever follows is laid as
     * clear track rather than as obstacles the rider would meet at bar height.
     */
    minLength: 14,
    maxLength: 30,
    /** Metres between the coins laid along a rail. */
    coinSpacing: 2.2,
    /**
     * How near the bar the player's feet must be to catch it, in metres.
     *
     * Sized against how far the player moves vertically in one 60 Hz tick, which
     * at the top of a fall is about 0.22 m. This leaves a window of several
     * ticks, so the catch is generous without the bar appearing to reach out.
     */
    catchHeight: 0.55,
    /**
     * Metres of obstacle-free track required after a rail drops the player.
     *
     * The dismount is a fall, and a falling player can steer but cannot jump or
     * slide - so anything in that stretch needing either is unanswerable, and a
     * row sealing every lane is fatal however well it was read. Exactly the
     * problem ramp landings had, protected the same way.
     *
     * Unlike a ramp, the descent is not a fixed *distance*: the fall takes fixed
     * time, so it covers more ground the faster the run gets. The spawner
     * measures it at the worst case rather than trusting this constant to cover
     * it - see `railLandingDistance`.
     */
    landingClearance: 8,

    /** Collider half-extents of the bar, per metre of its length. */
    halfWidth: 0.55,
    halfHeight: 0.16,
    halfDepth: 1.0,
  },

  snow: {
    /** Falling flakes. One draw call regardless of this number. */
    count: 900,
    /** Size of the box the flakes cycle within, centred on the player. */
    fieldWidth: 44,
    fieldHeight: 22,
    fieldDepth: 90,
    fallSpeed: 3.2,
    driftSpeed: 0.7,
    size: 0.14,
  },

  camera: {
    /** Vertical field of view in degrees (three.js cameras use vertical fov). */
    fov: 58,
    /** Eye height above the snow. */
    height: 3.6,
    /** Never come closer than this, however wide the screen is. */
    minDistance: 7.5,
    /** Height of the point the camera aims at. */
    lookAtHeight: 1.1,
    /** How far down the track the camera aims. */
    lookAheadZ: -12,
    /**
     * Fraction of the player's lane offset the camera follows. Below 1 so a
     * lane change actually moves the player within the frame - a camera locked
     * to the player makes the swipe invisible.
     */
    laneFollow: 0.38,
    /** Fraction of the player's jump height the camera rises by. */
    jumpFollow: 0.35,
    /** Clearance between the player's collider and the screen edge, in units. */
    edgeMargin: 0.55,
  },

  stumble: {
    /**
     * Clipping a low obstacle trips the player rather than ending the run.
     * Instant death on every contact makes the early game feel arbitrary, and
     * leaves the ski patrol with nothing to react to. A trip costs speed,
     * breaks the combo, and lets the patrol gain ground - and being tripped
     * while the patrol is already on top of you is what actually kills.
     */
    duration: 0.7,
    /** World speed is scaled by this while recovering. */
    speedMultiplier: 0.55,
  },

  collision: {
    /** Colliders are shrunk by this fraction so near-misses feel generous. */
    forgiveness: 0.15,
    /** Only entities within this many units of the player are tested at all. */
    zWindow: 6,
    /**
     * Clearance below which passing an obstacle counts as a near miss.
     *
     * Measured against the *full* colliders, not the shrunk ones the hit test
     * uses, so the best near miss of all is one the forgiveness margin saved -
     * which is the moment worth paying for.
     *
     * There is a hard ceiling here and it is not a matter of taste. Adjacent
     * lanes are 2.2 apart, so a player one lane over clears the widest obstacle
     * by about 1.2; set this above that and "near miss" comes to mean "was on
     * the track at the time" and pays out constantly for nothing. `nearMiss`
     * tests assert the ceiling rather than this number, because the number is
     * feel and the ceiling is correctness.
     *
     * Measured with the headless pilot in `tests/support/autopilot.ts` over 40
     * seeds: this fires about 4.7 times per kilometre, roughly one every nine
     * seconds of play. It also sits in a wide flat spot - anything from 0.34 to
     * 0.7 measured identically - so the exact value is not load-bearing, which
     * is where a threshold wants to be. Note the pilot commits every jump at a
     * fixed lead and so clears things by an unnaturally consistent margin; a
     * human's spread is wider and this will fire somewhat more often for them.
     */
    nearMissGap: 0.5,
  },

  track: {
    /** Length of one authored track chunk. */
    chunkLength: 20,
    /** Chunks kept alive ahead of the player. */
    chunksAhead: 5,
    /** How far past the camera a chunk survives before being recycled. */
    recycleBehind: 20,
    /**
     * How far ahead geometry is drawn.
     *
     * Has to be far enough out that the fog has fully closed in before anything
     * appears, or obstacles pop into existence in clear air. With the thinned
     * fog the world is ~90% hazed by 210 units, so this sits at that edge.
     * Drawing further costs instances, not draw calls - every obstacle kind is
     * one instanced mesh however many of it are on screen.
     */
    drawDistance: 210,
  },

  coins: {
    /**
     * Pickup uses a radius, not the box test obstacles use. Coins should feel
     * magnetic to brush past; obstacles should feel precise.
     */
    pickupRadius: 1.1,
    /** Height of a coin sitting on the ground line, roughly chest height. */
    baseHeight: 0.9,
    /** Extra height at the top of an arced coin run, to reward jumping. */
    arcPeak: 1.2,
    /** Default metres between coins in a run. */
    spacing: 1.4,
    /**
     * Scales the length of *plain* coin runs, leaving ramp and rail lines alone.
     *
     * The track used to lay 44 coins every 100 m, which put the entire shop
     * inside a day's play. The fix is not to strip coins off the greedy routes -
     * a ramp flight or a rail grind that pays nothing is a risk with no reason -
     * so the arcs traced by `rampFrom` and `railFrom` keep every coin. Their
     * counts are derived from the flight path anyway, and shortening one would
     * leave the back half of an arc bare.
     *
     * What thins out is the filler: the runs lying on open track that reward
     * nothing but being there. That makes the routes worth more relative to
     * everything else, which is the balance this always should have had.
     */
    plainRunScale: 0.4,
    /**
     * Scales ramp and rail coin lines, with the spacing widened to compensate.
     *
     * These runs cannot simply be shortened - their counts are derived from the
     * flight path, and dropping coins off the end leaves the back half of a
     * route unrewarded. Stretching the gaps by the same factor keeps the line
     * tracing the whole arc while laying fewer coins along it, which is the only
     * way to thin a route without breaking what it is for.
     */
    routeRunScale: 0.55,
    /**
     * Chance that an authored coin run is actually laid.
     *
     * Every obstacle and every house used to come with its own coin line, which
     * made coins scenery: guaranteed, predictable, and worth nothing to spot
     * because they were always exactly where the last ones were. Rolling for
     * each run scatters them, so noticing a line is worth something and an empty
     * stretch is a real stretch rather than a gap in the pattern.
     *
     * Route lines are rolled too, but far less often refused. A ramp or a rail
     * now costs something to take, and a route that usually pays nothing is a
     * route nobody has a reason to risk.
     */
    plainRunChance: 0.45,
    routeRunChance: 0.85,
    /**
     * How far out a magnet visibly reels a coin in, in metres.
     *
     * Presentation only - the simulation's pickup radius is untouched. Hot Cocoa
     * multiplied that radius by six and nothing else, so coins were collected
     * from nearly seven metres away by silently blinking out of existence: the
     * most powerful thing in the game and there was no way to tell it was on.
     *
     * Set wider than the pickup radius on purpose, and the pull is scaled so a
     * coin arrives *exactly* as it is collected. Any narrower and coins would
     * still be halfway across the piste when they vanished, which looks like a
     * bug rather than a magnet.
     */
    magnetVisualRange: 14,
    /** Visual radius. */
    radius: 0.32,
    /** Spin speed in radians/second. */
    spinRate: 2.4,
  },

  /**
   * The avalanche.
   *
   * Fifteen seconds, every so often, where the rules change: the patrol is
   * right on the player's shoulder, so the trip that normally costs a combo
   * ends the run instead. Nothing about the *track* changes - the solvability
   * guarantee, the reaction pacing and every protected span are untouched,
   * which is deliberate. A scripted stretch that also generated its own track
   * would need its own proof that the track is survivable, and there is no
   * version of that which is safer than reusing the one already proved.
   *
   * So the escalation is entirely in the consequence of a mistake. It costs no
   * new generation rules and cannot make a run unwinnable - a player who reads
   * the slope as well during it as before it comes out the other side.
   */
  avalanche: {
    /** Metres before the first one. Long enough to have learnt the controls. */
    firstAt: 700,
    /** Metres between them afterwards. */
    interval: 900,
    /** Seconds each lasts. */
    duration: 15,
    /** World speed multiplier while it is behind you. */
    speedBoost: 1.12,
    /** Score for surviving one, before the mode multiplier. */
    bonus: 600,
  },

  /**
   * The second chance.
   *
   * Dying on a personal best is exactly when a player stops playing, and every
   * runner in the genre sells a way past that moment. The price doubling within
   * a run is what keeps it a decision: the first is cheap enough to always take
   * and the third costs a good run's whole haul.
   */
  revive: {
    /** Coins for the first revive of a run. */
    basePrice: 250,
    /** Each further revive in the same run costs this much more again. */
    priceGrowth: 2,
    /** Nobody rides for ever on a wallet. */
    maxPerRun: 3,
    /** Seconds the offer stays open before the run is banked. */
    offerSeconds: 6,
    /**
     * Seconds of untouchability after coming back.
     *
     * Separate from, and shorter than, the track clearance below. The clearance
     * is what stops the player being killed by something they never saw; this
     * is what stops them being killed by the thing they were already inside
     * when the run ended, which no amount of clear track ahead can help with.
     */
    graceSeconds: 1.6,
    /**
     * Seconds of clear track laid ahead of a revive.
     *
     * The committed-flight rule in a fifth costume. A revived player restarts
     * inside whatever killed them with no speed lost and nothing read, so the
     * track ahead has to be as clear as a ramp landing - and for the same
     * reason. Converted to metres at the live speed, never a fixed distance,
     * because the whole point is that it is a *reaction* window.
     */
    clearSeconds: 1.5,
  },

  scoring: {
    /** Score awarded per world unit travelled. */
    pointsPerUnit: 1,
    /** Score awarded per coin, before multipliers. */
    pointsPerCoin: 10,
    /**
     * Score for squeezing past an obstacle inside `collision.nearMissGap`.
     *
     * Worth about two coins. Enough that cutting it fine is the better line and
     * not so much that the optimal play is to aim at things - the run already
     * ends if the read is wrong, and that is the whole tension being paid for.
     */
    pointsPerNearMiss: 20,
    /** Coins added to the persisted wallet per coin picked up. */
    walletPerCoin: 1,
  },
} as const;

export type Tuning = typeof TUNING;
