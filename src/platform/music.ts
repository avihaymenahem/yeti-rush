/**
 * The score, synthesised at runtime.
 *
 * No audio files. A three-minute loop would be around 3 MB against a 6 MB app,
 * and it would play the same whatever is happening on screen. This is a few
 * kilobytes of code, needs no licence, and - the actual reason - it can react:
 * the arpeggio thickens as the run speeds up, and the harmony darkens when the
 * ski patrol closes in. The player hears the danger before they turn to look.
 *
 * Scheduling uses the standard Web Audio lookahead pattern: a coarse timer
 * wakes up often enough to queue the next fraction of a second of notes at
 * *sample-accurate* times. Firing notes directly from a timer would put every
 * one of them a few milliseconds late and the result would audibly stagger.
 */

import { getMusicOutput } from '@/platform/audio';

/** Beats per minute. Unhurried - the speed comes from the arpeggio, not tempo. */
const BPM = 96;
/** Sixteenth notes per bar. */
const STEPS_PER_BAR = 16;
const STEP_SECONDS = 60 / BPM / 4;

/** How far ahead notes are queued, and how often the scheduler wakes. */
const LOOKAHEAD_SECONDS = 0.16;
const TICK_MS = 40;

/**
 * A wistful, wide progression - Am, F, C, G. Two bars each, so the harmony
 * turns over slowly enough to sit under a run without demanding attention.
 *
 * Offsets are semitones from A3 (220 Hz).
 *
 * The bass sits an octave below the pad and no lower. It was written two
 * octaves down, which put the root notes at 33-55 Hz: correct on paper, and
 * completely silent through a phone speaker, which has no output at all down
 * there. Everything the player is actually meant to hear now lives above
 * 65 Hz, and `playBass` doubles each note an octave up so the line survives a
 * speaker the size of a fingernail.
 */
const PROGRESSION = [
  { bass: -12, notes: [0, 3, 7], colour: 14 }, // Am
  { bass: -16, notes: [-4, 0, 3], colour: 12 }, // F
  { bass: -21, notes: [-9, -5, -2], colour: 7 }, // C
  { bass: -14, notes: [-2, 2, 5], colour: 9 }, // G
] as const;

const BARS_PER_CHORD = 2;

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

interface Voice {
  type: OscillatorType;
  frequency: number;
  time: number;
  duration: number;
  gain: number;
  /** Seconds of fade-in. Long attacks make a pad; short ones make a pluck. */
  attack: number;
  detune?: number;
}

function playVoice(context: AudioContext, bus: GainNode, voice: Voice): void {
  const osc = context.createOscillator();
  osc.type = voice.type;
  osc.frequency.value = voice.frequency;
  if (voice.detune) osc.detune.value = voice.detune;

  const gain = context.createGain();
  const end = voice.time + voice.duration;

  // Exponential ramps cannot touch zero, hence the tiny floor values.
  gain.gain.setValueAtTime(0.0001, voice.time);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, voice.gain), voice.time + voice.attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(gain);
  gain.connect(bus);
  osc.start(voice.time);
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
function playBass(context: AudioContext, bus: GainNode, voice: Voice): void {
  playVoice(context, bus, voice);
  playVoice(context, bus, {
    ...voice,
    frequency: voice.frequency * 2,
    gain: voice.gain * 0.66,
    duration: voice.duration * 0.8,
  });
}

/**
 * Queues everything that falls on one sixteenth-note step.
 *
 * Gain budget: on the one step where every layer can sound at once - the
 * downbeat of a chord change, at full energy, with the patrol closing - the
 * voices below sum to roughly 1.05. Through the 0.95 music bus and the 0.35
 * master that peaks around 0.35, which leaves a crash room to land on top
 * without clipping. Raise anything here and check that sum still holds.
 */
function scheduleStep(context: AudioContext, bus: GainNode, index: number, time: number): void {
  const bar = Math.floor(index / STEPS_PER_BAR);
  const beatInBar = index % STEPS_PER_BAR;
  const chord = PROGRESSION[Math.floor(bar / BARS_PER_CHORD) % PROGRESSION.length]!;

  // On the menus the score idles: pad and a little bass, nothing driving.
  const energy = intensity.running ? intensity.energy : 0;
  const tension = intensity.running ? intensity.tension : 0;

  // --- Pad: one long swell per bar ---------------------------------------
  if (beatInBar === 0) {
    const barSeconds = STEP_SECONDS * STEPS_PER_BAR;
    for (const note of chord.notes) {
      playVoice(context, bus, {
        type: 'sine',
        frequency: frequency(note),
        time,
        duration: barSeconds * 0.98,
        gain: 0.085 + energy * 0.03,
        attack: barSeconds * 0.35,
        // A little detune between the voices gives the pad width without a
        // second oscillator per note.
        detune: (note % 3) * 4 - 4,
      });
    }
  }

  // --- Bass: on the beat, harder as the run builds ------------------------
  if (beatInBar % 4 === 0) {
    const accent = beatInBar === 0 ? 1 : 0.72;
    playBass(context, bus, {
      type: 'triangle',
      frequency: frequency(chord.bass),
      time,
      duration: STEP_SECONDS * 3.2,
      gain: (0.2 + energy * 0.1) * accent,
      attack: 0.012,
    });
  }

  // --- Arpeggio: the layer that carries the speed -------------------------
  // Sparse eighths when cruising, full sixteenths flat out, so acceleration is
  // something you hear as well as see.
  const sixteenths = energy > 0.55;
  const onArpStep = sixteenths ? true : beatInBar % 2 === 0;

  if (intensity.running && onArpStep) {
    const pattern = [0, 1, 2, 1];
    const note = chord.notes[pattern[index % pattern.length]!]!;
    // Climbs an octave at pace, which lifts the whole track without a key change.
    const octave = energy > 0.75 && index % 8 >= 4 ? 12 : 0;

    playVoice(context, bus, {
      type: 'square',
      frequency: frequency(note + 12 + octave),
      time,
      duration: STEP_SECONDS * 1.6,
      gain: 0.028 + energy * 0.06,
      attack: 0.008,
    });
  }

  // --- Tension: a low tritone against the root when the patrol is close ----
  // Deliberately dissonant. It is a warning, not decoration.
  if (tension > 0.35 && beatInBar % 8 === 0) {
    playVoice(context, bus, {
      type: 'sawtooth',
      frequency: frequency(chord.bass + 6),
      time,
      duration: STEP_SECONDS * 6,
      gain: 0.042 * tension,
      attack: 0.15,
    });
  }

  // --- Lead: a single bell on each chord change ---------------------------
  if (beatInBar === 0 && bar % BARS_PER_CHORD === 0) {
    playVoice(context, bus, {
      type: 'triangle',
      frequency: frequency(chord.colour + 12),
      time,
      duration: STEP_SECONDS * 7,
      gain: 0.075,
      attack: 0.02,
    });
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
