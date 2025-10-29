// Main exports
export { ECGGenerator } from './ECGGenerator';
export type { 
  ECGGeneratorOptions, 
  ECGResult, 
  PathologyType,
  NoiseOptions 
} from './ECGGenerator';

// Model exports
export { 
  generateECGSyn,
  DEFAULT_ECGSYN_PARAMS,
  PATHOLOGY_PARAMS
} from './models/ecgsyn';
export type { 
  ECGSynParameters, 
  WaveParameters 
} from './models/ecgsyn';

// Enhanced pathology exports
export { ENHANCED_PATHOLOGY_PARAMS } from './models/ecgsyn-enhanced';

// Utility exports for advanced users
export { solveODE, interpolate } from './math/ode-solver';
export type { ODEFunction, ODESolverOptions } from './math/ode-solver';

// Re-export commonly used functions for convenience
import { ECGGenerator } from './ECGGenerator';

/**
 * Quick function to generate a normal ECG
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
 * Quick function to generate ECG with pathology
 */
export function generatePathologicalECG(
  pathology: import('./ECGGenerator').PathologyType,
  duration: number = 10,
  samplingRate: number = 1000
): { time: number[]; signal: number[] } {
  const generator = new ECGGenerator(samplingRate);
  const result = generator.generate({ duration, pathology });
  return { time: result.time, signal: result.signal };
}

// Version info
export const VERSION = '1.0.0';
