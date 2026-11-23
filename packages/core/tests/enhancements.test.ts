import { describe, it, expect } from 'vitest';
import {
  HRVGenerator,
  QTCorrection,
  LeadMorphology,
  ArtifactGenerator,
  DemographicAdjustments,
  PathologyProgression,
  ExerciseResponse,
  ECGGenerator,
  getPathologyParams,
} from '../index.js';
import { mulberry32 } from '../math/random.js';
import { mean, std, detectPeaks, powerSpectrum } from './helpers.js';

describe('realistic-features (C16)', () => {
  it('HRVGenerator produces a continuous, reproducible RR sequence around the base RR', () => {
    const a = new HRVGenerator(mulberry32(1)).generateRRIntervals(0.8, 300);
    const b = new HRVGenerator(mulberry32(1)).generateRRIntervals(0.8, 300);
    expect(a).toEqual(b);
    expect(a.reduce((s, v) => s + v, 0)).toBeGreaterThanOrEqual(300);
    expect(mean(a)).toBeGreaterThan(0.77);
    expect(mean(a)).toBeLessThan(0.83);
    const sdnn = std(a);
    expect(sdnn).toBeGreaterThan(0.01);
    expect(sdnn).toBeLessThan(0.06);
    // successive RR intervals are correlated (smooth modulation + random walk, not white noise)
    const d = a.map(v => v - mean(a));
    let num = 0, den = 0;
    for (let i = 0; i < d.length; i++) { den += d[i] * d[i]; if (i) num += d[i] * d[i - 1]; }
    expect(num / den).toBeGreaterThan(0.3);
  });

  it('QTCorrection formulas', () => {
    expect(QTCorrection.bazett(0.4, 1)).toBeCloseTo(0.4);
    expect(QTCorrection.fridericia(0.32, 0.512)).toBeCloseTo(0.4);
    expect(QTCorrection.framingham(0.4, 1)).toBeCloseTo(0.4);
    expect(QTCorrection.fridericiaQT(0.4, 0.512)).toBeCloseTo(0.32);
    expect(QTCorrection.calculateQT(1, 'bazett')).toBeCloseTo(0.42);
    expect(QTCorrection.calculateQT(0.64, 'bazett', 0.4)).toBeCloseTo(0.32);
  });

  it('LeadMorphology projects precordial leads in the transverse plane', () => {
    const v = LeadMorphology.calculateLeadVectors();
    expect(v.V1.qrs).toBeLessThan(0);
    expect(v.V6.qrs).toBeGreaterThan(0.8);
    expect(v.aVR.qrs).toBeLessThan(-0.8);
    expect(v.II.qrs).toBeCloseTo(1);
    // frontal axis does not change precordial projections
    expect(LeadMorphology.calculateLeadVectors(-30).V1.qrs).toBeCloseTo(v.V1.qrs);
  });

  it('ArtifactGenerator: integer lengths and band-limited tremor of the requested RMS', () => {
    expect(ArtifactGenerator.electrodeMotion(1.0033, 360, mulberry32(2)).length).toBe(361);
    const tremor = ArtifactGenerator.muscleTremor(10, 500, 0.05, mulberry32(3));
    expect(tremor.length).toBe(5000);
    expect(std(tremor)).toBeGreaterThan(0.035);
    expect(std(tremor)).toBeLessThan(0.065);
    const { f, p } = powerSpectrum(tremor.slice(0, 2500), 500, 60, 0.5);
    const total = p.reduce((a, b) => a + b, 0);
    expect(p.filter((_, i) => f[i] >= 2 && f[i] <= 20).reduce((a, b) => a + b, 0) / total).toBeGreaterThan(0.85);
    const em = ArtifactGenerator.electrodeMotion(20, 250, mulberry32(4));
    expect(em.every(Number.isFinite)).toBe(true);
  });

  it('DemographicAdjustments returns a deep copy and adjusts the real parameters', () => {
    const base = getPathologyParams('normal');
    const snapshot = JSON.parse(JSON.stringify(base));
    const female = DemographicAdjustments.adjustParameters(base, { age: 40, gender: 'female' });
    const neonate = DemographicAdjustments.adjustParameters(base, { age: 0.2, gender: 'male' });
    expect(base).toEqual(snapshot);
    expect(female.R.amplitude).toBeLessThan(base.R.amplitude);
    expect(female.T.position).toBeGreaterThan(base.T.position);
    expect(neonate.heartRate).toBe(140);
    expect(neonate.R.width).toBeLessThan(base.R.width);
    expect(Math.abs(neonate.P.position)).toBeLessThan(Math.abs(base.P.position));
    expect(() => new ECGGenerator().generate({ duration: 2, customParams: neonate })).not.toThrow();
  });

  it('PathologyProgression produces ST elevation without mutating the input', () => {
    const base = getPathologyParams('normal');
    const snapshot = JSON.parse(JSON.stringify(base));
    const isch = PathologyProgression.simulateIschemiaProgression(1, base);
    expect(base).toEqual(snapshot);
    expect(isch.extraWaves?.length).toBe(1);
    expect(isch.Q.amplitude).toBeLessThan(base.Q.amplitude);
    const r = new ECGGenerator().generate({ duration: 4, customParams: { ...isch, respiratoryAmplitude: 0 } });
    const rr = 60 / isch.heartRate;
    const k = Math.round((0.5 * rr + rr) * 1000); // second R peak (first R at RR/2)
    expect(r.signal[k]).toBeGreaterThan(0.7);
    expect(r.signal[k + 110]).toBeGreaterThan(0.2);
    expect(PathologyProgression.simulateIschemiaProgression(0, base).extraWaves).toBeUndefined();
  });

  it('ExerciseResponse raises the rate and shortens QT through the model', () => {
    const base = getPathologyParams('normal');
    const ex = ExerciseResponse.simulateExercise(1, base, 30);
    expect(ex.heartRate).toBe(190);
    expect(base.heartRate).toBe(70);
    expect(base.extraWaves).toBeUndefined();
    const r = new ECGGenerator().generate({ duration: 3, customParams: ex });
    expect(r.metadata.heartRate).toBeCloseTo(190, 6);
  });
});
