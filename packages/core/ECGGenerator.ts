import {
  ECGSynParameters,
  PathologyType,
  PATHOLOGY_TYPES,
  WaveParameters,
  validateHeartRate,
  validateParams,
  validateSamplingRate,
} from './models/types.js';
import { getPathologyParams } from './models/pathologies.js';
import { ECGSynth, RenderResult } from './models/synth.js';
import { LeadName, STANDARD_LEADS, deriveLimbLead, isLeadName, requiredBaseLeads } from './models/leads.js';
import { NoiseOptions, validateNoise } from './models/noise.js';
import { RandomSource, RandomStreams, gaussian } from './math/random.js';

export type { PathologyType } from './models/types.js';
export type { NoiseOptions } from './models/noise.js';
export type { LeadName } from './models/leads.js';

/**
 * Options for ECG generation.
 *
 * Parameter precedence: preset(pathology) -> `heartRate` (overrides the
 * preset's typical rate when given) -> `variation` (random jitter of the
 * resolved preset waves) -> `customParams` (only the fields provided).
 */
export interface ECGGeneratorOptions {
  /** Hz, >= 250 (default: the generator's sampling rate) */
  samplingRate?: number;
  /** seconds, > 0 (default 10; for streams: undefined or Infinity = endless) */
  duration?: number;
  /** mean ventricular rate in bpm, 20..300 (default: the pathology's typical rate) */
  heartRate?: number;
  pathology?: PathologyType;
  noise?: NoiseOptions;
  customParams?: Partial<ECGSynParameters>;
  /** ODE solver tolerance (absolute and relative; default 1e-6, lower = more accurate) */
  solverTolerance?: number;
  /**
   * 0..1 (default 0): "biological" variation. Jitters the resolved preset
   * wave amplitudes (+-15 %·v SD), widths (+-10 %·v) and positions once per
   * generation, and adds heart-rate variability to sinus rhythms.
   */
  variation?: number;
  /** Makes all randomness (variation, noise, AF RR intervals, f-waves) reproducible. */
  seed?: number;
}

/** Result of ECG generation (one lead). */
export interface ECGResult {
  /** time[i] = i / samplingRate (for streams: global sample index / samplingRate) */
  time: number[];
  /** mV */
  signal: number[];
  samplingRate: number;
  metadata: {
    duration: number;
    /** actual mean ventricular rate of the generated beats (bpm) */
    heartRate: number;
    pathology: PathologyType;
    noise: NoiseOptions | undefined;
  };
}

const WAVE_KEYS = ['P', 'Q', 'R', 'S', 'T'] as const;

interface ResolvedOptions {
  samplingRate: number;
  duration: number | undefined;
  pathology: PathologyType;
  noise: NoiseOptions | undefined;
  tolerance: number;
  variation: number;
  streams: RandomStreams;
  params: ECGSynParameters;
}

function clampedGaussian(rng: RandomSource): number {
  return Math.max(-2, Math.min(2, gaussian(rng)));
}

function jitterWave(w: WaveParameters, v: number, rng: RandomSource, moveCenter: boolean): WaveParameters {
  const a = clampedGaussian(rng), b = clampedGaussian(rng), c = clampedGaussian(rng);
  return {
    amplitude: w.amplitude * (1 + 0.15 * v * a),
    width: w.width * Math.exp(0.1 * v * b),
    position: moveCenter ? w.position + 0.04 * v * c : w.position,
  };
}

/** Apply random biological variation (0..1) to a resolved parameter set (returns a copy). */
function applyVariation(p: ECGSynParameters, v: number, rng: RandomSource): ECGSynParameters {
  const out: ECGSynParameters = {
    ...p,
    P: jitterWave(p.P, v, rng, true),
    Q: jitterWave(p.Q, v, rng, true),
    R: jitterWave(p.R, v, rng, false),
    S: jitterWave(p.S, v, rng, true),
    T: jitterWave(p.T, v, rng, true),
  };
  if (p.extraWaves) out.extraWaves = p.extraWaves.map(w => jitterWave(w, v, rng, true));
  return out;
}

function applyCustom(p: ECGSynParameters, custom: Partial<ECGSynParameters>): ECGSynParameters {
  const out: ECGSynParameters = { ...p };
  for (const k of WAVE_KEYS) {
    const w = custom[k];
    if (w !== undefined) out[k] = { ...p[k], ...w };
  }
  if (custom.heartRate !== undefined) out.heartRate = custom.heartRate;
  if (custom.respiratoryRate !== undefined) out.respiratoryRate = custom.respiratoryRate;
  if (custom.respiratoryAmplitude !== undefined) out.respiratoryAmplitude = custom.respiratoryAmplitude;
  if (custom.extraWaves !== undefined) {
    if (!Array.isArray(custom.extraWaves)) throw new Error('Invalid customParams: extraWaves must be an array');
    out.extraWaves = custom.extraWaves.map(w => ({ ...w }));
  }
  return out;
}

/**
 * High-level ECG generator.
 */
export class ECGGenerator {
  private samplingRate: number;

  constructor(samplingRate: number = 1000) {
    validateSamplingRate(samplingRate);
    this.samplingRate = samplingRate;
  }

  /** @param streaming  true for generateStream: undefined or Infinity duration means endless */
  private resolve(options: ECGGeneratorOptions, streaming: boolean): ResolvedOptions {
    if (options === null || typeof options !== 'object') throw new Error('ECG options must be an object');
    const samplingRate = options.samplingRate ?? this.samplingRate;
    validateSamplingRate(samplingRate);
    let duration = options.duration;
    if (streaming && duration === Infinity) duration = undefined;
    if (duration === undefined && !streaming) duration = 10;
    if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) {
      throw new Error(`Invalid duration: must be a finite number > 0 seconds (got ${duration})`);
    }
    const pathology = options.pathology ?? 'normal';
    if (!(PATHOLOGY_TYPES as readonly string[]).includes(pathology)) {
      throw new Error(`Unknown pathology "${pathology}". Supported: ${PATHOLOGY_TYPES.join(', ')}`);
    }
    if (options.heartRate !== undefined) validateHeartRate(options.heartRate);
    const tolerance = options.solverTolerance ?? 1e-6;
    if (!Number.isFinite(tolerance) || tolerance <= 0) {
      throw new Error(`Invalid solverTolerance: must be a finite number > 0 (got ${tolerance})`);
    }
    const variation = options.variation ?? 0;
    if (!Number.isFinite(variation) || variation < 0 || variation > 1) {
      throw new Error(`Invalid variation: must be a number between 0 and 1 (got ${variation})`);
    }
    validateNoise(options.noise, samplingRate);
    const streams = new RandomStreams(options.seed);

    let params = getPathologyParams(pathology, options.heartRate);
    if (variation > 0) params = applyVariation(params, variation, streams.stream('variation'));
    if (options.customParams !== undefined) {
      if (options.customParams === null || typeof options.customParams !== 'object') {
        throw new Error('Invalid customParams: expected an object');
      }
      params = applyCustom(params, options.customParams);
    }
    validateParams(params);
    return { samplingRate, duration, pathology, noise: options.noise, tolerance, variation, streams, params };
  }

  /**
   * The fully resolved model parameters `generate(options)` would use
   * (preset -> heartRate -> variation -> customParams). Pass a `seed` to get
   * the same variation as a subsequent generate call with that seed.
   */
  resolveParams(options: ECGGeneratorOptions = {}): ECGSynParameters {
    return this.resolve(options, false).params;
  }

  private createSynth(r: ResolvedOptions, leads: readonly LeadName[]): ECGSynth {
    return new ECGSynth({
      params: r.params,
      pathology: r.pathology,
      samplingRate: r.samplingRate,
      tolerance: r.tolerance,
      leads: requiredBaseLeads(leads),
      noise: r.noise,
      variation: r.variation,
      streams: r.streams,
    });
  }

  private toResults(
    r: ResolvedOptions,
    rendered: RenderResult,
    leads: readonly LeadName[],
    duration: number
  ): { [lead: string]: ECGResult } {
    const base = rendered.leads;
    const out: { [lead: string]: ECGResult } = {};
    const metadata = {
      duration,
      heartRate: rendered.meanHeartRate,
      pathology: r.pathology,
      noise: r.noise,
    };
    leads.forEach((lead, i) => {
      let signal: number[];
      if (lead === 'III' || lead === 'aVR' || lead === 'aVL' || lead === 'aVF') {
        signal = deriveLimbLead(lead, base.get('I') as number[], base.get('II') as number[]);
      } else {
        signal = base.get(lead) as number[];
      }
      out[lead] = {
        // every lead gets its own time array, so mutating one never affects another
        time: i === 0 ? rendered.time : rendered.time.slice(),
        signal,
        samplingRate: r.samplingRate,
        metadata: { ...metadata },
      };
    });
    return out;
  }

  /**
   * Generate a lead-II ECG.
   */
  generate(options: ECGGeneratorOptions = {}): ECGResult {
    const r = this.resolve(options, false);
    const duration = r.duration as number;
    const synth = this.createSynth(r, ['II']);
    const rendered = synth.render(Math.round(duration * r.samplingRate));
    return this.toResults(r, rendered, ['II'], duration)['II'];
  }

  /**
   * Generate several leads of the same recording (same rhythm and beat
   * timing). Leads I, II and V1-V6 are synthesised with lead-specific wave
   * amplitudes; III, aVR, aVL and aVF are derived exactly
   * (III = II - I, aVR = -(I + II)/2, aVL = I - II/2, aVF = II - I/2).
   * Noise is independent per lead (limb-lead noise follows the same identities).
   */
  generateMultiLead(
    options: ECGGeneratorOptions = {},
    leads: string[] = [...STANDARD_LEADS]
  ): { [lead: string]: ECGResult } {
    if (!Array.isArray(leads) || leads.length === 0) {
      throw new Error('generateMultiLead: leads must be a non-empty array of lead names');
    }
    for (const l of leads) {
      if (!isLeadName(l)) {
        throw new Error(`Unknown lead "${l}". Supported: ${STANDARD_LEADS.join(', ')}`);
      }
    }
    const leadNames = leads as LeadName[];
    const r = this.resolve(options, false);
    const duration = r.duration as number;
    const synth = this.createSynth(r, leadNames);
    const rendered = synth.render(Math.round(duration * r.samplingRate));
    return this.toResults(r, rendered, leadNames, duration);
  }

  /**
   * Continuous stream of lead-II ECG chunks of `chunkDuration` seconds.
   * Model state, rhythm and noise carry across chunks, so the concatenation
   * of chunks is one seamless recording; chunk k starts at global sample
   * round(k * chunkDuration * fs) and time values never overlap.
   * With `options.duration` undefined (or Infinity) the stream is endless.
   * Options are validated eagerly: invalid input throws from this call, not
   * from the first `next()`.
   */
  generateStream(
    options: ECGGeneratorOptions = {},
    chunkDuration: number = 1
  ): Generator<ECGResult, void, unknown> {
    if (typeof chunkDuration !== 'number' || !Number.isFinite(chunkDuration) || chunkDuration <= 0) {
      throw new Error(`Invalid chunkDuration: must be a finite number > 0 seconds (got ${chunkDuration})`);
    }
    const r = this.resolve(options, true);
    const synth = this.createSynth(r, ['II']);
    return this.streamChunks(r, synth, chunkDuration);
  }

  private *streamChunks(r: ResolvedOptions, synth: ECGSynth, chunkDuration: number): Generator<ECGResult, void, unknown> {
    const fs = r.samplingRate;
    const total = r.duration === undefined ? Infinity : Math.round(r.duration * fs);
    let emitted = 0;
    for (let k = 0; emitted < total; k++) {
      const end = Math.min(total, Math.round((k + 1) * chunkDuration * fs));
      const n = end - emitted;
      if (n <= 0) continue;
      const rendered = synth.render(n);
      emitted = end;
      yield this.toResults(r, rendered, ['II'], n / fs)['II'];
    }
  }
}
