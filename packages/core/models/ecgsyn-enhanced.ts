import { ECGSynParameters, WaveParameters } from './ecgsyn';

/**
 * Enhanced pathology parameters with more dramatic and realistic changes
 */
export const ENHANCED_PATHOLOGY_PARAMS = {
  // Normal sinus rhythm (reference)
  normal: (base: ECGSynParameters): ECGSynParameters => base,
  
  // Atrial fibrillation: no P wave, irregular RR, fibrillatory baseline
  atrialFibrillation: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    P: { amplitude: 0, width: 0.01, position: base.P.position }, // Completely remove P wave
    // Add fibrillatory baseline via rapid oscillations
    heartRate: 90 + Math.random() * 40, // Variable rate 90-130
  }),
  
  // First degree AV block: significantly prolonged PR interval
  firstDegreeAVBlock: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    P: { 
      ...base.P, 
      position: -Math.PI * 0.6  // Move P wave much earlier (PR > 200ms)
    },
    // Keep same QRS position, creating long PR interval
  }),
  
  // Ventricular tachycardia: very wide QRS, no P waves, fast rate
  ventricularTachycardia: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    heartRate: 180,
    P: { amplitude: 0, width: 0.01, position: base.P.position }, // No P waves
    Q: { 
      amplitude: -0.4,  // Deep Q wave
      width: 0.15,      // Very wide
      position: base.Q.position - 0.1 
    },
    R: { 
      amplitude: 2.5,   // Tall R wave
      width: 0.2,       // Very wide (total QRS > 160ms)
      position: base.R.position 
    },
    S: { 
      amplitude: -0.8,  // Deep S wave
      width: 0.15,      // Very wide
      position: base.S.position + 0.1
    },
    T: { 
      amplitude: -0.6,  // Inverted T wave
      width: 0.2,
      position: base.T.position 
    },
  }),
  
  // STEMI: significant ST elevation, hyperacute T waves, Q waves
  stemi: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    Q: { 
      amplitude: -0.3,  // Pathological Q wave (>25% of R wave)
      width: 0.08,      // Wide Q wave (>40ms)
      position: base.Q.position 
    },
    R: { 
      ...base.R,
      amplitude: base.R.amplitude * 0.7  // Reduced R wave
    },
    S: { 
      amplitude: -0.05, // Almost no S wave (ST elevation starts here)
      width: 0.03,
      position: base.S.position 
    },
    T: { 
      amplitude: 0.8,   // Very tall, hyperacute T wave
      width: 0.2,       // Broad T wave
      position: Math.PI / 3  // Earlier T wave (merged with ST segment)
    },
  }),
  
  // Complete heart block: P waves and QRS complexes completely dissociated
  completeHeartBlock: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    heartRate: 40,  // Ventricular escape rhythm
    P: {
      ...base.P,
      // P waves continue at normal rate but position varies
      // This needs special handling in the generator
      amplitude: base.P.amplitude * 1.2,  // Slightly larger P waves
    },
    R: {
      ...base.R,
      amplitude: base.R.amplitude * 1.3,  // Ventricular escape beats are larger
    }
  }),
  
  // Bradycardia with more realistic changes
  bradycardia: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    heartRate: 45,
    T: {
      ...base.T,
      amplitude: base.T.amplitude * 1.2,  // Taller T waves at slow rates
      width: base.T.width * 1.1
    }
  }),
  
  // Tachycardia with rate-related changes
  tachycardia: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    heartRate: 140,
    P: {
      ...base.P,
      amplitude: base.P.amplitude * 0.7,  // Smaller P waves at fast rates
      position: -Math.PI / 4  // P wave closer to previous T wave
    },
    T: {
      ...base.T,
      amplitude: base.T.amplitude * 0.8,  // Smaller T waves
      width: base.T.width * 0.9
    }
  }),
  
  // Left Bundle Branch Block (LBBB)
  lbbb: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    Q: { 
      amplitude: 0,  // No Q wave in lateral leads
      width: 0.01,
      position: base.Q.position 
    },
    R: { 
      amplitude: 1.8,
      width: 0.18,  // Wide R wave
      position: base.R.position 
    },
    S: { 
      amplitude: -0.1,  // Small S wave
      width: 0.18,     // Wide S wave
      position: base.S.position + 0.15  // Delayed
    },
    T: { 
      amplitude: -0.4,  // Inverted T wave
      width: base.T.width,
      position: base.T.position 
    },
  }),
  
  // Right Bundle Branch Block (RBBB)
  rbbb: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    R: { 
      amplitude: 1.2,
      width: 0.06,  // Initial R wave
      position: base.R.position 
    },
    S: { 
      amplitude: -0.8,  // Deep S wave
      width: 0.12,      // Wide S wave
      position: base.S.position 
    },
    // Need to add R' wave (second R wave) - requires modification to model
    T: { 
      amplitude: -0.3,  // Inverted T wave
      width: base.T.width,
      position: base.T.position 
    },
  }),
  
  // Hyperkalemia: peaked T waves, wide QRS
  hyperkalemia: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    P: {
      ...base.P,
      amplitude: base.P.amplitude * 0.5,  // Flattened P waves
      width: base.P.width * 1.5
    },
    Q: {
      ...base.Q,
      width: base.Q.width * 1.3
    },
    R: {
      ...base.R,
      width: base.R.width * 1.3  // Widened QRS
    },
    S: {
      ...base.S,
      width: base.S.width * 1.3
    },
    T: { 
      amplitude: 1.2,   // Very tall, peaked T waves
      width: 0.08,      // Narrow, tent-shaped
      position: base.T.position 
    },
  }),
  
  // Hypokalemia: flat T waves, U waves (need special handling)
  hypokalemia: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    T: { 
      amplitude: 0.1,   // Very flat T waves
      width: base.T.width * 1.5,  // Broad, flat T
      position: base.T.position 
    },
    // U waves need to be added separately
  }),
  
  // Left Ventricular Hypertrophy (LVH)
  lvh: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    R: { 
      amplitude: 2.8,   // Very tall R waves in lateral leads
      width: base.R.width,
      position: base.R.position 
    },
    S: { 
      amplitude: -1.2,  // Deep S waves in right precordial leads
      width: base.S.width,
      position: base.S.position 
    },
    T: { 
      amplitude: -0.3,  // T wave inversion (strain pattern)
      width: base.T.width * 1.1,
      position: base.T.position 
    },
  }),
  
  // Pericarditis: diffuse ST elevation, PR depression
  pericarditis: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    P: {
      ...base.P,
      amplitude: base.P.amplitude * 1.2
    },
    S: { 
      amplitude: -0.05,  // Minimal S wave
      width: 0.02,
      position: base.S.position 
    },
    T: { 
      amplitude: 0.6,    // Elevated ST-T complex
      width: 0.25,       // Broad, elevated ST-T
      position: Math.PI / 3.5  // Earlier, merges with ST segment
    },
  }),
};

/**
 * Additional wave components for complex pathologies
 */
export interface AdditionalWaves {
  // U wave for hypokalemia
  U?: WaveParameters;
  // Delta wave for WPW
  delta?: WaveParameters;
  // R' wave for RBBB
  rPrime?: WaveParameters;
  // Fibrillatory waves for AFib
  fibrillation?: {
    frequency: number;  // Hz
    amplitude: number;  // mV
  };
}

/**
 * Enhanced parameter structure
 */
export interface EnhancedECGSynParameters extends ECGSynParameters {
  additionalWaves?: AdditionalWaves;
  stElevation?: number;  // Additional ST elevation in mV
  prDepression?: number; // PR segment depression in mV
}
