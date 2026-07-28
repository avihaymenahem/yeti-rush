/**
 * Sound effects, synthesised at runtime.
 *
 * Every sound is generated with Web Audio oscillators and noise buffers rather
 * than loaded from files. That keeps the bundle free of audio assets entirely,
 * costs a few hundred bytes of code instead of a few hundred kilobytes, and
 * sidesteps decode latency on the first coin of every session.
 *
 * Mobile browsers refuse to start an AudioContext without a user gesture, so
 * the context is created lazily on the first sound and `unlock` is wired to the
 * first touch. Every call is safe to make before that happens - it simply does
 * nothing rather than throwing.
 */

let context: AudioContext | null = null;
let master: GainNode | null = null;
/** Music sits on its own bus so it can be mixed and muted independently. */
let musicBus: GainNode | null = null;
/** Post-limiter music level, where the player's music slider is applied. */
let musicMakeup: GainNode | null = null;
/** Everything in `audio.ts` goes through here, so one slider governs it all. */
let sfxBus: GainNode | null = null;

/**
 * Player volumes, 0-1, held here as well as on the nodes.
 *
 * The settings are loaded from the save before the first touch, which is before
 * an AudioContext is allowed to exist, so the values have to survive until
 * there are nodes to put them on.
 */
let sfxGain = 1;
let musicGain = 1;

/**
 * Converts a 0-100 slider position into a gain multiplier.
 *
 * Squared rather than linear, because loudness is not. On a linear slider
 * almost the entire audible range is crammed into the bottom fifth of the
 * travel and the top half does nothing perceptible; squaring spreads the change
 * out so each step of the slider sounds like a similar step in volume.
 */
export function volumeToGain(percent: number): number {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 100));
  const normalised = clamped / 100;
  return normalised * normalised;
}

/**
 * Level of the score against the effects.
 *
 * The score used to sit at 0.42 under a 0.35 master, which measured around
 * -50 dBFS - inaudible on a phone next to the effects. Simply turning it up
 * is not available: the voices in `music.ts` sum to a peak of about 1.1 on the
 * downbeat of a chord change, so anything past unity clips the moment a crash
 * lands on the same frame.
 *
 * So the bus is driven *into* a limiter and the level is recovered after it.
 * Peaks are caught by the limiter rather than the mix being kept quiet enough
 * that they never happen, which is what lets the body of the music sit an order
 * of magnitude higher than before while the loudest moment stays under full
 * scale. Standard practice, and the only way to be both loud and safe.
 */
const MUSIC_BUS_GAIN = 1.6;
/** Recovers the level the limiter takes off. */
const MUSIC_MAKEUP_GAIN = 1.4;

function ensureContext(): AudioContext | null {
  if (context) return context;
  if (typeof window === 'undefined') return null;

  try {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.35;
    master.connect(context.destination);

    // Music path: bus -> limiter -> makeup -> master. Effects deliberately
    // bypass the limiter and go straight to the master, so a crash keeps its
    // full transient instead of being flattened along with the score.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 6;
    limiter.ratio.value = 4;
    // Fast enough to catch a downbeat, slow enough not to audibly pump.
    limiter.attack.value = 0.005;
    limiter.release.value = 0.25;

    // The player's music slider is applied here, after the limiter. Scaling the
    // bus instead would change how hard the limiter is driven, so turning the
    // music down would also change how it sounds.
    musicMakeup = context.createGain();
    musicMakeup.gain.value = MUSIC_MAKEUP_GAIN * musicGain;
    musicMakeup.connect(master);
    limiter.connect(musicMakeup);

    musicBus = context.createGain();
    musicBus.gain.value = MUSIC_BUS_GAIN;
    musicBus.connect(limiter);

    sfxBus = context.createGain();
    sfxBus.gain.value = sfxGain;
    sfxBus.connect(master);

    return context;
  } catch {
    // No Web Audio on this device. The game is perfectly playable silent.
    return null;
  }
}

/**
 * The shared context and music bus, for the score in `music.ts`.
 * Returns null until audio has been unlocked by a user gesture.
 */
export function getMusicOutput(): { context: AudioContext; bus: GainNode } | null {
  const ctx = ensureContext();
  if (!ctx || !musicBus) return null;
  return { context: ctx, bus: musicBus };
}

/** Call from the first user gesture. Safe to call repeatedly. */
export function unlockAudio(): void {
  const ctx = ensureContext();
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
}

/** Sets the effects level from a 0-100 slider position. */
export function setSfxVolume(percent: number): void {
  sfxGain = volumeToGain(percent);
  if (sfxBus) sfxBus.gain.value = sfxGain;
}

/** Sets the music level from a 0-100 slider position. */
export function setMusicVolume(percent: number): void {
  musicGain = volumeToGain(percent);
  if (musicMakeup) musicMakeup.gain.value = MUSIC_MAKEUP_GAIN * musicGain;
}

/** True when effects would be inaudible, so they can skip the work entirely. */
export function isSfxSilent(): boolean {
  return sfxGain <= 0;
}

export function setMasterVolume(value: number): void {
  if (master) master.gain.value = Math.max(0, Math.min(1, value));
}

interface ToneOptions {
  type?: OscillatorType;
  /** Starting frequency in Hz. */
  from: number;
  /** Frequency to glide to; defaults to `from`. */
  to?: number;
  duration: number;
  gain?: number;
  /** Seconds to wait before starting, for building small chords. */
  delay?: number;
}

function tone(options: ToneOptions): void {
  if (isSfxSilent()) return;
  const ctx = ensureContext();
  if (!ctx || !sfxBus) return;

  const start = ctx.currentTime + (options.delay ?? 0);
  const end = start + options.duration;

  const osc = ctx.createOscillator();
  osc.type = options.type ?? 'sine';
  osc.frequency.setValueAtTime(options.from, start);
  if (options.to !== undefined && options.to !== options.from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.to), end);
  }

  const gain = ctx.createGain();
  const peak = options.gain ?? 0.25;
  // A short attack avoids the click a hard start produces, and an exponential
  // release is what makes a synthesised blip sound like an instrument.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(gain);
  gain.connect(sfxBus);
  osc.start(start);
  osc.stop(end + 0.02);
}

/** Filtered white noise - snow spray, impacts, wind. */
function noise(duration: number, peakGain: number, filterHz: number, sweepTo?: number): void {
  if (isSfxSilent()) return;
  const ctx = ensureContext();
  if (!ctx || !sfxBus) return;

  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(filterHz, ctx.currentTime);
  if (sweepTo !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(1, sweepTo),
      ctx.currentTime + duration,
    );
  }

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peakGain, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(sfxBus);
  source.start();
}

// --- The kit ----------------------------------------------------------------

/** Carving across to another lane. */
export function sfxLaneChange(): void {
  noise(0.14, 0.12, 1400, 600);
}

export function sfxJump(): void {
  tone({ type: 'triangle', from: 320, to: 620, duration: 0.16, gain: 0.18 });
}

export function sfxSlide(): void {
  noise(0.28, 0.16, 700, 260);
}

/**
 * Coin pitch rises with the combo, so a long clean streak audibly climbs.
 * Capped so it never becomes shrill.
 */
export function sfxCoin(streak = 0): void {
  const step = Math.min(streak, 12);
  tone({
    type: 'square',
    from: 880 * Math.pow(2, step / 24),
    duration: 0.07,
    gain: 0.1,
  });
}

export function sfxRamp(): void {
  tone({ type: 'sawtooth', from: 200, to: 720, duration: 0.35, gain: 0.16 });
  noise(0.3, 0.14, 900, 2200);
}

export function sfxPowerUp(): void {
  // A quick rising arpeggio reads as "you gained something".
  tone({ type: 'square', from: 523, duration: 0.09, gain: 0.12 });
  tone({ type: 'square', from: 659, duration: 0.09, gain: 0.12, delay: 0.07 });
  tone({ type: 'square', from: 880, duration: 0.16, gain: 0.12, delay: 0.14 });
}

export function sfxPowerDown(): void {
  tone({ type: 'square', from: 660, to: 330, duration: 0.22, gain: 0.09 });
}

/**
 * Riding through something solid on the ghost board.
 *
 * Replaced a low crunch with debris under it, which was the sound of an impact
 * that no longer happens - the obstacle is left standing now. Upward-sweeping
 * noise and a rising sine instead: a thing passing through you rather than
 * breaking, and quiet, because on a good line these fire in quick succession.
 */
export function sfxPhase(): void {
  noise(0.26, 0.1, 500, 3000);
  tone({ type: 'sine', from: 320, to: 900, duration: 0.24, gain: 0.08 });
}

export function sfxCrash(): void {
  noise(0.5, 0.34, 500, 80);
  tone({ type: 'sawtooth', from: 240, to: 50, duration: 0.45, gain: 0.2 });
}

/**
 * Air torn past the ear as something is scraped by.
 *
 * Noise sweeping *downward* from bright to dull, which is what a fixed object
 * passing a moving listener actually does. Quiet on purpose: these fire several
 * times in a dense stretch, and a near miss that announces itself as loudly as
 * a crash trains the player to read it as one.
 */
export function sfxNearMiss(): void {
  noise(0.16, 0.09, 3200, 700);
}

/** Board meeting snow. Short, dull and low - weight rather than event. */
export function sfxLand(): void {
  noise(0.18, 0.13, 420, 150);
}
