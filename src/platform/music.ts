/**
 * The score, synthesised at runtime.
 *
 * No audio files. A three-minute loop would be around 3 MB against a 6 MB app,
 * and it would play the same whatever is happening on screen. This is a few
 * kilobytes of code, needs no licence, and - the actual reason - it can react:
 * the arpeggio thickens as the run speeds up, and the harmony darkens when the
 * ski patrol closes in. The player hears the danger before they turn to look.
 *
 * ## Why this was rewritten
 *
 * The first version was reported as getting "annoying and boring very fast",
 * and both halves of that were fair and had separate causes.
 *
 * *Boring* was the form. Four chords, two bars each, looping for ever: the
 * whole piece was eight bars long, so a player heard all of it inside twenty
 * seconds and then heard it again three hundred times. It now runs a 32-bar
 * form - two harmonic phrases, four textural variations over them - and takes
 * about eighty seconds to repeat, with the arpeggio dropping out entirely for
 * one bar in each phrase. The rests do more work than the extra chords: a
 * texture that never stops is what stops being heard.
 *
 * *Annoying* was a raw square wave. An unfiltered square is all odd harmonics
 * straight up the spectrum, and a phone speaker's response peaks exactly where
 * that is worst. Every pitched voice now runs through a lowpass, and the
 * arpeggio's cutoff opens with speed - which doubles as the clearest energy cue
 * in the piece, because a filter sweep reads as acceleration in a way that
 * simply playing more notes does not.
 *
 * ## Shape of the code
 *
 * `voicesForStep` is pure: a sixteenth-note index and the current intensity in,
 * a list of voices out. Nothing about Web Audio is in it, so the arrangement -
 * the form, the rests, and the gain budget below - is testable without a device
 * that can make a sound. `scheduleStep` is the only part that touches nodes.
 *
 * Scheduling uses the standard Web Audio lookahead pattern: a coarse timer
 * wakes up often enough to queue the next fraction of a second of notes at
 * *sample-accurate* times. Firing notes directly from a timer would put every
 * one of them a few milliseconds late and the result would audibly stagger.
 */

import { getMusicOutput } from '@/platform/audio';

/** Beats per minute. Unhurried - the speed comes from the arpeggio, not tempo. */
const BPM = 100;
/** Sixteenth notes per bar. */
export const STEPS_PER_BAR = 16;
const STEP_SECONDS = 60 / BPM / 4;

/** How far ahead notes are queued, and how often the scheduler wakes. */
const LOOKAHEAD_SECONDS = 0.16;
const TICK_MS = 40;

const BARS_PER_CHORD = 2;
/** Bars in one phrase. Four chords at two bars each. */
export const BARS_PER_PHRASE = BARS_PER_CHORD * 4;
/** Phrases before the whole piece repeats. */
export const PHRASES_PER_CYCLE = 4;
export const BARS_PER_CYCLE = BARS_PER_PHRASE * PHRASES_PER_CYCLE;

/**
 * Chords, as semitone offsets from A3 (220 Hz).
 *
 * The bass sits an octave below the pad and no lower. It was written two
 * octaves down, which put the root notes at 33-55 Hz: correct on paper, and
 * completely silent through a phone speaker, which has no output at all down
 * there. Everything the player is meant to hear lives above 65 Hz, and
 * `playBass` doubles each note an octave up so the line survives a speaker the
 * size of a fingernail.
 */
interface Chord {
  bass: number;
  notes: readonly [number, number, number];
  /** The note the bell picks out. */
  colour: number;
}

const CHORDS = {
  Am: { bass: -12, notes: [0, 3, 7], colour: 14 },
  F: { bass: -16, notes: [-4, 0, 3], colour: 12 },
  C: { bass: -21, notes: [-9, -5, -2], colour: 7 },
  G: { bass: -14, notes: [-2, 2, 5], colour: 9 },
  Dm: { bass: -19, notes: [-7, -4, 0], colour: 5 },
  E: { bass: -17, notes: [-5, -1, 2], colour: 11 },
} as const satisfies Record<string, Chord>;

/**
 * Two phrases, alternating.
 *
 * The first is the wistful one the game opens on. The second swaps the second
 * half for Dm and a major E, which is the only leading tone in the piece and
 * pulls hard back to the A minor at the top - so the loop point is something
 * the ear arrives at rather than something it merely reaches again.
 */
const PHRASES = [
  [CHORDS.Am, CHORDS.F, CHORDS.C, CHORDS.G],
  [CHORDS.Am, CHORDS.F, CHORDS.Dm, CHORDS.E],
] as const;

/**
 * Arpeggio figures, one per phrase of the cycle.
 *
 * Indices into the chord, where 3 means the root an octave up. Changing the
 * figure every eight bars is most of what stops the fast layer - the one
 * playing on nearly every step - from being the thing that wears out first.
 *
 * They must differ in their *even* positions, not merely as sequences. Below
 * about half speed the arpeggio plays eighths, so only positions 0 and 2 are
 * ever heard - and the first four figures written here were `[0,1,2,1]` and
 * `[0,1,2,3]`, which differ only at position 3. Two of the four phrases were
 * therefore note-for-note identical for most of a run, which is exactly the
 * repetition this was added to fix. `tests/music.test.ts` caught it.
 */
const ARP_FIGURES = [
  [0, 1, 2, 1],
  [0, 2, 1, 2],
  [2, 1, 0, 3],
  [1, 2, 3, 0],
] as const;

function frequency(semitonesFromA3: number): number {
  return 220 * Math.pow(2, semitonesFromA3 / 12);
}

export interface MusicIntensity {
  /** 0 at the start of a run, 1 at top speed. Drives the arpeggio. */
  energy: number;
  /** 0 when safe, 1 with the patrol on your shoulder. Darkens the harmony. */
  tension: number;
  /** False on the menus, where the score stays sparse and calm. */
  running: boolean;
}

/**
 * One scheduled sound, with no Web Audio in it.
 *
 * `role` exists for the tests rather than for playback - it is what lets an
 * assertion say "the arpeggio rests here" without inspecting a frequency.
 */
export type VoiceRole = 'pad' | 'bass' | 'arp' | 'tension' | 'bell' | 'kick' | 'hat';

export interface Voice {
  role: VoiceRole;
  type: OscillatorType;
  frequency: number;
  duration: number;
  gain: number;
  /** Seconds of fade-in. Long attacks make a pad; short ones make a pluck. */
  attack: number;
  detune?: number;
  /** Lowpass corner in Hz. Every pitched voice has one; see the header. */
  cutoff?: number;
  /** Frequency to fall to, for the kick's pitch drop. */
  sweepTo?: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let nextStepTime = 0;
let step = 0;
let enabled = true;

const intensity: MusicIntensity = { energy: 0, tension: 0, running: false };

/** Called every frame by the game loop. Cheap - it only stores three numbers. */
export function setMusicIntensity(next: MusicIntensity): void {
  intensity.energy = next.energy;
  intensity.tension = next.tension;
  intensity.running = next.running;
}

/**
 * Everything that sounds on one sixteenth-note step.
 *
 * Gain budget: on the worst step the piece can produce - the downbeat of a
 * phrase, at full energy, with the patrol closing - the voices below sum to
 * about 1.15, counting the bass twice because it is doubled an octave up. That
 * is driven into the limiter in `audio.ts` deliberately rather than kept under
 * unity, so the body of the music can sit loud enough to hear on a phone. Raise
 * anything here and `tests/music.test.ts` will tell you what it cost.
 */
export function voicesForStep(index: number, level: MusicIntensity): Voice[] {
  const voices: Voice[] = [];

  const bar = Math.floor(index / STEPS_PER_BAR);
  const beatInBar = index % STEPS_PER_BAR;
  const phrase = Math.floor(bar / BARS_PER_PHRASE) % PHRASES_PER_CYCLE;
  const barInPhrase = bar % BARS_PER_PHRASE;

  const chords = PHRASES[phrase % PHRASES.length]!;
  const chord = chords[Math.floor(barInPhrase / BARS_PER_CHORD) % chords.length]!;

  // On the menus the score idles: pad and a little bass, nothing driving.
  const energy = level.running ? Math.max(0, Math.min(1, level.energy)) : 0;
  const tension = level.running ? Math.max(0, Math.min(1, level.tension)) : 0;

  const barSeconds = STEP_SECONDS * STEPS_PER_BAR;

  // --- Pad: one long swell per bar -----------------------------------------
  if (beatInBar === 0) {
    for (const note of chord.notes) {
      voices.push({
        role: 'pad',
        type: 'sine',
        frequency: frequency(note),
        duration: barSeconds * 0.98,
        gain: 0.07 + energy * 0.02,
        attack: barSeconds * 0.35,
        // A little detune between the voices gives the pad width without a
        // second oscillator per note.
        detune: (note % 3) * 4 - 4,
        cutoff: 2200,
      });
    }
  }

  // --- Bass: on the beat, harder as the run builds --------------------------
  if (beatInBar % 4 === 0) {
    const accent = beatInBar === 0 ? 1 : 0.72;
    voices.push({
      role: 'bass',
      type: 'triangle',
      frequency: frequency(chord.bass),
      duration: STEP_SECONDS * 3.2,
      gain: (0.16 + energy * 0.08) * accent,
      attack: 0.012,
      cutoff: 1400,
    });
  }

  /*
   * --- The bar off ---------------------------------------------------------
   *
   * The last bar of the odd phrases drops the arpeggio and the kit, leaving pad
   * and bass. It is the cheapest thing in this file and the one that made the
   * most difference: eight bars of unbroken sixteenths is what turns a hook
   * into a drone, and the ear only notices a texture when it comes back.
   */
  const resting = barInPhrase === BARS_PER_PHRASE - 1 && phrase % 2 === 1;

  // --- Arpeggio: the layer that carries the speed ---------------------------
  // Sparse eighths when cruising, full sixteenths flat out, so acceleration is
  // something you hear as well as see.
  const sixteenths = energy > 0.55;
  const onArpStep = sixteenths ? true : beatInBar % 2 === 0;

  if (level.running && onArpStep && !resting) {
    const figure = ARP_FIGURES[phrase]!;
    const pick = figure[index % figure.length]!;
    // Index 3 is the root an octave above, which is how a three-note chord gets
    // a four-note figure without borrowing a note from the next chord.
    const note = pick === 3 ? chord.notes[0] + 12 : chord.notes[pick]!;
    // Climbs an octave at pace, which lifts the whole track without a key change.
    const octave = energy > 0.75 && index % 8 >= 4 ? 12 : 0;

    voices.push({
      role: 'arp',
      type: 'square',
      frequency: frequency(note + 12 + octave),
      duration: STEP_SECONDS * 1.6,
      gain: 0.026 + energy * 0.055,
      attack: 0.008,
      // The energy cue that does the most work. Nearly closed at a standstill,
      // wide open flat out - the same notes, going from muffled to biting.
      cutoff: 900 + energy * 2600,
    });
  }

  /*
   * --- Kit -----------------------------------------------------------------
   *
   * Held back until the run is properly moving, so the menu and the first
   * seconds stay as still as they were. There was no percussion at all before,
   * which is why the only thing carrying momentum was the arpeggio - and why
   * the arpeggio had to be so busy that it became the problem.
   */
  const kit = level.running && energy > 0.15 && !resting;

  if (kit && (beatInBar === 0 || beatInBar === 8 || (phrase >= 2 && beatInBar === 6))) {
    voices.push({
      role: 'kick',
      type: 'sine',
      frequency: 190,
      sweepTo: 70,
      duration: 0.18,
      gain: 0.22,
      attack: 0.006,
    });
  }

  if (kit) {
    // Eighths, doubling to sixteenths once the run is quick. Offbeat accents
    // are louder than the beats they sit between, which is what makes it swing
    // rather than tick.
    const onHat = energy > 0.7 ? true : beatInBar % 4 === 2;
    if (onHat) {
      voices.push({
        role: 'hat',
        type: 'square',
        frequency: 0,
        duration: 0.05,
        gain: (beatInBar % 4 === 2 ? 0.05 : 0.03) * Math.min(1, energy * 1.5),
        attack: 0.001,
      });
    }
  }

  // --- Tension: a low tritone against the root when the patrol is close -----
  // Deliberately dissonant. It is a warning, not decoration.
  if (tension > 0.35 && beatInBar % 8 === 0) {
    voices.push({
      role: 'tension',
      type: 'sawtooth',
      frequency: frequency(chord.bass + 6),
      duration: STEP_SECONDS * 6,
      gain: 0.042 * tension,
      attack: 0.15,
      cutoff: 700,
    });
  }

  // --- Bell: once a phrase, not once a chord --------------------------------
  // It used to ring on every chord change, four times as often, which is how a
  // hook becomes a tic. Its note is the colour tone of whichever chord it lands
  // on, so the two phrases ring differently.
  if (beatInBar === 0 && barInPhrase === 0) {
    voices.push({
      role: 'bell',
      type: 'triangle',
      frequency: frequency(chord.colour + 12),
      duration: STEP_SECONDS * 7,
      gain: 0.075,
      attack: 0.02,
      cutoff: 3800,
    });
  }

  return voices;
}

/** Sums what one step will peak at, counting the bass's octave double. */
export function stepGain(voices: readonly Voice[]): number {
  return voices.reduce((total, voice) => {
    // `playBass` plays the note again an octave up at two thirds the level.
    const doubled = voice.role === 'bass' ? 1.66 : 1;
    return total + voice.gain * doubled;
  }, 0);
}

// --- Playback ---------------------------------------------------------------

/**
 * One buffer of white noise, reused by every hat.
 *
 * Generating it per note would allocate a fresh Float32Array several times a
 * second on the audio thread's doorstep. Cached against the context it was made
 * for, because a buffer cannot cross contexts.
 */
let noiseBuffer: AudioBuffer | null = null;
let noiseContext: AudioContext | null = null;

function sharedNoise(context: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseContext === context) return noiseBuffer;

  const frames = Math.max(1, Math.floor(context.sampleRate * 0.2));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  noiseBuffer = buffer;
  noiseContext = context;
  return buffer;
}

function playTone(context: AudioContext, bus: GainNode, voice: Voice, time: number): void {
  const osc = context.createOscillator();
  osc.type = voice.type;
  osc.frequency.setValueAtTime(voice.frequency, time);
  if (voice.sweepTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, voice.sweepTo), time + voice.duration);
  }
  if (voice.detune) osc.detune.value = voice.detune;

  const gain = context.createGain();
  const end = time + voice.duration;

  // Exponential ramps cannot touch zero, hence the tiny floor values.
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, voice.gain), time + voice.attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  let tail: AudioNode = osc;
  if (voice.cutoff !== undefined) {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = voice.cutoff;
    // Just under the resonant peak. Any higher and the sweep whistles.
    filter.Q.value = 0.8;
    osc.connect(filter);
    tail = filter;
  }

  tail.connect(gain);
  gain.connect(bus);
  osc.start(time);
  osc.stop(end + 0.03);
}

/**
 * A bass note, doubled an octave up.
 *
 * A phone speaker reproduces almost nothing below a couple of hundred hertz, so
 * a bass line played as a single low fundamental simply is not there on the
 * device the game ships on. The octave sits at two thirds of the level: on
 * headphones it reads as harmonic colour on the low note, and on a phone it is
 * the part that actually carries the line.
 */
function playBass(context: AudioContext, bus: GainNode, voice: Voice, time: number): void {
  playTone(context, bus, voice, time);
  playTone(
    context,
    bus,
    {
      ...voice,
      frequency: voice.frequency * 2,
      gain: voice.gain * 0.66,
      duration: voice.duration * 0.8,
    },
    time,
  );
}

/** A hat: a short burst of the shared noise, with everything low taken off it. */
function playHat(context: AudioContext, bus: GainNode, voice: Voice, time: number): void {
  const source = context.createBufferSource();
  source.buffer = sharedNoise(context);
  // Faster playback shortens the grain and brightens it, so one buffer can be
  // both the closed hat and, at a different rate, something more open.
  source.playbackRate.value = 1.7;

  const filter = context.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 7000;

  const gain = context.createGain();
  gain.gain.setValueAtTime(voice.gain, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + voice.duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(bus);
  source.start(time);
  source.stop(time + voice.duration + 0.02);
}

function scheduleStep(context: AudioContext, bus: GainNode, index: number, time: number): void {
  for (const voice of voicesForStep(index, intensity)) {
    if (voice.role === 'hat') playHat(context, bus, voice, time);
    else if (voice.role === 'bass') playBass(context, bus, voice, time);
    else playTone(context, bus, voice, time);
  }
}

function tick(): void {
  const output = getMusicOutput();
  if (!output) return;
  const { context, bus } = output;

  while (nextStepTime < context.currentTime + LOOKAHEAD_SECONDS) {
    // A long stall (backgrounded tab) can leave the cursor far in the past;
    // catching up note by note would dump hundreds of oscillators at once.
    if (nextStepTime < context.currentTime - 0.5) nextStepTime = context.currentTime;

    scheduleStep(context, bus, step, nextStepTime);
    nextStepTime += STEP_SECONDS;
    step++;
  }
}

/** Starts the score. Safe to call repeatedly; needs audio to be unlocked. */
export function startMusic(): void {
  if (timer || !enabled) return;

  const output = getMusicOutput();
  if (!output) return;

  nextStepTime = output.context.currentTime + 0.1;
  timer = setInterval(tick, TICK_MS);
}

export function stopMusic(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export function setMusicEnabled(value: boolean): void {
  enabled = value;
  if (value) startMusic();
  else stopMusic();
}

export function isMusicPlaying(): boolean {
  return timer !== null;
}
