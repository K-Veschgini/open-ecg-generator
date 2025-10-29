import { ECGGenerator, generateNormalECG, generatePathologicalECG } from '../index';

describe('ECGGenerator', () => {
  let generator: ECGGenerator;
  
  beforeEach(() => {
    generator = new ECGGenerator(1000);
  });
  
  describe('constructor', () => {
    it('should create generator with default sampling rate', () => {
      const gen = new ECGGenerator();
      expect(gen).toBeDefined();
    });
    
    it('should throw error for low sampling rate', () => {
      expect(() => new ECGGenerator(100)).toThrow('Sampling rate must be at least 250 Hz');
    });
  });
  
  describe('generate', () => {
    it('should generate normal ECG', () => {
      const result = generator.generate({
        duration: 1,
        heartRate: 70
      });
      
      expect(result.signal).toBeDefined();
      expect(result.time).toBeDefined();
      expect(result.signal.length).toBe(1000); // 1s at 1000Hz
      expect(result.time.length).toBe(1000);
      expect(result.metadata.heartRate).toBe(70);
      expect(result.metadata.pathology).toBe('normal');
    });
    
    it('should generate ECG with pathology', () => {
      const pathologies = [
        'bradycardia',
        'tachycardia',
        'atrialFibrillation',
        'ventricularTachycardia',
        'stemi',
        'firstDegreeAVBlock'
      ] as const;
      
      for (const pathology of pathologies) {
        const result = generator.generate({
          duration: 1,
          pathology
        });
        
        expect(result.metadata.pathology).toBe(pathology);
        expect(result.signal.length).toBeGreaterThan(0);
      }
    });
    
    it('should add noise when specified', () => {
      const cleanECG = generator.generate({ duration: 1 });
      const noisyECG = generator.generate({
        duration: 1,
        noise: {
          gaussian: { amplitude: 0.1 }
        }
      });
      
      // Calculate variance
      const cleanVar = variance(cleanECG.signal);
      const noisyVar = variance(noisyECG.signal);
      
      expect(noisyVar).toBeGreaterThan(cleanVar);
    });
  });
  
  describe('generateMultiLead', () => {
    it('should generate multiple leads', () => {
      const leads = ['I', 'II', 'III'];
      const result = generator.generateMultiLead(
        { duration: 1, heartRate: 70 },
        leads
      );
      
      expect(Object.keys(result)).toEqual(leads);
      
      for (const lead of leads) {
        expect(result[lead].signal).toBeDefined();
        expect(result[lead].signal.length).toBe(1000);
      }
    });
    
    it('should generate different amplitudes for different leads', () => {
      const result = generator.generateMultiLead(
        { duration: 1 },
        ['II', 'aVR']
      );
      
      const leadII = result['II'].signal;
      const leadAVR = result['aVR'].signal;
      
      // aVR should be inverted (negative)
      const maxII = Math.max(...leadII);
      const maxAVR = Math.max(...leadAVR);
      const minAVR = Math.min(...leadAVR);
      
      expect(maxII).toBeGreaterThan(0);
      expect(Math.abs(minAVR)).toBeGreaterThan(maxAVR);
    });
  });
  
  describe('generateStream', () => {
    it('should generate ECG stream', () => {
      const stream = generator.generateStream(
        { heartRate: 70 },
        1 // 1 second chunks
      );
      
      const chunks: any[] = [];
      for (let i = 0; i < 3; i++) {
        const result = stream.next();
        if (!result.done) {
          chunks.push(result.value);
        }
      }
      
      expect(chunks.length).toBe(3);
      expect(chunks[0].signal.length).toBe(1000);
      expect(chunks[2].time[0]).toBeCloseTo(2, 1);
    });
  });
});

describe('Quick functions', () => {
  it('should generate normal ECG', () => {
    const { time, signal } = generateNormalECG(1, 70, 1000);
    
    expect(signal.length).toBe(1000);
    expect(time.length).toBe(1000);
  });
  
  it('should generate pathological ECG', () => {
    const { signal } = generatePathologicalECG('bradycardia', 1, 1000);
    
    expect(signal.length).toBe(1000);
  });
});

// Helper function to calculate variance
function variance(data: number[]): number {
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  return data.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / data.length;
}
