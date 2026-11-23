/**
 * ECGSYN-style dynamical ECG model (McSharry et al., IEEE TBME 2003), with:
 * - true-mV wave amplitudes (Gaussian-derivative term scaled by a / b^2),
 * - a restoring term that keeps the isoelectric line at 0 mV from sample 0,
 * - rate-aware wave placement (constant QRS, mildly rate-dependent PR,
 *   Fridericia-corrected QT),
 * - per-beat RR intervals (HRV, atrial fibrillation, AV dissociation).
 *
 * See models/synth.ts for the equations and models/rate.ts for the mapping.
 */

import { ECGSynParameters, validateParams, validateSamplingRate } from './types.js';
import { getPathologyParams } from './pathologies.js';
import { ECGSynth } from './synth.js';
import { RandomStreams } from '../math/random.js';

export type { ECGSynParameters, WaveParameters, PathologyType } from './types.js';
export { PATHOLOGY_PARAMS, PATHOLOGY_DEFAULT_HEART_RATE, getPathologyParams } from './pathologies.js';
export { ecgsynODE } from './synth.js';

/**
 * Default parameters (normal sinus rhythm, lead II, 70 bpm):
 * P 0.15 mV, PR ~150 ms, QRS ~87 ms, R 1.2 mV, T 0.3 mV, QTc 400 ms.
 */
export const DEFAULT_ECGSYN_PARAMS: ECGSynParameters = getPathologyParams('normal');

/**
 * Generate a clean lead-II ECG with a regular rhythm at `params.heartRate`.
 * Returns `Math.round(duration * samplingRate)` samples with time[i] = i / samplingRate.
 */
export function generateECGSyn(
  duration: number,
  samplingRate: number,
  params: ECGSynParameters = DEFAULT_ECGSYN_PARAMS,
  tolerance: number = 1e-6
): { time: number[]; ecg: number[] } {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Invalid duration: must be a finite number > 0 seconds (got ${duration})`);
  }
  validateSamplingRate(samplingRate);
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new Error(`Invalid solver tolerance: must be a finite number > 0 (got ${tolerance})`);
  }
  validateParams(params);
  const synth = new ECGSynth({
    params,
    pathology: 'normal',
    samplingRate,
    tolerance,
    leads: ['II'],
    variation: 0,
    streams: new RandomStreams(0),
    rhythm: { kind: 'sinus' },
  });
  const r = synth.render(Math.round(duration * samplingRate));
  return { time: r.time, ecg: r.leads.get('II') as number[] };
}
