import { ODEFunction, solveODE } from '../math/ode-solver';

/**
 * Parameters for each ECG wave component
 */
export interface WaveParameters {
  amplitude: number;  // mV
  width: number;      // radians
  position: number;   // radians
}

/**
 * Complete parameter set for ECG generation
 */
export interface ECGSynParameters {
  P: WaveParameters;
  Q: WaveParameters;
  R: WaveParameters;
  S: WaveParameters;
  T: WaveParameters;
  heartRate: number;  // bpm
  respiratoryRate?: number;  // breaths per minute
  respiratoryAmplitude?: number;  // mV
}

/**
 * Default parameters for normal ECG
 */
export const DEFAULT_ECGSYN_PARAMS: ECGSynParameters = {
  P: { amplitude: 0.15, width: 0.09, position: -Math.PI / 3 },
  Q: { amplitude: -0.025, width: 0.066, position: -Math.PI / 12 },
  R: { amplitude: 1.6, width: 0.11, position: 0 },
  S: { amplitude: -0.25, width: 0.066, position: Math.PI / 12 },
  T: { amplitude: 0.35, width: 0.142, position: Math.PI / 2 },
  heartRate: 60,
  respiratoryRate: 15,
  respiratoryAmplitude: 0.01
};

/**
 * Note: The ECGSYN ODE produces signals that are scaled down compared to
 * the input amplitude parameters. The scaling factor in generateECGSyn
 * compensates for this to produce physiologically accurate amplitudes.
 */

/**
 * ECGSYN model differential equations
 */
export const ecgsynODE: ODEFunction = (t: number, state: number[], params: any) => {
  const [x, y, z] = state;
  
  // Extract parameters
  const { omega, waves, z0Function } = params;
  
  // Calculate alpha (attracts trajectory to unit circle)
  const r = Math.sqrt(x * x + y * y);
  const alpha = 1 - r;
  
  // Current phase angle
  const theta = Math.atan2(y, x);
  
  // Calculate z derivative
  let dzdt = 0;
  
  // Sum contributions from each wave
  for (const wave of waves) {
    // Angular distance from wave position
    let deltaTheta = theta - wave.position;
    
    // Wrap to [-π, π]
    while (deltaTheta > Math.PI) deltaTheta -= 2 * Math.PI;
    while (deltaTheta < -Math.PI) deltaTheta += 2 * Math.PI;
    
    // Gaussian contribution
    const gaussian = Math.exp(-(deltaTheta * deltaTheta) / (2 * wave.width * wave.width));
    dzdt -= wave.amplitude * omega * deltaTheta * gaussian;
  }
  
  // Add baseline restoration
  const z0 = z0Function ? z0Function(t) : 0;
  dzdt -= (z - z0);
  
  // Return derivatives
  return [
    alpha * x - omega * y,
    alpha * y + omega * x,
    dzdt
  ];
};

/**
 * Generate ECG signal using ECGSYN model
 */
export function generateECGSyn(
  duration: number,
  samplingRate: number,
  params: ECGSynParameters = DEFAULT_ECGSYN_PARAMS,
  tolerance: number = 1e-6
): { time: number[]; ecg: number[] } {
  // Calculate angular velocity from heart rate
  const rrInterval = 60.0 / params.heartRate; // seconds
  const omega = 2 * Math.PI / rrInterval;
  
  // Prepare wave parameters array
  const waves = [
    params.P,
    params.Q,
    params.R,
    params.S,
    params.T
  ];
  
  // Baseline wander function (respiratory effect)
  const z0Function = params.respiratoryRate && params.respiratoryAmplitude
    ? (t: number) => params.respiratoryAmplitude! * Math.sin(2 * Math.PI * params.respiratoryRate! / 60 * t)
    : undefined;
  
  // ODE parameters
  const odeParams = { omega, waves, z0Function };
  
  // Solve ODE with adaptive RK45
  const numPoints = Math.ceil(duration * samplingRate);
  const solution = solveODE(ecgsynODE, {
    initialConditions: [1, 0, 0], // Start on unit circle
    timeSpan: [0, duration],
    timePoints: numPoints,
    params: odeParams,
    tolerance: tolerance  // Adaptive step size error tolerance
  });
  
  // Extract ECG signal (z component)
  // Apply scaling factor - the ODE produces signals ~100x smaller than expected
  // This is due to the mathematical formulation of the model
  const AMPLITUDE_SCALE = 80;  // Empirically determined to match physiological amplitudes
  const ecg = solution.y.map(state => state[2] * AMPLITUDE_SCALE);
  
  return { time: solution.t, ecg };
}

/**
 * Parameter modifications for common pathological conditions
 */
export const PATHOLOGY_PARAMS = {
  // Atrial fibrillation: no P wave, irregular RR
  atrialFibrillation: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    P: { ...base.P, amplitude: 0 }, // Remove P wave
    // Note: RR irregularity handled separately
  }),
  
  // First degree AV block: prolonged PR interval
  firstDegreeAVBlock: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    P: { ...base.P, position: -Math.PI / 2 }, // Move P wave earlier
  }),
  
  // Ventricular tachycardia: wide QRS, fast rate
  ventricularTachycardia: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    heartRate: 180,
    Q: { ...base.Q, width: base.Q.width * 2 },
    R: { ...base.R, width: base.R.width * 2 },
    S: { ...base.S, width: base.S.width * 2 },
  }),
  
  // ST elevation (myocardial infarction)
  stemi: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    S: { ...base.S, amplitude: base.S.amplitude * 0.5 }, // Reduce S depth
    T: { ...base.T, amplitude: base.T.amplitude * 1.5, position: Math.PI / 3 }, // Elevate and shift T
  }),
  
  // Bradycardia
  bradycardia: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    heartRate: 45,
  }),
  
  // Tachycardia  
  tachycardia: (base: ECGSynParameters): ECGSynParameters => ({
    ...base,
    heartRate: 120,
  }),
};
