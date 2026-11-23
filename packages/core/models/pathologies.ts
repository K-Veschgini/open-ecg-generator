/**
 * Deterministic pathology presets (lead II morphology, true mV amplitudes).
 *
 * Every preset is written in milliseconds at the 60-bpm reference
 * (see `waveMs`); the model maps them rate-aware to any heart rate.
 * Lead-specific morphology for the 12-lead model lives in models/leads.ts.
 */

import { ECGSynParameters, PathologyType, PATHOLOGY_TYPES, cloneParams, validateHeartRate, waveMs } from './types.js';

/** Typical (default) ventricular rate per pathology, bpm. */
export const PATHOLOGY_DEFAULT_HEART_RATE: Record<PathologyType, number> = {
  normal: 70,
  atrialFibrillation: 110,
  firstDegreeAVBlock: 70,
  ventricularTachycardia: 180,
  stemi: 70,
  bradycardia: 45,
  tachycardia: 140,
  completeHeartBlock: 40,
  lbbb: 70,
  rbbb: 70,
  hyperkalemia: 70,
  hypokalemia: 70,
  lvh: 70,
  pericarditis: 70,
};

/** How beats are scheduled for a pathology. */
export type RhythmKind = 'sinus' | 'atrialFibrillation' | 'ventricular' | 'avDissociation';

export interface RhythmDescriptor {
  kind: RhythmKind;
  /** independent atrial rate (bpm) for AV dissociation */
  atrialRate?: number;
}

export const PATHOLOGY_RHYTHM: Record<PathologyType, RhythmDescriptor> = {
  normal: { kind: 'sinus' },
  atrialFibrillation: { kind: 'atrialFibrillation' },
  firstDegreeAVBlock: { kind: 'sinus' },
  ventricularTachycardia: { kind: 'ventricular' },
  stemi: { kind: 'sinus' },
  bradycardia: { kind: 'sinus' },
  tachycardia: { kind: 'sinus' },
  completeHeartBlock: { kind: 'avDissociation', atrialRate: 75 },
  lbbb: { kind: 'sinus' },
  rbbb: { kind: 'sinus' },
  hyperkalemia: { kind: 'sinus' },
  hypokalemia: { kind: 'sinus' },
  lvh: { kind: 'sinus' },
  pericarditis: { kind: 'sinus' },
};

const RESP = { respiratoryRate: 15, respiratoryAmplitude: 0.01 };

// Normal sinus rhythm, lead II: P 0.15 mV / ~100 ms, PR ~150 ms,
// QRS ~87 ms with small q and s, R 1.2 mV, T 0.3 mV, QTc 400 ms,
// isoelectric ST segment ~100 ms, T peak-to-end ~105 ms.
const normalWaves = () => ({
  P: waveMs(0.15, -150, 20),
  Q: waveMs(-0.08, -26, 7),
  R: waveMs(1.2, 0, 10),
  S: waveMs(-0.25, 24, 8),
  T: waveMs(0.3, 250, 44),
});

type Preset = Omit<ECGSynParameters, 'heartRate'>;

const PRESETS: Record<PathologyType, () => Preset> = {
  normal: () => ({ ...normalWaves(), ...RESP }),

  // Sinus bradycardia / tachycardia: normal morphology; PR and QT adapt to the
  // rate through the rate-aware mapping (no phase hacks needed).
  bradycardia: () => ({ ...normalWaves(), ...RESP }),
  tachycardia: () => ({ ...normalWaves(), ...RESP }),

  // First-degree AV block: P wave moved earlier, PR ~280 ms (stays > 200 ms
  // at any rate because PR scales only by RR^0.15).
  firstDegreeAVBlock: () => ({ ...normalWaves(), P: waveMs(0.15, -275, 20), ...RESP }),

  // Atrial fibrillation: no P waves (fibrillatory f-waves are added by the
  // rhythm model), irregularly irregular RR, normal narrow QRS.
  atrialFibrillation: () => ({ ...normalWaves(), P: waveMs(0, -150, 20), ...RESP }),

  // Monomorphic ventricular tachycardia: no P waves, wide QRS (~160 ms),
  // discordant T wave.
  ventricularTachycardia: () => ({
    P: waveMs(0, -150, 20),
    Q: waveMs(0, -40, 10),
    R: waveMs(1.4, 0, 24),
    S: waveMs(-0.5, 60, 18),
    T: waveMs(-0.45, 250, 55),
    ...RESP,
  }),

  // Inferior STEMI (lead II): pathological Q (>40 ms, >25 % of R), reduced R,
  // convex ST elevation ~0.3 mV merging into a hyperacute T wave.
  stemi: () => ({
    P: waveMs(0.15, -150, 20),
    Q: waveMs(-0.3, -22, 11),
    R: waveMs(0.8, 5, 11),
    S: waveMs(-0.05, 28, 7),
    T: waveMs(0.5, 230, 50),
    extraWaves: [waveMs(0.32, 120, 55)], // X0: ST-segment elevation (convex dome into T)
    ...RESP,
  }),

  // Complete (third-degree) AV block: P waves at an independent atrial rate
  // (75/min) march through a slow regular ventricular escape rhythm with a
  // wide QRS (~135 ms) and discordant T.
  completeHeartBlock: () => ({
    P: waveMs(0.15, -150, 20),
    Q: waveMs(0, -30, 8),
    R: waveMs(1.1, 0, 20),
    S: waveMs(-0.35, 45, 16),
    T: waveMs(-0.35, 290, 60),
    ...RESP,
  }),

  // LBBB: no septal q, broad notched (M-shaped) R, QRS ~150 ms, discordant
  // ST depression and T inversion in lead II / lateral leads.
  lbbb: () => ({
    P: waveMs(0.15, -150, 20),
    Q: waveMs(0, -30, 8),
    R: waveMs(0.7, -8, 18),
    S: waveMs(-0.05, 80, 10),
    T: waveMs(-0.3, 270, 55),
    extraWaves: [
      waveMs(0.8, 41, 19),   // X0: second (late) R peak -> shallow mid-QRS notch
      waveMs(-0.1, 115, 40), // X1: discordant ST depression
    ],
    ...RESP,
  }),

  // RBBB: QRS ~135 ms with a broad terminal S in lead II / I / V6 and an
  // rsR' in V1 (the terminal wave is the R' there).
  rbbb: () => ({
    P: waveMs(0.15, -150, 20),
    Q: waveMs(-0.06, -24, 7),
    R: waveMs(0.9, 0, 10),
    S: waveMs(-0.25, 48, 20),  // broad terminal S (deeper in I / V6, R' in V1 and aVR)
    T: waveMs(0.25, 250, 50),
    extraWaves: [waveMs(-0.02, 18, 7)], // X0: early s (visible in V1/V2)
    ...RESP,
  }),

  // Hyperkalaemia: flattened broad P, prolonged PR (~210 ms), widened QRS (~110 ms), tall narrow
  // peaked (tented) T wave, short QT.
  hyperkalemia: () => ({
    P: waveMs(0.07, -200, 26),
    Q: waveMs(-0.08, -30, 9),
    R: waveMs(1.0, 0, 13),
    S: waveMs(-0.3, 32, 11),
    T: waveMs(0.5, 205, 32),
    extraWaves: [waveMs(0.35, 205, 13)], // X0: sharp apex -> narrow-based, tented T (~0.85 mV)
    ...RESP,
  }),

  // Hypokalaemia: prominent P, flat T, mild ST depression, prominent U wave
  // following the T wave.
  hypokalemia: () => ({
    ...normalWaves(),
    P: waveMs(0.18, -150, 22),
    T: waveMs(0.08, 235, 55),
    extraWaves: [
      waveMs(-0.08, 130, 45), // X0: ST depression
      waveMs(0.15, 430, 45),  // X1: U wave
    ],
    ...RESP,
  }),

  // LVH with strain: very tall R (Sokolow-Lyon S V1 + R V5 ~ 4.9 mV), deep S
  // in V1-V2, down-sloping ST depression and T inversion laterally.
  lvh: () => ({
    P: waveMs(0.15, -150, 22),
    Q: waveMs(-0.1, -28, 8),
    R: waveMs(1.9, 0, 12),
    S: waveMs(-0.3, 28, 10),
    T: waveMs(-0.22, 245, 55),
    extraWaves: [waveMs(-0.1, 110, 40)], // X0: strain ST depression
    ...RESP,
  }),

  // Acute pericarditis: diffuse concave ("saddle") ST elevation starting at
  // the J point, PR-segment depression (atrial repolarisation).
  pericarditis: () => ({
    P: waveMs(0.17, -150, 20),
    Q: waveMs(-0.05, -26, 7),
    R: waveMs(1.1, 0, 10),
    S: waveMs(-0.1, 24, 8),
    T: waveMs(0.3, 225, 60),
    extraWaves: [
      waveMs(-0.07, -85, 28), // X0: PR depression (Ta wave)
      waveMs(0.2, 75, 45),    // X1: J-point / ST elevation (~2 mm), plateau sagging into the T wave (concave)
    ],
    ...RESP,
  }),
};

function assertPathology(pathology: string): asserts pathology is PathologyType {
  if (!(PATHOLOGY_TYPES as readonly string[]).includes(pathology)) {
    throw new Error(`Unknown pathology "${pathology}". Supported: ${PATHOLOGY_TYPES.join(', ')}`);
  }
}

/**
 * Fully resolved, deterministic preset parameters for a pathology.
 * If `heartRate` is given it wins over the preset's typical rate.
 * Always returns a fresh deep copy.
 */
export function getPathologyParams(pathology: PathologyType, heartRate?: number): ECGSynParameters {
  assertPathology(pathology);
  const rate = heartRate ?? PATHOLOGY_DEFAULT_HEART_RATE[pathology];
  validateHeartRate(rate);
  return cloneParams({ ...PRESETS[pathology](), heartRate: rate });
}

/**
 * Backwards-compatible preset accessors: `PATHOLOGY_PARAMS[p](base?)`.
 * The returned parameters are `getPathologyParams(p)`; the optional `base`
 * argument is accepted for signature compatibility only and is ignored
 * (presets are complete parameter sets, not deltas).
 */
export const PATHOLOGY_PARAMS: Record<PathologyType, (base?: ECGSynParameters) => ECGSynParameters> =
  Object.fromEntries(
    PATHOLOGY_TYPES.map(p => [p, (_base?: ECGSynParameters) => getPathologyParams(p)])
  ) as Record<PathologyType, (base?: ECGSynParameters) => ECGSynParameters>;
