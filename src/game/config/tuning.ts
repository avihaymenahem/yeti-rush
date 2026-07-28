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
   * The second optional route, alongside the ramp, and deliberately a different
   * shape of decision. A ramp is a commitment: hit it and you fly a fixed arc
   * you cannot abort. A rail is *held* - you mount it by sliding, you ride it up
   * for as long as you stay in its lane, and steering off drops you. One rewards
   * timing, the other rewards nerve.
   *
   * Like the ramp arc, the rise is defined over distance rather than time, so
   * the rail carries the player to the same height at every speed.
   */
  rail: {
    /** Metres from mount to release. */
    length: 18,
    /**
     * Height of the near end. Low enough that a sliding player meets it at
     * their own height and steps on rather than being snapped upwards, and low
     * enough that riding past one without sliding never looks like a wall.
     */
    baseHeight: 0.2,
    /**
     * Height gained by the far end.
     *
     * Set by what the rail has to clear, not by taste. A boulder stands 3.0 m
     * and a woodpile 3.2 m, and the rider has to be over them with margin
     * *before* the end of the bar - at 2.9 the rail only cleared a boulder in
     * its last metre, so the coin line led riders straight into one.
     * `tests/rail.test.ts` checks every authored rail against its own
     * obstacles, so this cannot drift back.
     */
    rise: 3.6,
    /**
     * Upward velocity at release, so the rail throws you off the end instead of
     * dropping you off it. Well under a jump - this is a pop, not a launch.
     */
    exitVelocity: 3.4,
    /**
     * How near the bar the player's feet must be to catch it, in metres.
     *
     * The rail is caught along its whole length, not just at the near end, so
     * jumping at one lands you on it wherever the arc happens to meet the bar.
     * Requiring the near end meant a jump - the instinct every rail in every
     * game trains - sailed over the mount point and dumped the player back on
     * the ground with the obstacle the rail exists to clear already too close
     * to steer around.
     *
     * Sized against how far the player moves vertically in one tick. A dive is
     * the fastest that gets: 13.3 u/s, or 0.22 m per 60 Hz step. This leaves
     * roughly five steps of window, so the catch is generous without the bar
     * appearing to reach out and grab anyone.
     */
    catchHeight: 0.55,
    /**
     * The highest the bar can be and still be ridden onto from the snow.
     *
     * Riding straight into a rail mounts it - no jump, no slide, nothing to
     * time. It is a solid steel bar standing on posts, and the one thing a
     * player will always try is going at it in a straight line; demanding an
     * input first meant that attempt passed clean through the middle of it.
     *
     * Above this the bar is over the player's head and they simply run
     * underneath, which is what keeps the track beneath a rail passable on its
     * own terms. At 0.2 m of rise per metre this makes the near 3.5 m of every
     * rail a mount, or six ticks even at top speed - wide enough that arriving
     * at it cannot miss it.
     */
    stepUpHeight: 0.9,
    /**
     * Metres of obstacle-free track required after a rail throws the player off.
     *
     * The exit is a fall from nearly four metres, and a falling player can steer
     * but cannot jump or slide - so anything in that stretch needing either is
     * unanswerable, and a row that seals every lane is fatal no matter how well
     * it was read. Exactly the problem ramp landings had, and it is protected
     * the same way: the spawner keeps the whole descent plus this margin clear.
     *
     * Unlike the ramp, the descent itself is *not* a fixed distance - the fall
     * takes a fixed time, so it covers more ground the faster the run gets. The
     * spawner therefore measures it at the worst case rather than assuming this
     * constant covers it.
     */
    landingClearance: 10,

    /** Trigger box at the near end, where the player mounts. */
    halfWidth: 0.75,
    halfHeight: 0.45,
    halfDepth: 1.0,
    centreY: 0.4,
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
    plainRunScale: 0.65,
    /** Visual radius. */
    radius: 0.32,
    /** Spin speed in radians/second. */
    spinRate: 2.4,
  },

  scoring: {
    /** Score awarded per world unit travelled. */
    pointsPerUnit: 1,
    /** Score awarded per coin, before multipliers. */
    pointsPerCoin: 10,
    /** Coins added to the persisted wallet per coin picked up. */
    walletPerCoin: 1,
  },
} as const;

export type Tuning = typeof TUNING;
