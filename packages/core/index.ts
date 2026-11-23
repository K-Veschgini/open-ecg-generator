// Main exports
export { ECGGenerator } from './ECGGenerator.js';
export type {
  ECGGeneratorOptions,
  ECGResult,
  PathologyType,
  NoiseOptions,
  LeadName
} from './ECGGenerator.js';

// Model exports
export {
  generateECGSyn,
  DEFAULT_ECGSYN_PARAMS,
  PATHOLOGY_PARAMS,
  getPathologyParams,
  PATHOLOGY_DEFAULT_HEART_RATE
} from './models/ecgsyn.js';
export type {
  ECGSynParameters,
  WaveParameters
} from './models/ecgsyn.js';
export { PATHOLOGY_TYPES, waveMs } from './models/types.js';
export { STANDARD_LEADS } from './models/leads.js';

// Enhanced pathology exports (alias of PATHOLOGY_PARAMS, kept for compatibility)
export { ENHANCED_PATHOLOGY_PARAMS } from './models/ecgsyn-enhanced.js';

// Optional physiological refinements
export {
  HRVGenerator,
  QTCorrection,
  LeadMorphology,
  ArtifactGenerator,
  DemographicAdjustments,
  PathologyProgression,
  ExerciseResponse
} from './enhancements/realistic-features.js';
export type { HRVParams, DemographicParams } from './enhancements/realistic-features.js';

// Utility exports for advanced users
export { solveODE, interpolate } from './math/ode-solver.js';
export type { ODEFunction, ODESolverOptions, ODESolution } from './math/ode-solver.js';

import { ECGGenerator } from './ECGGenerator.js';
import type { PathologyType } from './ECGGenerator.js';

/**
 * Quick function to generate a normal ECG (lead II)
 */
export function generateNormalECG(
  duration: number = 10,
  heartRate: number = 70,
  samplingRate: number = 1000
): { time: number[]; signal: number[] } {
  const generator = new ECGGenerator(samplingRate);
  const result = generator.generate({ duration, heartRate });
  return { time: result.time, signal: result.signal };
}

/**
 * Quick function to generate ECG with pathology (lead II, preset heart rate)
 */
export function generatePathologicalECG(
  pathology: PathologyType,
  duration: number = 10,
  samplingRate: number = 1000
): { time: number[]; signal: number[] } {
  const generator = new ECGGenerator(samplingRate);
  const result = generator.generate({ duration, pathology });
  return { time: result.time, signal: result.signal };
}

// Version info
export const VERSION = '1.0.0';
