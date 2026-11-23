/**
 * Core parameter types of the ECGSYN-style model.
 *
 * Phase convention: wave `position` and `width` are angles on the cardiac
 * cycle, referenced to a heart rate of 60 bpm (one cycle = 1 s, so
 * 1 rad = 1000 / (2*pi) ms = 159.2 ms). The R peak is at phase 0.
 * At other heart rates the model maps these reference angles to time in a
 * rate-aware way (see models/rate.ts): depolarisation (QRS) keeps its
 * duration in ms, the PR interval shortens only slightly with rate and
 * repolarisation (ST-T-U) follows Fridericia's QT correction.
 */

/** One Gaussian wave component. */
export interface WaveParameters {
  /** True peak deflection of this wave in mV (lead II for the 12-lead model). */
  amplitude: number;
  /** Gaussian standard deviation in radians at the 60-bpm reference; must be > 0. */
  width: number;
  /** Centre of the wave in radians relative to the R peak at the 60-bpm reference. */
  position: number;
}

/** Complete parameter set for one heart beat morphology plus rate. */
export interface ECGSynParameters {
  P: WaveParameters;
  Q: WaveParameters;
  R: WaveParameters;
  S: WaveParameters;
  T: WaveParameters;
  /** Mean ventricular rate in beats per minute. */
  heartRate: number;
  /** Breathing rate in breaths per minute (respiratory baseline modulation). */
  respiratoryRate?: number;
  /** Peak amplitude of the respiratory baseline modulation in mV. */
  respiratoryAmplitude?: number;
  /**
   * Additional phase-locked Gaussian waves (U wave, ST-segment plateau,
   * R', atrial repolarisation / PR depression, ...).
   */
  extraWaves?: WaveParameters[];
}

/** Supported rhythm / morphology presets. */
export type PathologyType =
  | 'normal'
  | 'atrialFibrillation'
  | 'firstDegreeAVBlock'
  | 'ventricularTachycardia'
  | 'stemi'
  | 'bradycardia'
  | 'tachycardia'
  | 'completeHeartBlock'
  | 'lbbb'
  | 'rbbb'
  | 'hyperkalemia'
  | 'hypokalemia'
  | 'lvh'
  | 'pericarditis';

export const PATHOLOGY_TYPES: readonly PathologyType[] = [
  'normal',
  'atrialFibrillation',
  'firstDegreeAVBlock',
  'ventricularTachycardia',
  'stemi',
  'bradycardia',
  'tachycardia',
  'completeHeartBlock',
  'lbbb',
  'rbbb',
  'hyperkalemia',
  'hypokalemia',
  'lvh',
  'pericarditis',
];

/** Seconds per radian at the 60-bpm reference cycle. */
export const SECONDS_PER_RADIAN = 1 / (2 * Math.PI);

/** Build a wave from milliseconds (centre and Gaussian sigma at the 60-bpm reference). */
export function waveMs(amplitude: number, centerMs: number, sigmaMs: number): WaveParameters {
  return {
    amplitude,
    position: (centerMs / 1000) * 2 * Math.PI,
    width: (sigmaMs / 1000) * 2 * Math.PI,
  };
}

/** Deep copy of a parameter set. */
export function cloneParams(p: ECGSynParameters): ECGSynParameters {
  const out: ECGSynParameters = {
    P: { ...p.P },
    Q: { ...p.Q },
    R: { ...p.R },
    S: { ...p.S },
    T: { ...p.T },
    heartRate: p.heartRate,
  };
  if (p.respiratoryRate !== undefined) out.respiratoryRate = p.respiratoryRate;
  if (p.respiratoryAmplitude !== undefined) out.respiratoryAmplitude = p.respiratoryAmplitude;
  if (p.extraWaves !== undefined) out.extraWaves = p.extraWaves.map(w => ({ ...w }));
  return out;
}

const WAVE_KEYS = ['P', 'Q', 'R', 'S', 'T'] as const;

/** Lowest supported sampling rate (Hz). */
export const MIN_SAMPLING_RATE = 250;
/** Supported mean ventricular rate range (bpm), inclusive. */
export const HEART_RATE_RANGE = { min: 20, max: 300 } as const;
/** Largest allowed wave width (Gaussian sigma, radians at the 60-bpm reference = 500 ms). */
export const MAX_WAVE_WIDTH = Math.PI;
/** Largest allowed |wave position| (radians at the 60-bpm reference = one full cycle). */
export const MAX_WAVE_POSITION = 2 * Math.PI;

/** Throws a descriptive Error unless `samplingRate` is a finite number >= 250 Hz. */
export function validateSamplingRate(samplingRate: number): void {
  if (typeof samplingRate !== 'number' || !Number.isFinite(samplingRate) || samplingRate < MIN_SAMPLING_RATE) {
    throw new Error(`Sampling rate must be at least ${MIN_SAMPLING_RATE} Hz for ECG generation (got ${samplingRate})`);
  }
}

/** Throws a descriptive Error unless `heartRate` is a finite number within HEART_RATE_RANGE. */
export function validateHeartRate(heartRate: number): void {
  const { min, max } = HEART_RATE_RANGE;
  if (typeof heartRate !== 'number' || !Number.isFinite(heartRate) || heartRate < min || heartRate > max) {
    throw new Error(`Invalid heart rate: must be a finite number between ${min} and ${max} bpm (got ${heartRate})`);
  }
}

function checkWave(name: string, w: WaveParameters | undefined): void {
  if (!w || typeof w !== 'object') {
    throw new Error(`Invalid ECG parameters: ${name} must be an object with amplitude, width and position`);
  }
  if (!Number.isFinite(w.amplitude)) {
    throw new Error(`Invalid ECG parameters: ${name}.amplitude must be a finite number (got ${w.amplitude})`);
  }
  if (!Number.isFinite(w.width) || w.width <= 0 || w.width > MAX_WAVE_WIDTH) {
    throw new Error(
      `Invalid ECG parameters: ${name}.width must be a finite number > 0 and <= pi rad (got ${w.width})`
    );
  }
  if (!Number.isFinite(w.position) || Math.abs(w.position) > MAX_WAVE_POSITION) {
    throw new Error(
      `Invalid ECG parameters: ${name}.position must be a finite number within +-2*pi rad (got ${w.position})`
    );
  }
}

/** Throws a descriptive Error if any parameter is invalid. */
export function validateParams(p: ECGSynParameters): void {
  if (!p || typeof p !== 'object') throw new Error('Invalid ECG parameters: expected an object');
  for (const k of WAVE_KEYS) checkWave(k, p[k]);
  validateHeartRate(p.heartRate);
  if (p.respiratoryRate !== undefined && (!Number.isFinite(p.respiratoryRate) || p.respiratoryRate < 0)) {
    throw new Error(`Invalid ECG parameters: respiratoryRate must be a finite number >= 0 (got ${p.respiratoryRate})`);
  }
  if (p.respiratoryAmplitude !== undefined && !Number.isFinite(p.respiratoryAmplitude)) {
    throw new Error(`Invalid ECG parameters: respiratoryAmplitude must be a finite number (got ${p.respiratoryAmplitude})`);
  }
  if (p.extraWaves !== undefined) {
    if (!Array.isArray(p.extraWaves)) throw new Error('Invalid ECG parameters: extraWaves must be an array');
    p.extraWaves.forEach((w, i) => checkWave(`extraWaves[${i}]`, w));
  }
}
