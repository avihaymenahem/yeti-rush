/** Small numeric helpers shared by the simulation. Allocation-free. */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth ease-in-out on [0, 1]. Zero derivative at both ends. */
export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** Ease-out quadratic on [0, 1]: fast start, gentle settle. */
export function easeOutQuad(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
}

/**
 * Frame-rate independent exponential approach.
 * `smoothing` is the fraction of the remaining gap left after one second.
 */
export function damp(current: number, target: number, smoothing: number, dt: number): number {
  return lerp(target, current, Math.pow(smoothing, dt));
}
