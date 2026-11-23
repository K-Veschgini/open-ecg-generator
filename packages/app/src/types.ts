import {
  PATHOLOGY_TYPES,
  type ECGGeneratorOptions,
  type ECGResult,
  type ECGSynParameters,
  type LeadName,
  type NoiseOptions,
  type PathologyType
} from '@open-ecg-generator/core'

export type SolverAccuracy = 'fast' | 'standard' | 'high'
export type LeadSet = '12-lead' | 'rhythm' | 'single'

export interface ECGSettings {
  /** Preset, or 'custom' = hand-edited waves on top of the rhythm of `customBase`. */
  pathology: PathologyType | 'custom'
  /** Preset whose rhythm (and non-edited fields) custom mode builds on. */
  customBase: PathologyType
  /** Mean ventricular rate in bpm (always honoured). */
  heartRate: number
  paperSpeed: 25 | 50 // mm/s
  gain: 5 | 10 | 20 // mm/mV
  /** 0..1, 0 = perfectly clean. */
  noiseLevel: number
  /** 0..1 biological beat-morphology variation (core `variation`). */
  variation: number
  leadSet: LeadSet
  selectedLead: LeadName
  /** Seconds, rhythm / single-lead views only (12-lead is always 10 s). */
  duration: number
  respiratoryWander: boolean
  respiratoryRate: number // breaths per minute
  solverAccuracy: SolverAccuracy
  /** Hand-edited parameters (custom mode only). */
  customWaveParams: ECGSynParameters | null
}

/** Generated recording, all leads share one time base. */
export interface ECGData {
  leads: Record<LeadName, ECGResult>
  samplingRate: number
  duration: number
  /** Actual mean ventricular rate of the generated beats (bpm). */
  heartRate: number
  pathology: PathologyType | 'custom'
}

/** Generator sampling rate; everything else reads it back from the result. */
export const GENERATOR_SAMPLING_RATE = 500

export const PATHOLOGY_LABELS: Record<PathologyType, string> = {
  normal: 'Normal Sinus Rhythm',
  bradycardia: 'Sinus Bradycardia',
  tachycardia: 'Sinus Tachycardia',
  atrialFibrillation: 'Atrial Fibrillation',
  firstDegreeAVBlock: 'First-Degree AV Block',
  completeHeartBlock: 'Complete (Third-Degree) Heart Block',
  ventricularTachycardia: 'Ventricular Tachycardia (Monomorphic)',
  stemi: 'Inferior STEMI',
  lbbb: 'Left Bundle Branch Block',
  rbbb: 'Right Bundle Branch Block',
  lvh: 'Left Ventricular Hypertrophy',
  hyperkalemia: 'Hyperkalaemia',
  hypokalemia: 'Hypokalaemia',
  pericarditis: 'Acute Pericarditis'
}

/** Pathologies in dropdown order (falls back to core order for any new value). */
export const PATHOLOGY_ORDER: PathologyType[] = [
  ...(Object.keys(PATHOLOGY_LABELS) as PathologyType[]).filter(p => PATHOLOGY_TYPES.includes(p)),
  ...PATHOLOGY_TYPES.filter(p => !(p in PATHOLOGY_LABELS))
]

export function pathologyLabel(p: PathologyType | 'custom', base?: PathologyType): string {
  if (p === 'custom') return base ? `Custom waves (based on ${PATHOLOGY_LABELS[base] ?? base})` : 'Custom waves'
  return PATHOLOGY_LABELS[p] ?? p
}

/** ODE solver tolerance per accuracy setting (core default is 1e-6). */
export const SOLVER_TOLERANCE: Record<SolverAccuracy, number> = {
  fast: 1e-4, // ~1e-3 mV max error: invisible on paper, fastest
  standard: 1e-6, // ~2e-5 mV max error (core default)
  high: 1e-8 // ~1e-7 mV max error
}

/**
 * Map the 0..1 noise slider to a realistic mix (all mV).
 * 0 => no noise at all. 1 => clearly noisy but readable recording:
 * 0.2 mV baseline wander, 0.05 mV RMS EMG, 0.015 mV RMS broadband, 0.02 mV mains hum.
 */
export function noiseFromLevel(level: number): NoiseOptions | undefined {
  if (!(level > 0)) return undefined
  const l = Math.min(1, level)
  return {
    baseline: { amplitude: 0.2 * l, frequency: 0.25 },
    muscle: { amplitude: 0.05 * l },
    gaussian: { amplitude: 0.015 * l },
    powerline: { amplitude: 0.02 * l, frequency: 50 }
  }
}

/** Respiratory baseline modulation amplitude when the wander option is on (mV). */
export const RESPIRATORY_WANDER_MV = 0.08

/** Build core generator options from UI settings (see core precedence rules). */
export function buildGeneratorOptions(settings: ECGSettings, seed: number): ECGGeneratorOptions {
  const isCustom = settings.pathology === 'custom'
  const pathology: PathologyType = settings.pathology === 'custom' ? settings.customBase : settings.pathology
  const respiratory: Partial<ECGSynParameters> = {
    respiratoryRate: settings.respiratoryRate,
    respiratoryAmplitude: settings.respiratoryWander ? RESPIRATORY_WANDER_MV : 0
  }
  let customParams: Partial<ECGSynParameters> = respiratory
  if (isCustom && settings.customWaveParams) {
    const c = settings.customWaveParams
    // Wave fields only - never heartRate (the slider is the single source of rate).
    customParams = {
      P: { ...c.P },
      Q: { ...c.Q },
      R: { ...c.R },
      S: { ...c.S },
      T: { ...c.T },
      extraWaves: (c.extraWaves ?? []).map(w => ({ ...w })),
      ...respiratory
    }
  }
  return {
    samplingRate: GENERATOR_SAMPLING_RATE,
    duration: settings.leadSet === '12-lead' ? 10 : settings.duration,
    pathology,
    heartRate: settings.heartRate,
    variation: settings.variation,
    seed,
    noise: noiseFromLevel(settings.noiseLevel),
    solverTolerance: SOLVER_TOLERANCE[settings.solverAccuracy],
    customParams
  }
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff)
}
