import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECGGenerator,
  generateNormalECG,
  generatePathologicalECG,
  getPathologyParams,
  PATHOLOGY_DEFAULT_HEART_RATE,
  PATHOLOGY_PARAMS,
  ENHANCED_PATHOLOGY_PARAMS,
  DEFAULT_ECGSYN_PARAMS,
  PATHOLOGY_TYPES,
  VERSION,
  type PathologyType,
  type ECGResult,
} from '../index.js';
import { correlation, detectPeaks, mean, powerSpectrum, std, argExt } from './helpers.js';
import { FibrillatoryWaves } from '../models/noise.js';
import { hashSeed, mulberry32, RandomStreams } from '../math/random.js';
import { generateECGSyn } from '../models/ecgsyn.js';
import { ECGSynth } from '../models/synth.js';
import { HEART_RATE_RANGE } from '../models/types.js';

const LEADS12 = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

function checkInvariants(r: ECGResult, duration: number, fs: number) {
  const n = Math.round(duration * fs);
  expect(r.signal.length).toBe(n);
  expect(r.time.length).toBe(n);
  expect(r.samplingRate).toBe(fs);
  for (let i = 0; i < n; i++) {
    if (r.time[i] !== i / fs) throw new Error(`time[${i}] = ${r.time[i]} != ${i / fs}`);
    if (!Number.isFinite(r.signal[i])) throw new Error(`signal[${i}] not finite`);
  }
}

describe('ECGGenerator', () => {
  let generator: ECGGenerator;

  beforeEach(() => {
    generator = new ECGGenerator(1000);
  });

  describe('constructor', () => {
    it('creates a generator with the default sampling rate', () => {
      expect(new ECGGenerator()).toBeDefined();
    });

    it('throws for a low or invalid sampling rate', () => {
      expect(() => new ECGGenerator(100)).toThrow('Sampling rate must be at least 250 Hz');
      expect(() => new ECGGenerator(NaN)).toThrow('Sampling rate');
    });
  });

  describe('output invariants (C4, C11)', () => {
    it.each(PATHOLOGY_TYPES as PathologyType[])('%s: length, uniform time axis, finite values', pathology => {
      for (const [duration, fs] of [[3, 1000], [2.5037, 250], [4, 500]] as const) {
        const r = generator.generate({ pathology, duration, samplingRate: fs, seed: 11 });
        checkInvariants(r, duration, fs);
        expect(r.metadata.pathology).toBe(pathology);
      }
      const noisy = generator.generate({
        pathology, duration: 2, seed: 3, variation: 1,
        noise: { gaussian: { amplitude: 0.02 }, muscle: { amplitude: 0.02 }, baseline: { amplitude: 0.1, frequency: 0.3 }, powerline: { amplitude: 0.02, frequency: 50 } },
      });
      checkInvariants(noisy, 2, 1000);
      const multi = generator.generateMultiLead({ pathology, duration: 2, samplingRate: 500, seed: 5 });
      for (const lead of LEADS12) checkInvariants(multi[lead], 2, 500);
    });

    it('uses the per-call sampling rate', () => {
      const r = generator.generate({ duration: 2, samplingRate: 360, pathology: 'atrialFibrillation' });
      checkInvariants(r, 2, 360);
    });

    it('reports the actual mean ventricular rate', () => {
      expect(generator.generate({ duration: 10, heartRate: 72 }).metadata.heartRate).toBeCloseTo(72, 6);
      expect(generator.generate({ duration: 10, pathology: 'bradycardia' }).metadata.heartRate).toBeCloseTo(45, 6);
      const af = generator.generate({ duration: 60, pathology: 'atrialFibrillation', seed: 2 });
      expect(af.metadata.heartRate).toBeGreaterThan(100);
      expect(af.metadata.heartRate).toBeLessThan(120);
      const peaks = detectPeaks(af.signal, 1000);
      const measured = 60 / mean(peaks.slice(1).map((p, i) => (p - peaks[i]) / 1000));
      expect(Math.abs(measured - af.metadata.heartRate)).toBeLessThan(3);
    });
  });

  describe('parameter resolution', () => {
    it('heartRate option overrides the preset rate, otherwise the preset rate is used', () => {
      expect(generator.resolveParams({ pathology: 'tachycardia' }).heartRate).toBe(140);
      expect(generator.resolveParams({ pathology: 'tachycardia', heartRate: 120 }).heartRate).toBe(120);
      expect(generator.resolveParams({ pathology: 'ventricularTachycardia' }).heartRate).toBe(180);
      expect(generator.resolveParams({}).heartRate).toBe(70);
    });

    it('customParams override last and only for provided fields', () => {
      const R = { amplitude: 2, width: 0.07, position: 0 };
      const p = generator.resolveParams({ pathology: 'stemi', heartRate: 90, variation: 0.8, seed: 1, customParams: { R } });
      expect(p.R).toEqual(R);
      expect(p.heartRate).toBe(90);
      expect(p.extraWaves?.length).toBe(1); // preset ST elevation kept
      const q = generator.resolveParams({ pathology: 'stemi', heartRate: 90, customParams: { heartRate: 50 } });
      expect(q.heartRate).toBe(50);
      expect(q.T).toEqual(getPathologyParams('stemi').T);
    });

    it('variation jitters the resolved preset but keeps its morphology', () => {
      const base = getPathologyParams('lbbb');
      const v = generator.resolveParams({ pathology: 'lbbb', variation: 0.5, seed: 9 });
      expect(v.R.amplitude).not.toBe(base.R.amplitude);
      expect(Math.sign(v.T.amplitude)).toBe(Math.sign(base.T.amplitude));
      expect(v.R.amplitude / base.R.amplitude).toBeGreaterThan(0.7);
      expect(v.R.amplitude / base.R.amplitude).toBeLessThan(1.3);
      expect(v.extraWaves?.length).toBe(base.extraWaves?.length);
      expect(generator.resolveParams({ pathology: 'lbbb' })).toEqual(base); // variation 0: exact preset
      // variation adds HRV to sinus rhythm
      const r = generator.generate({ duration: 30, variation: 1, seed: 4 });
      const peaks = detectPeaks(r.signal, 1000);
      const rr = peaks.slice(1).map((p, i) => p - peaks[i]);
      expect(std(rr)).toBeGreaterThan(5); // ms
      expect(std(rr) / mean(rr)).toBeLessThan(0.1);
    });

    it('presets are deterministic deep copies', () => {
      const a = getPathologyParams('hypokalemia');
      const b = getPathologyParams('hypokalemia');
      expect(a).toEqual(b);
      a.T.amplitude = 99;
      a.extraWaves![0].amplitude = 99;
      expect(getPathologyParams('hypokalemia')).toEqual(b);
      expect(getPathologyParams('normal', 55).heartRate).toBe(55);
      for (const p of PATHOLOGY_TYPES) {
        expect(getPathologyParams(p).heartRate).toBe(PATHOLOGY_DEFAULT_HEART_RATE[p]);
        expect(PATHOLOGY_PARAMS[p](DEFAULT_ECGSYN_PARAMS)).toEqual(getPathologyParams(p));
        expect(ENHANCED_PATHOLOGY_PARAMS[p]()).toEqual(getPathologyParams(p));
      }
      expect(PATHOLOGY_DEFAULT_HEART_RATE).toMatchObject({
        normal: 70, bradycardia: 45, tachycardia: 140, ventricularTachycardia: 180, atrialFibrillation: 110, completeHeartBlock: 40,
      });
      expect(DEFAULT_ECGSYN_PARAMS).toEqual(getPathologyParams('normal'));
      expect(VERSION).toBe('1.0.0');
    });
  });

  describe('validation (C13, C14)', () => {
    const bad: [string, () => unknown][] = [
      ['width 0', () => generator.generate({ customParams: { R: { amplitude: 1, width: 0, position: 0 } } })],
      ['negative width', () => generator.generate({ customParams: { T: { amplitude: 0.3, width: -1, position: 1.5 } } })],
      ['NaN amplitude', () => generator.generate({ customParams: { P: { amplitude: NaN, width: 0.1, position: -1 } } })],
      ['Infinity position', () => generator.generate({ customParams: { S: { amplitude: -0.2, width: 0.05, position: Infinity } } })],
      ['extra wave width 0', () => generator.generate({ customParams: { extraWaves: [{ amplitude: 0.1, width: 0, position: 2 }] } })],
      ['heartRate 0', () => generator.generate({ heartRate: 0 })],
      ['heartRate negative', () => generator.generate({ heartRate: -60 })],
      ['heartRate NaN', () => generator.generate({ heartRate: NaN })],
      ['heartRate Infinity', () => generator.generate({ heartRate: Infinity })],
      ['custom heartRate 0', () => generator.generate({ customParams: { heartRate: 0 } })],
      ['heartRate 3000', () => generator.generate({ heartRate: 3000 })],
      ['heartRate 1e6', () => generator.generate({ heartRate: 1e6 })],
      ['heartRate 1e-3', () => generator.generate({ heartRate: 1e-3 })],
      ['heartRate 5', () => generator.generate({ heartRate: 5 })],
      ['custom heartRate 10000', () => generator.generate({ customParams: { heartRate: 10000 } })],
      ['getPathologyParams heartRate 400', () => getPathologyParams('normal', 400)],
      ['huge T width', () => generator.generate({ duration: 1, customParams: { T: { amplitude: 0.3, width: 1e7, position: 1.5 } } })],
      ['huge P width', () => generator.generate({ duration: 1, customParams: { P: { amplitude: 0.1, width: 1e5, position: -1 } } })],
      ['width just above pi', () => generator.generate({ duration: 1, customParams: { T: { amplitude: 0.3, width: 3.2, position: 1.5 } } })],
      ['huge negative P position', () => generator.generate({ duration: 1, customParams: { P: { amplitude: 0.1, width: 0.1, position: -1e7 } } })],
      ['huge R position', () => generator.generate({ duration: 1, customParams: { R: { amplitude: 1, width: 0.06, position: 1e7 } } })],
      ['extra wave position 7', () => generator.generate({ duration: 1, customParams: { extraWaves: [{ amplitude: 0.1, width: 0.1, position: 7 }] } })],
      ['generateECGSyn 100 Hz', () => generateECGSyn(1, 100, getPathologyParams('normal'))],
      ['generateECGSyn huge width', () => generateECGSyn(1, 500, { ...getPathologyParams('normal'), T: { amplitude: 0.3, width: 1e6, position: 1.5 } })],
      ['ECGSynth huge position', () => new ECGSynth({
        params: { ...getPathologyParams('normal'), P: { amplitude: 0.1, width: 0.1, position: -1e7 } },
        pathology: 'normal', samplingRate: 500, tolerance: 1e-6, leads: ['II'], variation: 0, streams: new RandomStreams(1),
      })],
      ['duration 0', () => generator.generate({ duration: 0 })],
      ['duration negative', () => generator.generate({ duration: -1 })],
      ['duration NaN', () => generator.generate({ duration: NaN })],
      ['samplingRate 100', () => generator.generate({ samplingRate: 100 })],
      ['unknown pathology', () => generator.generate({ pathology: 'flutter' as PathologyType })],
      ['variation > 1', () => generator.generate({ variation: 2 })],
      ['tolerance 0', () => generator.generate({ solverTolerance: 0 })],
      ['negative noise', () => generator.generate({ noise: { gaussian: { amplitude: -1 } } })],
      ['multi-lead width 0', () => generator.generateMultiLead({ customParams: { Q: { amplitude: -0.1, width: 0, position: -0.1 } } })],
      ['unknown lead', () => generator.generateMultiLead({}, ['II', 'V7'])],
      ['stream chunk 0', () => generator.generateStream({}, 0).next()],
      ['stream invalid heartRate (eager, no next())', () => generator.generateStream({ heartRate: -1 }, 1)],
      ['stream invalid width (eager, no next())', () => generator.generateStream({ customParams: { T: { amplitude: 0.3, width: 0, position: 1.5 } } })],
    ];
    it.each(bad)('%s throws quickly', (_name, fn) => {
      const t0 = performance.now();
      expect(fn).toThrow(Error);
      expect(performance.now() - t0).toBeLessThan(200);
    });

    it('accepts the documented heart-rate and wave-parameter range limits', () => {
      for (const heartRate of [HEART_RATE_RANGE.min, HEART_RATE_RANGE.max]) {
        const r = generator.generate({ duration: 3, heartRate, samplingRate: 500 });
        checkInvariants(r, 3, 500);
        expect(r.metadata.heartRate).toBeCloseTo(heartRate, 6);
      }
      const r = generator.generate({
        duration: 2, samplingRate: 250,
        customParams: { T: { amplitude: 0.3, width: Math.PI, position: 2 * Math.PI }, P: { amplitude: 0.1, width: 0.1, position: -2 * Math.PI } },
      });
      checkInvariants(r, 2, 250);
      const syn = generateECGSyn(1, 250);
      expect(syn.ecg.length).toBe(250);
      expect(syn.ecg.every(Number.isFinite)).toBe(true);
    });
  });

  describe('noise (C15)', () => {
    it('adds noise of the requested size', () => {
      const clean = generator.generate({ duration: 5, seed: 1 });
      const noisy = generator.generate({ duration: 5, seed: 1, noise: { gaussian: { amplitude: 0.05 } } });
      const diff = noisy.signal.map((v, i) => v - clean.signal[i]);
      expect(std(diff)).toBeGreaterThan(0.045);
      expect(std(diff)).toBeLessThan(0.055);
    });

    it('muscle noise is band-limited (20-150 Hz) with the requested RMS', () => {
      const clean = generator.generate({ duration: 4, seed: 1 });
      const noisy = generator.generate({ duration: 4, seed: 1, noise: { muscle: { amplitude: 0.05 } } });
      const diff = noisy.signal.map((v, i) => v - clean.signal[i]);
      expect(std(diff)).toBeGreaterThan(0.04);
      expect(std(diff)).toBeLessThan(0.06);
      const sub = diff.slice(0, 2000);
      const { f, p } = powerSpectrum(sub, 1000, 400, 2);
      const total = p.reduce((a, b) => a + b, 0);
      const inBand = p.filter((_, i) => f[i] >= 14 && f[i] <= 200).reduce((a, b) => a + b, 0);
      expect(inBand / total).toBeGreaterThan(0.85);
      const low = p.filter((_, i) => f[i] < 8).reduce((a, b) => a + b, 0);
      expect(low / total).toBeLessThan(0.02);
    });

    it('baseline wander and powerline are phase-continuous sinusoids', () => {
      const clean = generator.generate({ duration: 4, seed: 1 });
      const noisy = generator.generate({ duration: 4, seed: 1, noise: { powerline: { amplitude: 0.1, frequency: 50 } } });
      const d = noisy.signal.map((v, i) => v - clean.signal[i]);
      const amp = Math.max(...d);
      for (let i = 1; i < d.length; i++) {
        expect(Math.abs(d[i] - d[i - 1])).toBeLessThan(2 * Math.PI * 50 * amp / 1000 * 1.01);
      }
    });
  });

  describe('seed reproducibility', () => {
    it('same seed -> identical output; different seeds / no seed -> different', () => {
      const opts = {
        duration: 5, pathology: 'atrialFibrillation' as const, variation: 0.7,
        noise: { gaussian: { amplitude: 0.02 }, muscle: { amplitude: 0.01 } },
      };
      const a = generator.generate({ ...opts, seed: 42 });
      const b = generator.generate({ ...opts, seed: 42 });
      const c = generator.generate({ ...opts, seed: 43 });
      expect(a.signal).toEqual(b.signal);
      expect(a.signal).not.toEqual(c.signal);
      const m1 = generator.generateMultiLead({ ...opts, seed: 42 });
      const m2 = generator.generateMultiLead({ ...opts, seed: 42 });
      for (const l of LEADS12) expect(m1[l].signal).toEqual(m2[l].signal);
      // distinct seeds never share a stream family (0 / -0 are the same seed)
      const noiseOnly = (seed: number) => generator.generate({ duration: 1, seed, noise: { gaussian: { amplitude: 0.05 } } }).signal;
      const seeds = [0, -1, 0.5, 1, 4294967296, 4294967297, -4294967296, 1e-320, 2 ** 53];
      const sigs = seeds.map(noiseOnly);
      for (let i = 0; i < seeds.length; i++) {
        for (let j = i + 1; j < seeds.length; j++) expect(sigs[i]).not.toEqual(sigs[j]);
      }
      expect(noiseOnly(-0)).toEqual(sigs[0]);
      expect(noiseOnly(0.5)).toEqual(sigs[2]);
      // integer seeds in [0, 2^32) keep their historical streams
      expect(new RandomStreams(123).stream('x')()).toBe(mulberry32(hashSeed(123, 'x'))());
      const u1 = generator.generate({ ...opts });
      const u2 = generator.generate({ ...opts });
      expect(u1.signal).not.toEqual(u2.signal);
      // presets without randomness are deterministic even without a seed
      expect(generator.generate({ duration: 2 }).signal).toEqual(generator.generate({ duration: 2 }).signal);
    });
  });

  describe('atrial fibrillation f-waves (C5)', () => {
    it('are 4-9 Hz, small, phase-continuous; >90 % of power below 12 Hz', () => {
      const fw = new FibrillatoryWaves(mulberry32(5));
      const fs = 250;
      const x: number[] = [];
      for (let i = 0; i < 20 * fs; i++) x.push(fw.next(i / fs));
      const { f, p } = powerSpectrum(x, fs, 60, 0.25);
      const total = p.reduce((a, b) => a + b, 0);
      const below12 = p.filter((_, i) => f[i] < 12).reduce((a, b) => a + b, 0);
      expect(below12 / total).toBeGreaterThan(0.9);
      const peakF = f[p.indexOf(Math.max(...p))];
      expect(peakF).toBeGreaterThan(4);
      expect(peakF).toBeLessThan(9);
      expect(Math.max(...x.map(Math.abs))).toBeLessThan(0.15);
      expect(std(x)).toBeGreaterThan(0.02);
      for (let i = 1; i < x.length; i++) expect(Math.abs(x[i] - x[i - 1])).toBeLessThan(0.05);
    });

    it('are visible in V1 between QRS complexes and absent from sinus rhythm', () => {
      const af = generator.generateMultiLead({ duration: 10, pathology: 'atrialFibrillation', seed: 8 }, ['V1', 'II']);
      const sinus = generator.generateMultiLead({ duration: 10, seed: 8, customParams: { respiratoryAmplitude: 0 } }, ['V1', 'II']);
      /** samples of `s` in the T-P/T-Q gap (after T, before the next P / QRS) of the beats found in `ref` */
      const tq = (s: number[], ref: number[], afterR: number, beforeR: number) => {
        const peaks = detectPeaks(ref, 1000);
        const vals: number[] = [];
        for (let k = 0; k + 1 < peaks.length; k++) {
          const a = peaks[k] + afterR, b = peaks[k + 1] - beforeR;
          for (let i = a; i < b; i++) vals.push(s[i]);
        }
        return vals;
      };
      const afTQ = tq(af['V1'].signal, af['II'].signal, 450, 80);
      expect(afTQ.length).toBeGreaterThan(1000);
      expect(std(afTQ)).toBeGreaterThan(0.02);
      // sinus at 70 bpm: T ends ~R+400 ms, P starts ~R'-230 ms -> the 400..630 ms gap is isoelectric
      const sinusTQ = tq(sinus['V1'].signal, sinus['II'].signal, 450, 240);
      expect(sinusTQ.length).toBeGreaterThan(500);
      expect(std(sinusTQ)).toBeLessThan(0.005);
    });
  });

  describe('generateMultiLead (C10)', () => {
    it('returns the requested leads in order (default: all 12)', () => {
      const r = generator.generateMultiLead({ duration: 1 }, ['I', 'II', 'III']);
      expect(Object.keys(r)).toEqual(['I', 'II', 'III']);
      expect(Object.keys(generator.generateMultiLead({ duration: 1 }))).toEqual(LEADS12);
    });

    it('limb leads satisfy Einthoven / Goldberger exactly, also with noise', () => {
      for (const opts of [
        { duration: 4, pathology: 'stemi' as const },
        { duration: 4, pathology: 'atrialFibrillation' as const, seed: 3, noise: { gaussian: { amplitude: 0.05 }, baseline: { amplitude: 0.2, frequency: 0.2 } } },
      ]) {
        const r = generator.generateMultiLead(opts);
        const I = r['I'].signal, II = r['II'].signal;
        for (let i = 0; i < I.length; i++) {
          expect(Math.abs(r['III'].signal[i] - (II[i] - I[i]))).toBeLessThan(1e-12);
          expect(Math.abs(r['aVR'].signal[i] + (I[i] + II[i]) / 2)).toBeLessThan(1e-12);
          expect(Math.abs(r['aVL'].signal[i] - (I[i] - II[i] / 2))).toBeLessThan(1e-12);
          expect(Math.abs(r['aVF'].signal[i] - (II[i] - I[i] / 2))).toBeLessThan(1e-12);
          expect(Math.abs(I[i] + r['III'].signal[i] - II[i])).toBeLessThan(1e-12);
        }
      }
    });

    it('leads are not scaled copies and show precordial R-wave progression', () => {
      const r = generator.generateMultiLead({ duration: 5, customParams: { respiratoryAmplitude: 0 } });
      const peaks = detectPeaks(r['II'].signal, 1000);
      const k = peaks[2];
      const rs = (lead: string) => {
        const s = r[lead].signal;
        const R = Math.max(...s.slice(k - 60, k + 60));
        const S = -Math.min(...s.slice(k - 60, k + 60));
        return { R, S };
      };
      const v = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map(rs);
      expect(v[0].S).toBeGreaterThan(2 * v[0].R); // V1: rS, predominantly negative
      expect(v[1].S).toBeGreaterThan(v[1].R);
      expect(v[4].R).toBeGreaterThan(3 * v[4].S); // V5 tall R
      expect(v[5].R).toBeGreaterThan(3 * v[5].S);
      expect(v[4].R).toBeGreaterThan(1.2);
      const ratio = v.map(x => x.R / x.S);
      for (let i = 1; i < 5; i++) expect(ratio[i]).toBeGreaterThan(ratio[i - 1]); // progression V1..V5
      // transition at V3-V4
      expect(ratio[1]).toBeLessThan(1);
      expect(ratio[3]).toBeGreaterThan(1);
      // small septal q in V5/V6, none in V1
      expect(Math.min(...r['V6'].signal.slice(k - 50, k - 15))).toBeLessThan(-0.05);
      expect(Math.min(...r['V1'].signal.slice(k - 50, k - 15))).toBeGreaterThan(-0.02);
      // aVR inverted
      expect(Math.min(...r['aVR'].signal.slice(k - 60, k + 60))).toBeLessThan(-0.5);
      expect(r['aVR'].signal[k]).toBeLessThan(0);
      // not scaled copies: correlation between V1 and II clearly below 1
      expect(Math.abs(correlation(r['V1'].signal, r['II'].signal))).toBeLessThan(0.9);
    });

    it('all leads share the same beat timing', () => {
      const r = generator.generateMultiLead({ duration: 10, pathology: 'atrialFibrillation', seed: 1 }, ['II', 'V5', 'I']);
      const a = detectPeaks(r['II'].signal, 1000);
      const b = detectPeaks(r['V5'].signal, 1000);
      expect(a.length).toBe(b.length);
      for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(5);
      expect(r['II'].metadata.heartRate).toBe(r['V5'].metadata.heartRate);
    });

    it('noise is independent per lead (not a scaled copy)', () => {
      const noise = { gaussian: { amplitude: 0.05 } };
      const clean = generator.generateMultiLead({ duration: 4, seed: 6 });
      const noisy = generator.generateMultiLead({ duration: 4, seed: 6, noise });
      const res = (l: string) => noisy[l].signal.map((v, i) => v - clean[l].signal[i]);
      expect(Math.abs(correlation(res('V1'), res('V2')))).toBeLessThan(0.1);
      expect(Math.abs(correlation(res('I'), res('II')))).toBeLessThan(0.1);
      expect(Math.abs(correlation(res('V5'), res('II')))).toBeLessThan(0.1);
    });

    it('every lead is independent of which other leads were requested', () => {
      for (const opts of [
        { duration: 3, pathology: 'rbbb' as const, seed: 2, noise: { gaussian: { amplitude: 0.01 } } },
        { duration: 4, pathology: 'stemi' as const, seed: 2 },
        { duration: 4, pathology: 'atrialFibrillation' as const, seed: 5, noise: { muscle: { amplitude: 0.01 } } },
      ]) {
        const single = generator.generate(opts).signal;
        const all = generator.generateMultiLead(opts);
        expect(all['II'].signal).toEqual(single);
        expect(generator.generateMultiLead(opts, ['II', 'II'])['II'].signal).toEqual(single);
        expect(generator.generateMultiLead(opts, ['V1', 'II'])['II'].signal).toEqual(single);
        expect(generator.generateMultiLead(opts, ['aVF'])['aVF'].signal).toEqual(all['aVF'].signal);
        expect(generator.generateMultiLead(opts, ['V4'])['V4'].signal).toEqual(all['V4'].signal);
      }
    });

    it('each lead has its own time array', () => {
      const m = generator.generateMultiLead({ duration: 1 }, ['I', 'II', 'V1']);
      expect(m['I'].time).not.toBe(m['II'].time);
      expect(m['II'].time).not.toBe(m['V1'].time);
      expect(m['I'].time).toEqual(m['II'].time);
      m['I'].time[0] = 99;
      expect(m['II'].time[0]).toBe(0);
    });

    it('pathology-specific lead patterns', () => {
      const at = (r: Record<string, ECGResult>, lead: string, t: number) => r[lead].signal[t];
      // RBBB: rsR' in V1 (R' > r), broad S in I and V6
      {
        const r = generator.generateMultiLead({ duration: 4, pathology: 'rbbb', customParams: { respiratoryAmplitude: 0 } });
        const k = detectPeaks(r['II'].signal, 1000)[1];
        const v1 = r['V1'].signal;
        const rPrime = argExt(v1, k + 30, k + 80, 'max');
        const rSmall = argExt(v1, k - 20, k + 10, 'max');
        const sDip = argExt(v1, rSmall, rPrime, 'min');
        expect(v1[rPrime]).toBeGreaterThan(v1[rSmall]);
        expect(v1[rSmall]).toBeGreaterThan(0.1);
        expect(v1[sDip]).toBeLessThan(v1[rSmall] - 0.2);
        expect(Math.min(...r['V6'].signal.slice(k + 20, k + 90))).toBeLessThan(-0.3);
        expect(Math.min(...r['I'].signal.slice(k + 20, k + 90))).toBeLessThan(-0.3);
        expect(Math.min(...v1.slice(k + 150, k + 450))).toBeLessThan(-0.15); // secondary T inversion
      }
      // LBBB: broad R in V6 and I, deep QS-like V1 with upright T (discordance)
      {
        const r = generator.generateMultiLead({ duration: 4, pathology: 'lbbb', customParams: { respiratoryAmplitude: 0 } });
        const k = detectPeaks(r['I'].signal, 1000)[1];
        expect(Math.max(...r['V6'].signal.slice(k - 60, k + 80))).toBeGreaterThan(0.9);
        expect(Math.min(...r['V1'].signal.slice(k - 60, k + 100))).toBeLessThan(-1.0);
        expect(Math.max(...r['V1'].signal.slice(k + 150, k + 450))).toBeGreaterThan(0.2);
        expect(Math.min(...r['V6'].signal.slice(k + 150, k + 450))).toBeLessThan(-0.2);
      }
      // inferior STEMI: ST up in II, III, aVF; reciprocal depression in aVL
      {
        const r = generator.generateMultiLead({ duration: 4, pathology: 'stemi', customParams: { respiratoryAmplitude: 0 } });
        const k = detectPeaks(r['V4'].signal, 1000)[1]; // tall R in V4 (the inferior ST-T dome dominates II)
        const st = k + 110;
        expect(at(r, 'II', st)).toBeGreaterThan(0.2);
        expect(at(r, 'III', st)).toBeGreaterThan(0.25);
        expect(at(r, 'aVF', st)).toBeGreaterThan(0.2);
        expect(at(r, 'aVL', st)).toBeLessThan(-0.1);
        expect(Math.min(...r['III'].signal.slice(k - 50, k))).toBeLessThan(-0.2); // Q in III
      }
      // pericarditis: diffuse ST elevation, aVR depression and PR elevation
      {
        const r = generator.generateMultiLead({ duration: 4, pathology: 'pericarditis', customParams: { respiratoryAmplitude: 0 } });
        const k = detectPeaks(r['II'].signal, 1000)[1];
        for (const l of ['I', 'II', 'aVF', 'V2', 'V3', 'V4', 'V5', 'V6']) expect(at(r, l, k + 85)).toBeGreaterThan(0.06);
        expect(at(r, 'aVR', k + 85)).toBeLessThan(-0.05);
        expect(at(r, 'aVR', k - 65)).toBeGreaterThan(0.02);
        expect(at(r, 'II', k - 65)).toBeLessThan(-0.03);
      }
      // LVH: Sokolow-Lyon S(V1) + R(V5) > 3.5 mV, lateral strain T inversion
      {
        const r = generator.generateMultiLead({ duration: 4, pathology: 'lvh', customParams: { respiratoryAmplitude: 0 } });
        const k = detectPeaks(r['II'].signal, 1000)[1];
        const sV1 = -Math.min(...r['V1'].signal.slice(k - 50, k + 60));
        const rV5 = Math.max(...r['V5'].signal.slice(k - 50, k + 60));
        expect(sV1 + rV5).toBeGreaterThan(3.5);
        expect(Math.max(...r['aVL'].signal.slice(k - 50, k + 60))).toBeGreaterThan(1.1);
        expect(Math.min(...r['V6'].signal.slice(k + 150, k + 450))).toBeLessThan(-0.15);
      }
    });
  });

  describe('generateStream (C12)', () => {
    it('chunks are seamless, non-overlapping and match one long generation', () => {
      const opts = { duration: 6, pathology: 'atrialFibrillation' as const, seed: 4, noise: { muscle: { amplitude: 0.01 }, baseline: { amplitude: 0.1, frequency: 0.25 } } };
      const full = generator.generate(opts);
      const chunks = [...generator.generateStream(opts, 0.7)];
      const time = chunks.flatMap(c => c.time);
      const signal = chunks.flatMap(c => c.signal);
      expect(signal.length).toBe(full.signal.length);
      expect(time).toEqual(full.time);
      for (let i = 0; i < signal.length; i++) expect(Math.abs(signal[i] - full.signal[i])).toBeLessThan(1e-4);
      for (let k = 1; k < chunks.length; k++) {
        const prev = chunks[k - 1];
        expect(chunks[k].time[0]).toBeCloseTo(prev.time[prev.time.length - 1] + 1 / 1000, 12);
      }
    });

    it('streams endlessly when no duration is given', () => {
      const stream = generator.generateStream({ heartRate: 70 }, 1);
      const chunks: ECGResult[] = [];
      for (let i = 0; i < 3; i++) {
        const r = stream.next();
        if (!r.done) chunks.push(r.value);
      }
      expect(chunks.length).toBe(3);
      expect(chunks[0].signal.length).toBe(1000);
      expect(chunks[2].time[0]).toBe(2);
      // continuity across the chunk boundary
      const last = chunks[1].signal[999], first = chunks[2].signal[0];
      expect(Math.abs(first - last)).toBeLessThan(0.1);
      // duration: Infinity is also endless
      const inf = generator.generateStream({ duration: Infinity }, 0.5);
      for (let i = 0; i < 3; i++) {
        const r = inf.next();
        expect(r.done).toBe(false);
        if (!r.done) expect(r.value.time[0]).toBe(i * 0.5);
      }
    });

    it('long streams keep constant per-chunk cost and bounded beat history', () => {
      const synth = new ECGSynth({
        params: getPathologyParams('normal', 300), pathology: 'normal', samplingRate: 250, tolerance: 1e-6,
        leads: ['II'], variation: 0, streams: new RandomStreams(1),
      });
      const chunk = 250; // 1 s
      const timeChunks = (count: number) => {
        const t0 = performance.now();
        let rate = 0;
        for (let i = 0; i < count; i++) rate = synth.render(chunk).meanHeartRate;
        expect(rate).toBeCloseTo(300, 6);
        return performance.now() - t0;
      };
      timeChunks(200); // warm-up
      const early = timeChunks(300);
      timeChunks(900); // 20 min of stream = 6000 beats
      const late = timeChunks(300);
      expect(synth.rPeakTimes.length).toBeLessThan(1024 + 400);
      expect(synth.rPeakTimes[synth.rPeakTimes.length - 1]).toBeGreaterThan(1700);
      expect(late).toBeLessThan(early * 2 + 20);
    });
  });

  describe('performance', () => {
    it('12-lead 10 s at 500 Hz < 300 ms, 60 s < 1.5 s', () => {
      let t0 = performance.now();
      generator.generateMultiLead({ duration: 10, samplingRate: 500, noise: { gaussian: { amplitude: 0.01 }, muscle: { amplitude: 0.01 } } });
      expect(performance.now() - t0).toBeLessThan(300);
      t0 = performance.now();
      generator.generateMultiLead({ duration: 60, samplingRate: 500, pathology: 'atrialFibrillation', solverTolerance: 1e-7 });
      expect(performance.now() - t0).toBeLessThan(1500);
    });
  });
});

describe('Quick functions', () => {
  it('generateNormalECG', () => {
    const { time, signal } = generateNormalECG(1, 70, 1000);
    expect(signal.length).toBe(1000);
    expect(time.length).toBe(1000);
  });

  it('generatePathologicalECG', () => {
    const { signal } = generatePathologicalECG('bradycardia', 1, 1000);
    expect(signal.length).toBe(1000);
  });
});
