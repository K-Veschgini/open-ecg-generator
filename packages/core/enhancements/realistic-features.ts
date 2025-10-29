/**
 * Enhanced features for more realistic ECG generation
 */

/**
 * Heart Rate Variability (HRV) generator
 * Combines multiple frequency components to simulate natural variations
 */
export class HRVGenerator {
  private time: number = 0;
  
  /**
   * Generate realistic RR intervals with HRV
   */
  generateRRIntervals(
    baseRR: number,  // seconds
    duration: number,
    params: {
      respiratoryRate?: number;  // breaths per minute
      lfPower?: number;          // Low frequency power (0.04-0.15 Hz)
      hfPower?: number;          // High frequency power (0.15-0.4 Hz)
      vlfPower?: number;         // Very low frequency power (0.003-0.04 Hz)
    } = {}
  ): number[] {
    const {
      respiratoryRate = 15,
      lfPower = 0.04,
      hfPower = 0.06,
      vlfPower = 0.02
    } = params;
    
    const rrIntervals: number[] = [];
    let currentTime = 0;
    
    while (currentTime < duration) {
      // Respiratory sinus arrhythmia (RSA)
      const rsaFreq = respiratoryRate / 60; // Hz
      const rsa = hfPower * Math.sin(2 * Math.PI * rsaFreq * this.time);
      
      // Low frequency component (sympathetic + parasympathetic)
      const lf = lfPower * Math.sin(2 * Math.PI * 0.1 * this.time);
      
      // Very low frequency component
      const vlf = vlfPower * Math.sin(2 * Math.PI * 0.01 * this.time);
      
      // Random walk component
      const randomWalk = (Math.random() - 0.5) * 0.02;
      
      // Calculate varied RR interval
      const rrVariation = rsa + lf + vlf + randomWalk;
      const currentRR = baseRR * (1 + rrVariation);
      
      rrIntervals.push(currentRR);
      currentTime += currentRR;
      this.time += currentRR;
    }
    
    return rrIntervals;
  }
}

/**
 * Ectopic beat generator for PVCs, PACs, etc.
 */
export interface EctopicBeat {
  type: 'PVC' | 'PAC' | 'PJC';
  timing: number;  // When it occurs (0-1 within RR interval)
  coupling: number; // Coupling interval as fraction of normal RR
}

export class EctopicBeatGenerator {
  /**
   * Generate premature ventricular contractions (PVCs)
   */
  static generatePVC(): {
    qrsWidth: number;
    qrsAmplitude: number;
    tWaveInversion: boolean;
    compensatoryPause: boolean;
  } {
    return {
      qrsWidth: 0.16 + Math.random() * 0.04,  // Wide QRS (160-200ms)
      qrsAmplitude: 1.5 + Math.random() * 0.5,
      tWaveInversion: true,
      compensatoryPause: true
    };
  }
  
  /**
   * Generate premature atrial contractions (PACs)
   */
  static generatePAC(): {
    pWaveMorphology: number;  // Different P wave shape
    prInterval: number;
    compensatoryPause: boolean;
  } {
    return {
      pWaveMorphology: 0.5 + Math.random() * 0.3,
      prInterval: 0.12 + Math.random() * 0.08,
      compensatoryPause: false  // Non-compensatory
    };
  }
}

/**
 * QT interval correction based on heart rate
 */
export class QTCorrection {
  /**
   * Bazett's formula: QTc = QT / √RR
   */
  static bazett(qt: number, rr: number): number {
    return qt / Math.sqrt(rr);
  }
  
  /**
   * Fridericia's formula: QTc = QT / ∛RR
   */
  static fridericia(qt: number, rr: number): number {
    return qt / Math.pow(rr, 1/3);
  }
  
  /**
   * Framingham formula: QTc = QT + 0.154(1 - RR)
   */
  static framingham(qt: number, rr: number): number {
    return qt + 0.154 * (1 - rr);
  }
  
  /**
   * Calculate appropriate QT interval for given RR
   */
  static calculateQT(rr: number, method: 'bazett' | 'fridericia' | 'framingham' = 'bazett'): number {
    const normalQTc = 0.42; // Normal QTc in seconds
    
    switch (method) {
      case 'bazett':
        return normalQTc * Math.sqrt(rr);
      case 'fridericia':
        return normalQTc * Math.pow(rr, 1/3);
      case 'framingham':
        return normalQTc - 0.154 * (1 - rr);
    }
  }
}

/**
 * Lead-specific morphology generator
 */
export class LeadMorphology {
  /**
   * Calculate lead vectors based on Einthoven's triangle
   */
  static calculateLeadVectors(heartAxis: number = 60): { [lead: string]: { p: number; qrs: number; t: number } } {
    // Heart axis in radians
    const axisRad = heartAxis * Math.PI / 180;
    
    // Lead angles in degrees (approximate)
    const leadAngles = {
      I: 0,
      II: 60,
      III: 120,
      aVR: -150,
      aVL: -30,
      aVF: 90,
      V1: 120,  // More rightward
      V2: 90,
      V3: 75,
      V4: 60,
      V5: 30,
      V6: 0     // More leftward
    };
    
    const morphologies: { [lead: string]: { p: number; qrs: number; t: number } } = {};
    
    for (const [lead, angle] of Object.entries(leadAngles)) {
      const leadRad = angle * Math.PI / 180;
      const projection = Math.cos(axisRad - leadRad);
      
      morphologies[lead] = {
        p: projection * 0.8,  // P wave follows atrial vector
        qrs: projection,      // QRS follows ventricular vector
        t: projection * 0.7   // T wave slightly different angle
      };
    }
    
    return morphologies;
  }
}

/**
 * Artifact generator for ultra-realistic noise
 */
export class ArtifactGenerator {
  /**
   * Generate electrode motion artifact
   */
  static electrodeMotion(duration: number, samplingRate: number): number[] {
    const samples = duration * samplingRate;
    const artifact = new Array(samples);
    
    // Random walk with occasional spikes
    let current = 0;
    for (let i = 0; i < samples; i++) {
      current += (Math.random() - 0.5) * 0.01;
      current *= 0.99; // Decay factor
      
      // Occasional spike
      if (Math.random() < 0.001) {
        current += (Math.random() - 0.5) * 0.5;
      }
      
      artifact[i] = current;
    }
    
    return artifact;
  }
  
  /**
   * Generate muscle tremor artifact
   */
  static muscleTremor(duration: number, samplingRate: number, intensity: number = 0.05): number[] {
    const samples = duration * samplingRate;
    const artifact = new Array(samples);
    
    // Multiple frequency components (8-30 Hz typical for tremor)
    for (let i = 0; i < samples; i++) {
      const t = i / samplingRate;
      artifact[i] = 0;
      
      // Add multiple tremor frequencies
      for (let freq = 8; freq <= 30; freq += 2) {
        artifact[i] += intensity * Math.random() * 
          Math.sin(2 * Math.PI * freq * t + Math.random() * 2 * Math.PI);
      }
    }
    
    return artifact;
  }
}

/**
 * Age and gender-specific ECG parameters
 */
export interface DemographicParams {
  age: number;
  gender: 'male' | 'female';
}

export class DemographicAdjustments {
  /**
   * Adjust ECG parameters based on demographics
   */
  static adjustParameters(baseParams: any, demographics: DemographicParams): any {
    const adjusted = { ...baseParams };
    
    // Age adjustments
    if (demographics.age < 1) {
      // Neonatal: faster HR, shorter intervals
      adjusted.heartRate = 120 + Math.random() * 40;
      adjusted.PR.duration *= 0.8;
      adjusted.QRS.duration *= 0.7;
    } else if (demographics.age < 10) {
      // Pediatric
      adjusted.heartRate = 80 + Math.random() * 20;
      adjusted.PR.duration *= 0.9;
    } else if (demographics.age > 65) {
      // Elderly: longer intervals, lower amplitudes
      adjusted.PR.duration *= 1.1;
      adjusted.QRS.duration *= 1.05;
      adjusted.P.amplitude *= 0.9;
    }
    
    // Gender adjustments
    if (demographics.gender === 'female') {
      // Females typically have:
      adjusted.QT.duration *= 1.03;  // Slightly longer QT
      adjusted.QRS.amplitude *= 0.85; // Lower QRS amplitude
      adjusted.heartRate += 3;        // Slightly higher HR
    }
    
    return adjusted;
  }
}

/**
 * Pathology progression simulator
 */
export class PathologyProgression {
  /**
   * Simulate gradual onset of ischemia
   */
  static simulateIschemiaProgression(
    timePoint: number,  // 0-1, where 1 is full ischemia
    baseParams: any
  ): any {
    const adjusted = { ...baseParams };
    
    // Progressive ST elevation
    adjusted.ST.elevation = timePoint * 0.3; // Up to 3mm
    
    // T wave changes
    adjusted.T.amplitude *= (1 + timePoint * 0.5); // Hyperacute T waves
    adjusted.T.width *= (1 + timePoint * 0.2);
    
    // Q wave development (later stage)
    if (timePoint > 0.5) {
      adjusted.Q.amplitude = -0.1 * (timePoint - 0.5) * 2;
      adjusted.Q.width = 0.04 * (timePoint - 0.5) * 2;
    }
    
    return adjusted;
  }
}

/**
 * Exercise/stress response simulator
 */
export class ExerciseResponse {
  /**
   * Simulate ECG changes during exercise
   */
  static simulateExercise(
    intensity: number,  // 0-1, where 1 is maximum effort
    baseParams: any
  ): any {
    const adjusted = { ...baseParams };
    
    // Heart rate increases linearly with intensity
    const maxHR = 220 - 30; // Assuming 30 years old
    adjusted.heartRate = 70 + (maxHR - 70) * intensity;
    
    // PR interval shortens
    adjusted.PR.duration *= (1 - 0.2 * intensity);
    
    // QT interval changes (but QTc remains relatively stable)
    const rr = 60 / adjusted.heartRate;
    adjusted.QT.duration = QTCorrection.calculateQT(rr);
    
    // J-point depression (common in exercise)
    adjusted.J.depression = intensity * 0.1; // Up to 1mm
    
    // Increased P wave amplitude (atrial contribution)
    adjusted.P.amplitude *= (1 + 0.3 * intensity);
    
    return adjusted;
  }
}
