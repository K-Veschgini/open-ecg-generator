/**
 * Optional physiological refinements that operate on the real
 * ECGSynParameters type. Every function returns deep copies and never
 * mutates its input.
 */

import { ECGSynParameters, cloneParams, waveMs, SECONDS_PER_RADIAN } from '../models/types.js';
import { RandomSource, gaussian } from '../math/random.js';
import { bandpassChain } from '../math/filters.js';

// ---------------------------------------------------------------------------
// Heart-rate variability
// ---------------------------------------------------------------------------

export interface HRVParams {
  /** Breathing rate driving respiratory sinus arrhythmia (breaths/min, default 15). */
  respiratoryRate?: number;
  /** RSA (HF) modulation depth as a fraction of RR (default 0.03). */
  hfAmplitude?: number;
  /** Mayer-wave (LF, ~0.1 Hz) modulation depth as a fraction of RR (default 0.025). */
  lfAmplitude?: number;
  /** LF centre frequency in Hz (default 0.1). */
  lfFrequency?: number;
  /** Standard deviation of the slow random-walk (VLF) component as a fraction of RR (default 0.015). */
  walkStd?: number;
  /** Beat-to-beat correlation of the random-walk component, 0..1 (default 0.95). */
  walkCorrelation?: number;
}

/**
 * Beat-by-beat RR-interval generator with respiratory sinus arrhythmia (HF),
 * a ~0.1 Hz LF component and a correlated (AR(1)) random walk. Stateful, so
 * consecutive calls produce one continuous RR sequence.
 */
export class HRVGenerator {
  private time = 0;
  private walk = 0;
  private readonly hfPhase: number;
  private readonly lfPhase: number;
  private readonly p: Required<HRVParams>;

  constructor(private readonly rng: RandomSource = Math.random, params: HRVParams = {}) {
    this.p = {
      respiratoryRate: params.respiratoryRate ?? 15,
      hfAmplitude: params.hfAmplitude ?? 0.03,
      lfAmplitude: params.lfAmplitude ?? 0.025,
      lfFrequency: params.lfFrequency ?? 0.1,
      walkStd: params.walkStd ?? 0.015,
      walkCorrelation: Math.min(0.999, Math.max(0, params.walkCorrelation ?? 0.95)),
    };
    this.hfPhase = rng() * 2 * Math.PI;
    this.lfPhase = rng() * 2 * Math.PI;
  }

  /**
   * Next RR interval (s) around `baseRR`; `scale` (0..1+) scales the depth of
   * all variability components. The result is never below 0.5 * baseRR.
   */
  nextRR(baseRR: number, scale: number = 1): number {
    const { respiratoryRate, hfAmplitude, lfAmplitude, lfFrequency, walkStd, walkCorrelation } = this.p;
    const rho = walkCorrelation;
    this.walk = rho * this.walk + Math.sqrt(1 - rho * rho) * walkStd * gaussian(this.rng);
    const hf = hfAmplitude * Math.sin(2 * Math.PI * (respiratoryRate / 60) * this.time + this.hfPhase);
    const lf = lfAmplitude * Math.sin(2 * Math.PI * lfFrequency * this.time + this.lfPhase);
    const rr = Math.max(0.5 * baseRR, baseRR * (1 + scale * (hf + lf + this.walk)));
    this.time += rr;
    return rr;
  }

  /** RR intervals (s) whose sum just covers `duration` seconds. */
  generateRRIntervals(baseRR: number, duration: number, scale: number = 1): number[] {
    if (!(baseRR > 0) || !Number.isFinite(baseRR)) throw new Error(`HRVGenerator: baseRR must be > 0 (got ${baseRR})`);
    if (!(duration >= 0) || !Number.isFinite(duration)) throw new Error(`HRVGenerator: duration must be >= 0 (got ${duration})`);
    const out: number[] = [];
    let total = 0;
    while (total < duration) {
      const rr = this.nextRR(baseRR, scale);
      out.push(rr);
      total += rr;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// QT correction
// ---------------------------------------------------------------------------

/** QT-interval rate correction formulas (times in seconds). */
export class QTCorrection {
  /** Bazett: QTc = QT / sqrt(RR) */
  static bazett(qt: number, rr: number): number {
    return qt / Math.sqrt(rr);
  }

  /** Fridericia: QTc = QT / cbrt(RR) */
  static fridericia(qt: number, rr: number): number {
    return qt / Math.cbrt(rr);
  }

  /** Framingham: QTc = QT + 0.154 (1 - RR) */
  static framingham(qt: number, rr: number): number {
    return qt + 0.154 * (1 - rr);
  }

  /** Expected QT for a given QTc and RR according to Fridericia: QT = QTc * cbrt(RR). */
  static fridericiaQT(qtc: number, rr: number): number {
    return qtc * Math.cbrt(rr);
  }

  /** Expected QT (s) at RR (s) for a normal QTc (default 0.42 s). */
  static calculateQT(
    rr: number,
    method: 'bazett' | 'fridericia' | 'framingham' = 'bazett',
    qtc: number = 0.42
  ): number {
    switch (method) {
      case 'bazett':
        return qtc * Math.sqrt(rr);
      case 'fridericia':
        return qtc * Math.cbrt(rr);
      case 'framingham':
        return qtc - 0.154 * (1 - rr);
    }
  }
}

// ---------------------------------------------------------------------------
// Single-dipole lead projections
// ---------------------------------------------------------------------------

/**
 * Simple single-dipole projection of a cardiac vector onto the 12 leads.
 * Limb leads use their frontal-plane angles (hexaxial system), precordial
 * leads their transverse-plane angles (0 deg = patient's left, 90 deg =
 * anterior). Returns cos(axis - leadAngle) per lead and wave.
 */
export class LeadMorphology {
  static readonly FRONTAL_ANGLES: Readonly<Record<string, number>> = {
    I: 0, II: 60, III: 120, aVR: -150, aVL: -30, aVF: 90,
  };

  static readonly TRANSVERSE_ANGLES: Readonly<Record<string, number>> = {
    V1: 120, V2: 90, V3: 75, V4: 60, V5: 30, V6: 0,
  };

  /**
   * @param frontalAxis    mean QRS axis in the frontal plane (deg, normal ~ +60)
   * @param transverseAxis mean QRS axis in the transverse plane (deg, normal ~ -20, i.e. leftward, slightly posterior)
   * @param tOffset        angle between the T and QRS axes (deg, normal < 45)
   */
  static calculateLeadVectors(
    frontalAxis: number = 60,
    transverseAxis: number = -20,
    tOffset: number = -15
  ): Record<string, { p: number; qrs: number; t: number }> {
    const rad = Math.PI / 180;
    const out: Record<string, { p: number; qrs: number; t: number }> = {};
    for (const [lead, angle] of Object.entries(LeadMorphology.FRONTAL_ANGLES)) {
      out[lead] = {
        p: Math.cos((60 - angle) * rad), // normal P axis ~ +60 deg
        qrs: Math.cos((frontalAxis - angle) * rad),
        t: Math.cos((frontalAxis + tOffset - angle) * rad),
      };
    }
    for (const [lead, angle] of Object.entries(LeadMorphology.TRANSVERSE_ANGLES)) {
      out[lead] = {
        p: Math.cos((45 - angle) * rad),
        qrs: Math.cos((transverseAxis - angle) * rad),
        t: Math.cos((transverseAxis + 60 - angle) * rad), // T vector is more anterior than QRS
      };
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

function sampleCount(duration: number, samplingRate: number): number {
  if (!(duration >= 0) || !Number.isFinite(duration)) throw new Error(`duration must be >= 0 (got ${duration})`);
  if (!(samplingRate > 0) || !Number.isFinite(samplingRate)) throw new Error(`samplingRate must be > 0 (got ${samplingRate})`);
  return Math.round(duration * samplingRate);
}

/** Stand-alone artifact signals (mV), one value per sample. */
export class ArtifactGenerator {
  /**
   * Electrode-motion artifact: slowly decaying random walk with occasional
   * step-like jumps (electrode pops) that relax back to baseline.
   */
  static electrodeMotion(duration: number, samplingRate: number, rng: RandomSource = Math.random, amplitude: number = 0.1): number[] {
    const n = sampleCount(duration, samplingRate);
    const out = new Array<number>(n);
    const decay = Math.exp(-1 / (0.5 * samplingRate)); // 0.5 s relaxation
    const stepStd = amplitude * Math.sqrt(1 - decay * decay);
    const popRate = 0.2 / samplingRate; // ~one pop per 5 s
    let current = 0;
    for (let i = 0; i < n; i++) {
      current = current * decay + stepStd * gaussian(rng);
      if (rng() < popRate) current += amplitude * 3 * (rng() - 0.5);
      out[i] = current;
    }
    return out;
  }

  /** Physiological tremor: band-limited (4-12 Hz) Gaussian noise with RMS `intensity` mV. */
  static muscleTremor(duration: number, samplingRate: number, intensity: number = 0.05, rng: RandomSource = Math.random): number[] {
    const n = sampleCount(duration, samplingRate);
    const chain = bandpassChain(4, 12, samplingRate);
    const gain = chain.whiteNoiseGain();
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = (intensity / gain) * chain.process(gaussian(rng));
    return out;
  }
}

// ---------------------------------------------------------------------------
// Parameter transforms
// ---------------------------------------------------------------------------

export interface DemographicParams {
  age: number;
  gender: 'male' | 'female';
}

/** Approximate J point of a parameter set (radians at the 60-bpm reference). */
function jPointRad(p: ECGSynParameters): number {
  return Math.max(p.R.position + 2.45 * p.R.width, p.S.position + 2.45 * p.S.width);
}

export class DemographicAdjustments {
  /**
   * Deterministic age/sex adjustments: neonates and children have faster
   * rates, shorter PR and narrower QRS; the elderly slightly longer PR/QRS
   * and lower voltages; women a slightly longer QT, lower QRS voltage and a
   * marginally higher rate.
   */
  static adjustParameters(baseParams: ECGSynParameters, demographics: DemographicParams): ECGSynParameters {
    const p = cloneParams(baseParams);
    const scaleQRS = (f: number) => {
      for (const w of [p.Q, p.R, p.S]) {
        w.width *= f;
        w.position *= f;
      }
    };
    const { age, gender } = demographics;
    if (!Number.isFinite(age) || age < 0) throw new Error(`DemographicAdjustments: invalid age ${age}`);
    if (age < 1) {
      p.heartRate = 140;
      p.P.position *= 0.7;
      scaleQRS(0.75);
    } else if (age < 10) {
      p.heartRate = 95;
      p.P.position *= 0.85;
      scaleQRS(0.85);
    } else if (age > 65) {
      p.P.position *= 1.1;
      scaleQRS(1.05);
      p.P.amplitude *= 0.9;
      p.R.amplitude *= 0.9;
    }
    if (gender === 'female') {
      const j = jPointRad(p);
      p.T.position = j + (p.T.position - j) * 1.04; // ~3 % longer QT
      p.Q.amplitude *= 0.85;
      p.R.amplitude *= 0.85;
      p.S.amplitude *= 0.85;
      p.heartRate += 3;
    }
    return p;
  }
}

export class PathologyProgression {
  /**
   * Gradual onset of transmural ischaemia (0 = none, 1 = established STEMI):
   * hyperacute T waves first, then ST elevation (appended as one extra
   * wave of up to 0.3 mV after the J point), and in the later stage loss of
   * R amplitude with a pathological Q wave. `baseParams` should not already
   * contain an ischaemic ST wave.
   */
  static simulateIschemiaProgression(timePoint: number, baseParams: ECGSynParameters): ECGSynParameters {
    const tp = Math.min(1, Math.max(0, timePoint));
    const p = cloneParams(baseParams);
    p.T.amplitude *= 1 + 0.8 * Math.min(1, tp * 2);
    p.T.width *= 1 + 0.15 * tp;
    const jMs = jPointRad(p) * SECONDS_PER_RADIAN * 1000;
    const st = waveMs(0.3 * tp, jMs + 70, 42);
    if (st.amplitude !== 0) p.extraWaves = [...(p.extraWaves ?? []), st];
    if (tp > 0.5) {
      const late = (tp - 0.5) * 2;
      const qTarget = -0.35 * p.R.amplitude * late;
      p.Q.amplitude = Math.min(p.Q.amplitude, qTarget);
      p.Q.width = Math.max(p.Q.width, p.Q.width + (waveMs(0, 0, 11).width - p.Q.width) * late);
      p.R.amplitude *= 1 - 0.3 * late;
    }
    return p;
  }
}

export class ExerciseResponse {
  /**
   * ECG during exercise (intensity 0..1): heart rate rises towards the
   * age-predicted maximum (220 - age), P amplitude increases, PR shortens
   * slightly beyond the rate effect, and a small upsloping J-point
   * depression appears (one extra wave). QT shortening follows from the
   * model's rate-aware QT correction.
   */
  static simulateExercise(intensity: number, baseParams: ECGSynParameters, age: number = 30): ECGSynParameters {
    const x = Math.min(1, Math.max(0, intensity));
    const p = cloneParams(baseParams);
    const maxHR = 220 - age;
    p.heartRate = baseParams.heartRate + Math.max(0, maxHR - baseParams.heartRate) * x;
    p.P.amplitude *= 1 + 0.3 * x;
    p.P.position *= 1 - 0.1 * x;
    if (x > 0) {
      const jMs = jPointRad(p) * SECONDS_PER_RADIAN * 1000;
      p.extraWaves = [...(p.extraWaves ?? []), waveMs(-0.1 * x, jMs + 15, 25)];
    }
    return p;
  }
}
