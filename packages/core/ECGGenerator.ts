import { 
  generateECGSyn, 
  DEFAULT_ECGSYN_PARAMS, 
  ECGSynParameters,
  PATHOLOGY_PARAMS 
} from './models/ecgsyn';
import { ENHANCED_PATHOLOGY_PARAMS } from './models/ecgsyn-enhanced';

/**
 * Supported pathological conditions
 */
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

/**
 * Noise types that can be added to ECG
 */
export interface NoiseOptions {
  baseline?: {
    amplitude: number;  // mV
    frequency: number;  // Hz
  };
  powerline?: {
    amplitude: number;  // mV
    frequency: 50 | 60;  // Hz
  };
  muscle?: {
    amplitude: number;  // mV
  };
  gaussian?: {
    amplitude: number;  // mV (standard deviation)
  };
}

/**
 * Options for ECG generation
 */
export interface ECGGeneratorOptions {
  samplingRate?: number;
  duration?: number;
  heartRate?: number;
  pathology?: PathologyType;
  noise?: NoiseOptions;
  customParams?: Partial<ECGSynParameters>;
  solverTolerance?: number;  // ODE solver tolerance (default: 1e-6, lower = more accurate)
}

/**
 * Result of ECG generation
 */
export interface ECGResult {
  time: number[];
  signal: number[];
  samplingRate: number;
  metadata: {
    duration: number;
    heartRate: number;
    pathology: PathologyType;
    noise: NoiseOptions | undefined;
  };
}

/**
 * High-level ECG generator class
 */
export class ECGGenerator {
  private samplingRate: number;
  
  constructor(samplingRate: number = 1000) {
    if (samplingRate < 250) {
      throw new Error('Sampling rate must be at least 250 Hz for ECG generation');
    }
    this.samplingRate = samplingRate;
  }
  
  /**
   * Generate ECG signal with specified options
   */
  generate(options: ECGGeneratorOptions = {}): ECGResult {
    const {
      duration = 10,
      heartRate = 60,
      pathology = 'normal',
      noise,
      customParams,
      samplingRate = this.samplingRate,
      solverTolerance = 1e-6
    } = options;
    
    // Get base parameters
    let params = { ...DEFAULT_ECGSYN_PARAMS, heartRate };
    
    // Apply pathology modifications - use enhanced parameters
    if (pathology !== 'normal') {
      // Try enhanced parameters first, fall back to basic if not found
      const enhancedPathology = ENHANCED_PATHOLOGY_PARAMS[pathology as keyof typeof ENHANCED_PATHOLOGY_PARAMS];
      if (enhancedPathology) {
        params = enhancedPathology(params);
      } else if ((PATHOLOGY_PARAMS as any)[pathology]) {
        params = (PATHOLOGY_PARAMS as any)[pathology](params);
      }
    }
    
    // Apply custom parameters
    if (customParams) {
      params = { ...params, ...customParams };
    }
    
    // Generate clean ECG with adaptive RK45 solver
    let { time, ecg } = generateECGSyn(duration, samplingRate, params, solverTolerance);
    
    // Apply pathology-specific post-processing
    if (pathology === 'stemi') {
      // Add ST elevation as a separate component
      ecg = this.addSTElevation(ecg, time);
    } else if (pathology === 'hypokalemia') {
      // Add U waves
      ecg = this.addUWaves(ecg, time, params.heartRate);
    } else if (pathology === 'atrialFibrillation') {
      // Add fibrillatory baseline and make irregular
      ecg = this.addFibrillatoryWaves(ecg, time);
      const result = this.makeIrregular(time, ecg, params.heartRate);
      time = result.time;
      ecg = result.signal;
    } else if (pathology === 'completeHeartBlock') {
      // Handle dissociated P waves and QRS complexes
      ecg = this.simulateAVDissociation(ecg);
    }
    
    // Apply noise if specified
    if (noise) {
      ecg = this.addNoise(ecg, time, noise);
    }
    
    return {
      time,
      signal: ecg,
      samplingRate,
      metadata: {
        duration,
        heartRate: params.heartRate,
        pathology,
        noise
      }
    };
  }
  
  /**
   * Generate multiple leads from single lead
   */
  generateMultiLead(
    options: ECGGeneratorOptions = {},
    leads: string[] = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF']
  ): { [lead: string]: ECGResult } {
    // Generate base signal (Lead II)
    const leadII = this.generate(options);
    
    // Lead transformations (simplified)
    const leadTransforms: { [key: string]: (signal: number[]) => number[] } = {
      'I': (signal) => signal.map(v => v * 0.8),
      'II': (signal) => signal,
      'III': (signal) => signal.map(v => v * 0.6),
      'aVR': (signal) => signal.map(v => -v * 0.5),
      'aVL': (signal) => signal.map(v => v * 0.4),
      'aVF': (signal) => signal.map(v => v * 0.7),
      'V1': (signal) => signal.map(v => v * 0.3),
      'V2': (signal) => signal.map(v => v * 0.5),
      'V3': (signal) => signal.map(v => v * 0.8),
      'V4': (signal) => signal.map(v => v * 1.0),
      'V5': (signal) => signal.map(v => v * 0.9),
      'V6': (signal) => signal.map(v => v * 0.7),
    };
    
    const result: { [lead: string]: ECGResult } = {};
    
    for (const lead of leads) {
      const transform = leadTransforms[lead] || ((s) => s);
      result[lead] = {
        ...leadII,
        signal: transform(leadII.signal),
      };
    }
    
    return result;
  }
  
  /**
   * Add various types of noise to ECG signal
   */
  private addNoise(signal: number[], time: number[], noise: NoiseOptions): number[] {
    let noisySignal = [...signal];
    
    // Baseline wander
    if (noise.baseline) {
      const { amplitude, frequency } = noise.baseline;
      for (let i = 0; i < signal.length; i++) {
        noisySignal[i] += amplitude * Math.sin(2 * Math.PI * frequency * time[i]);
      }
    }
    
    // Powerline interference
    if (noise.powerline) {
      const { amplitude, frequency } = noise.powerline;
      for (let i = 0; i < signal.length; i++) {
        noisySignal[i] += amplitude * Math.sin(2 * Math.PI * frequency * time[i]);
      }
    }
    
    // Muscle artifacts (band-limited noise)
    if (noise.muscle) {
      const { amplitude } = noise.muscle;
      for (let i = 0; i < signal.length; i++) {
        // Simple high-frequency noise simulation
        noisySignal[i] += amplitude * (Math.random() - 0.5) * 
          Math.sin(2 * Math.PI * (20 + Math.random() * 30) * time[i]);
      }
    }
    
    // Gaussian white noise
    if (noise.gaussian) {
      const { amplitude } = noise.gaussian;
      for (let i = 0; i < signal.length; i++) {
        // Box-Muller transform for Gaussian distribution
        const u1 = Math.random();
        const u2 = Math.random();
        const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        noisySignal[i] += amplitude * gaussian;
      }
    }
    
    return noisySignal;
  }
  
  /**
   * Make rhythm irregular (for AFib simulation)
   */
  private makeIrregular(
    time: number[], 
    signal: number[], 
    baseHeartRate: number
  ): { time: number[]; signal: number[] } {
    const avgRR = 60 / baseHeartRate; // seconds
    const newTime: number[] = [];
    const newSignal: number[] = [];
    
    let currentTime = 0;
    let sourceIndex = 0;
    
    while (currentTime < time[time.length - 1] && sourceIndex < signal.length - 1) {
      // Random RR interval (0.4 to 1.5 times average)
      const rrInterval = avgRR * (0.4 + Math.random() * 1.1);
      
      // Find the portion of signal to copy
      const startTime = currentTime;
      const endTime = currentTime + rrInterval;
      
      // Copy signal segment
      while (sourceIndex < time.length && time[sourceIndex] < endTime) {
        const adjustedTime = startTime + (time[sourceIndex] % avgRR);
        if (adjustedTime <= time[time.length - 1]) {
          newTime.push(adjustedTime);
          newSignal.push(signal[sourceIndex]);
        }
        sourceIndex++;
      }
      
      currentTime = endTime;
      
      // Reset source index to beginning of a beat
      sourceIndex = Math.floor(sourceIndex / (avgRR * this.samplingRate)) * 
                   Math.floor(avgRR * this.samplingRate);
    }
    
    return { time: newTime, signal: newSignal };
  }
  
  /**
   * Add ST elevation for STEMI
   */
  private addSTElevation(signal: number[], time: number[]): number[] {
    const result = [...signal];
    const beatDuration = 60 / 70; // Approximate beat duration
    
    for (let i = 0; i < signal.length; i++) {
      const t = time[i] % beatDuration;
      // ST segment is approximately 0.35-0.44 of the cardiac cycle
      if (t > 0.35 * beatDuration && t < 0.44 * beatDuration) {
        // Add elevation that peaks at 0.3 mV
        const stPhase = (t - 0.35 * beatDuration) / (0.09 * beatDuration);
        result[i] += 0.3 * Math.exp(-Math.pow(stPhase - 0.5, 2) * 10);
      }
    }
    
    return result;
  }
  
  /**
   * Add U waves for hypokalemia
   */
  private addUWaves(signal: number[], time: number[], heartRate: number): number[] {
    const result = [...signal];
    const beatDuration = 60 / heartRate;
    
    for (let i = 0; i < signal.length; i++) {
      const t = time[i] % beatDuration;
      // U wave appears after T wave, around 0.65-0.8 of cardiac cycle
      if (t > 0.65 * beatDuration && t < 0.8 * beatDuration) {
        const uPhase = (t - 0.65 * beatDuration) / (0.15 * beatDuration);
        result[i] += 0.15 * Math.exp(-Math.pow(uPhase - 0.5, 2) / 0.05);
      }
    }
    
    return result;
  }
  
  /**
   * Add fibrillatory waves for atrial fibrillation
   */
  private addFibrillatoryWaves(signal: number[], time: number[]): number[] {
    const result = [...signal];
    
    // Add multiple frequency components between 350-600 Hz (coarse AFib)
    for (let i = 0; i < signal.length; i++) {
      let fibWave = 0;
      for (let freq = 350; freq <= 600; freq += 50) {
        fibWave += 0.02 * Math.sin(2 * Math.PI * freq * time[i] + Math.random() * 2 * Math.PI);
      }
      result[i] += fibWave;
    }
    
    return result;
  }
  
  /**
   * Simulate AV dissociation for complete heart block
   */
  private simulateAVDissociation(signal: number[]): number[] {
    // This is a simplified simulation
    // In reality, P waves would continue at their own rate
    // while QRS complexes occur at a slower, independent rate
    return signal; // TODO: Implement proper AV dissociation
  }
  
  /**
   * Generate continuous stream of ECG data
   */
  *generateStream(
    options: ECGGeneratorOptions = {},
    chunkDuration: number = 1
  ): Generator<ECGResult, void, unknown> {
    const totalDuration = options.duration || Infinity;
    let generatedDuration = 0;
    
    while (generatedDuration < totalDuration) {
      const remainingDuration = totalDuration - generatedDuration;
      const currentChunkDuration = Math.min(chunkDuration, remainingDuration);
      
      const chunk = this.generate({
        ...options,
        duration: currentChunkDuration
      });
      
      // Adjust time values
      chunk.time = chunk.time.map(t => t + generatedDuration);
      
      yield chunk;
      
      generatedDuration += currentChunkDuration;
      
      if (!isFinite(totalDuration)) {
        // For infinite streams, continue indefinitely
        continue;
      }
    }
  }
}
