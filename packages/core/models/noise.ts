/**
 * Stateful, phase-continuous noise and fibrillatory-wave sources.
 * Each source is evaluated sample by sample in time order, so rendering in
 * chunks gives the same result as rendering at once.
 */

import { RandomSource, gaussian } from '../math/random.js';
import { FilterChain, bandpassChain } from '../math/filters.js';

/** Noise types that can be added to the ECG. All amplitudes in mV. */
export interface NoiseOptions {
  /** Sinusoidal baseline wander (peak amplitude, frequency in Hz, typically 0.05-0.5 Hz). */
  baseline?: {
    amplitude: number;
    frequency: number;
  };
  /** Powerline interference (peak amplitude). */
  powerline?: {
    amplitude: number;
    frequency: 50 | 60;
  };
  /** EMG / muscle noise: band-limited (20-150 Hz, below Nyquist) Gaussian noise, RMS amplitude. */
  muscle?: {
    amplitude: number;
  };
  /** White Gaussian noise, standard deviation. */
  gaussian?: {
    amplitude: number;
  };
}

function checkNonNegative(name: string, v: unknown): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new Error(`Invalid noise options: ${name} must be a finite number >= 0 (got ${String(v)})`);
  }
}

function checkPositive(name: string, v: unknown): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new Error(`Invalid noise options: ${name} must be a finite number > 0 (got ${String(v)})`);
  }
}

export function validateNoise(noise: NoiseOptions | undefined, samplingRate: number): void {
  if (noise === undefined) return;
  if (noise === null || typeof noise !== 'object') throw new Error('Invalid noise options: expected an object');
  if (noise.baseline) {
    checkNonNegative('baseline.amplitude', noise.baseline.amplitude);
    checkPositive('baseline.frequency', noise.baseline.frequency);
  }
  if (noise.powerline) {
    checkNonNegative('powerline.amplitude', noise.powerline.amplitude);
    checkPositive('powerline.frequency', noise.powerline.frequency);
    if (noise.powerline.frequency >= samplingRate / 2) {
      throw new Error(`Invalid noise options: powerline.frequency must be below Nyquist (${samplingRate / 2} Hz)`);
    }
  }
  if (noise.muscle) checkNonNegative('muscle.amplitude', noise.muscle.amplitude);
  if (noise.gaussian) checkNonNegative('gaussian.amplitude', noise.gaussian.amplitude);
}

/** Noise source for one lead. */
export class LeadNoise {
  private readonly baselineGain: number;
  private readonly baselinePhase: number;
  private readonly powerGain: number;
  private readonly powerPhase: number;
  private readonly muscleFilter?: FilterChain;
  private readonly muscleScale: number = 0;

  constructor(private readonly opts: NoiseOptions, samplingRate: number, private readonly rng: RandomSource) {
    // per-lead coupling differs (electrode position / impedance)
    this.baselineGain = 0.7 + 0.6 * rng();
    this.baselinePhase = 2 * Math.PI * rng();
    this.powerGain = 0.7 + 0.6 * rng();
    this.powerPhase = 2 * Math.PI * rng();
    if (opts.muscle && opts.muscle.amplitude > 0) {
      this.muscleFilter = bandpassChain(20, 150, samplingRate);
      this.muscleScale = opts.muscle.amplitude / this.muscleFilter.whiteNoiseGain();
    }
  }

  /** Noise value at absolute time t (s); must be called in sample order. */
  next(t: number): number {
    const o = this.opts;
    let v = 0;
    if (o.baseline) v += o.baseline.amplitude * this.baselineGain * Math.sin(2 * Math.PI * o.baseline.frequency * t + this.baselinePhase);
    if (o.powerline) v += o.powerline.amplitude * this.powerGain * Math.sin(2 * Math.PI * o.powerline.frequency * t + this.powerPhase);
    if (this.muscleFilter) v += this.muscleScale * this.muscleFilter.process(gaussian(this.rng));
    if (o.gaussian && o.gaussian.amplitude > 0) v += o.gaussian.amplitude * gaussian(this.rng);
    return v;
  }
}

/**
 * Atrial-fibrillation f-waves: a phase-continuous quasi-periodic oscillation
 * at ~4.8-7.2 Hz (290-430 per minute) with slowly varying frequency and
 * amplitude (source amplitude ~0.08 mV, scaled per lead), plus a weak second
 * harmonic.
 */
export class FibrillatoryWaves {
  private phase: number;
  private lastT: number | undefined;
  private readonly ph: number[];

  constructor(rng: RandomSource, private readonly amplitude: number = 0.08, private readonly meanFrequency: number = 6) {
    this.phase = 2 * Math.PI * rng();
    this.ph = [0, 1, 2, 3, 4].map(() => 2 * Math.PI * rng());
  }

  frequencyAt(t: number): number {
    return this.meanFrequency
      + 0.8 * Math.sin(2 * Math.PI * 0.05 * t + this.ph[0])
      + 0.4 * Math.sin(2 * Math.PI * 0.13 * t + this.ph[1]);
  }

  /** f-wave value at absolute time t; must be called in increasing time order. */
  next(t: number): number {
    if (this.lastT !== undefined) {
      const dt = t - this.lastT;
      // midpoint rule for the phase integral of the instantaneous frequency
      this.phase += 2 * Math.PI * this.frequencyAt(t - dt / 2) * dt;
      if (this.phase > 1e6) this.phase %= 2 * Math.PI;
    }
    this.lastT = t;
    const env = 1 + 0.3 * Math.sin(2 * Math.PI * 0.15 * t + this.ph[2]) + 0.15 * Math.sin(2 * Math.PI * 0.4 * t + this.ph[3]);
    return this.amplitude * env * (Math.sin(this.phase) + 0.15 * Math.sin(2 * this.phase + this.ph[4]));
  }
}
