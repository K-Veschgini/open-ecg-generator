import { describe, it, expect } from 'vitest';
import { FS, render, idx, qrsBounds, argExt, bumpBounds, mean, std } from './helpers.js';
import { getPathologyParams, PATHOLOGY_DEFAULT_HEART_RATE } from '../models/pathologies.js';
import { generateECGSyn } from '../models/ecgsyn.js';
import { buildTemplate, placeBeat, repolarizationScale, PlacedWave, WAVE_EXTENT } from '../models/rate.js';
import { ECGSynth } from '../models/synth.js';
import { RandomStreams } from '../math/random.js';

/** Interval measurements (ms) on beat k (middle of the recording). */
function measurePR(pathology: Parameters<typeof render>[0], heartRate: number): number {
  const { signal, rPeaks } = render(pathology, { heartRate, params: { T: { ...getPathologyParams(pathology).T, amplitude: 0 } } });
  const s = signal.get('II')!;
  const k = Math.floor(rPeaks.length / 2);
  const r = idx(rPeaks[k]);
  const [qon] = qrsBounds(s, r, 0.01);
  const rr = rPeaks[k] - rPeaks[k - 1];
  const pk = argExt(s, r - idx(0.8 * rr), qon, 'max');
  const [pon] = bumpBounds(s, pk, 0.05);
  return qon - pon;
}

function measureQRS(pathology: Parameters<typeof render>[0], heartRate: number): number {
  const p = getPathologyParams(pathology);
  const { signal, rPeaks } = render(pathology, {
    heartRate,
    params: { P: { ...p.P, amplitude: 0 }, T: { ...p.T, amplitude: 0 }, extraWaves: (p.extraWaves ?? []).map(w => (w.position * 1000 / (2 * Math.PI) > 60 ? { ...w, amplitude: 0 } : w)) },
  });
  const s = signal.get('II')!;
  const r = idx(rPeaks[Math.floor(rPeaks.length / 2)]);
  const [a, b] = qrsBounds(s, r, 0.01);
  return b - a;
}

function measureQT(pathology: Parameters<typeof render>[0], heartRate: number) {
  const p = getPathologyParams(pathology);
  const { signal, rPeaks } = render(pathology, { heartRate, params: { P: { ...p.P, amplitude: 0 } } });
  const s = signal.get('II')!;
  const k = Math.floor(rPeaks.length / 2);
  const r = idx(rPeaks[k]);
  const rr = rPeaks[k + 1] - rPeaks[k];
  const [qon, j] = qrsBounds(s, r, 0.01);
  const tp = argExt(s, j, r + idx(0.8 * rr), 'abs');
  const [, tend] = bumpBounds(s, tp, 0.05);
  const nextQon = qrsBounds(s, idx(rPeaks[k + 1]), 0.01)[0];
  return { qt: tend - qon, rr, tend, nextQon, tPeak: tp };
}

describe('steady state from the first sample (C1)', () => {
  it('starts on the isoelectric line and the first beats are full size', () => {
    const { signal, rPeaks } = render('normal', { heartRate: 70, duration: 6 });
    const s = signal.get('II')!;
    expect(Math.abs(s[0])).toBeLessThan(0.005);
    // TP segment of the first beat (just before its P wave) is at 0 mV
    const firstR = idx(rPeaks[0]);
    expect(Math.abs(s[firstR - 260])).toBeLessThan(0.005);
    // first R peak equals later R peaks
    const peaks = rPeaks.map(t => s[idx(t)]);
    for (const p of peaks) expect(Math.abs(p - peaks[peaks.length - 1])).toBeLessThan(0.003);
    // isoelectric level in every TP segment of the first second ~0 mV
    const baseline: number[] = [];
    for (let i = 0; i < FS; i++) {
      const t = i / FS;
      const near = rPeaks.some(r => t > r - 0.25 && t < r + 0.42);
      if (!near) baseline.push(s[i]);
    }
    expect(baseline.length).toBeGreaterThan(50);
    expect(Math.max(...baseline.map(Math.abs))).toBeLessThan(0.01);
  });

  it('keeps the baseline at 0 mV in steady state (no ECGSYN baseline depression)', () => {
    const { signal, rPeaks } = render('normal', { heartRate: 60, duration: 20 });
    const s = signal.get('II')!;
    for (const r of rPeaks.slice(1, -1)) {
      expect(Math.abs(s[idx(r + 0.6)])).toBeLessThan(0.003); // mid-diastole
    }
  });
});

describe('true-mV amplitudes (C2)', () => {
  it.each([40, 70, 150])('normal waves have their nominal mV peaks at %i bpm', hr => {
    const { signal, rPeaks } = render('normal', { heartRate: hr });
    const s = signal.get('II')!;
    const k = Math.floor(rPeaks.length / 2);
    const r = idx(rPeaks[k]);
    const rr = rPeaks[k] - rPeaks[k - 1];
    expect(s[r]).toBeGreaterThan(1.15);
    expect(s[r]).toBeLessThan(1.25);
    const t = s[argExt(s, r + 60, r + idx(0.55 * rr), 'max')];
    expect(t).toBeGreaterThan(0.27);
    expect(t).toBeLessThan(0.33);
    if (hr <= 100) {
      const p = s[argExt(s, r - idx(0.3), r - 60, 'max')];
      expect(p).toBeGreaterThan(0.13);
      expect(p).toBeLessThan(0.17);
    }
    const sWave = s[argExt(s, r, r + 60, 'min')];
    expect(sWave).toBeLessThan(-0.15);
    expect(sWave).toBeGreaterThan(-0.3);
  });

  it('peak height equals the amplitude parameter independent of width', () => {
    for (const widthMs of [10, 30, 60]) {
      const w = (widthMs / 1000) * 2 * Math.PI;
      const { ecg } = generateECGSyn(4, FS, {
        ...getPathologyParams('normal', 60),
        respiratoryAmplitude: 0,
        P: { amplitude: 0, width: 0.1, position: -1 },
        Q: { amplitude: 0, width: 0.05, position: -0.1 },
        S: { amplitude: 0, width: 0.05, position: 0.1 },
        T: { amplitude: 0, width: 0.3, position: 1.5 },
        R: { amplitude: 0.8, width: w, position: 0 },
      });
      expect(Math.max(...ecg)).toBeCloseTo(0.8, 3);
    }
  });

  it('every preset stays within realistic lead-II voltages', () => {
    for (const p of Object.keys(PATHOLOGY_DEFAULT_HEART_RATE) as (keyof typeof PATHOLOGY_DEFAULT_HEART_RATE)[]) {
      const { signal } = render(p, { duration: 6 });
      const s = signal.get('II')!;
      expect(Math.max(...s)).toBeLessThan(2.2);
      expect(Math.min(...s)).toBeGreaterThan(-1.0);
      expect(Math.max(...s.map(Math.abs))).toBeGreaterThan(0.5);
    }
  });
});

describe('rate-aware intervals (C3)', () => {
  const rates = [30, 40, 60, 100, 150, 180, 200];

  it('QRS duration is constant in ms across 30-200 bpm', () => {
    const q = rates.map(hr => measureQRS('normal', hr));
    for (const v of q) {
      expect(v).toBeGreaterThanOrEqual(70);
      expect(v).toBeLessThanOrEqual(110);
    }
    expect(Math.max(...q) - Math.min(...q)).toBeLessThanOrEqual(2);
  });

  it('PR stays physiological (~120-200 ms) across 40-180 bpm', () => {
    const pr = [40, 60, 100, 150, 180].map(hr => measurePR('normal', hr));
    for (const v of pr) {
      expect(v).toBeGreaterThanOrEqual(120);
      expect(v).toBeLessThanOrEqual(200);
    }
    // only mild shortening with rate
    expect(pr[0] - pr[pr.length - 1]).toBeLessThan(40);
    expect(pr[0]).toBeGreaterThan(pr[pr.length - 1]);
  });

  it('QT follows Fridericia (QTc constant) across 40-150 bpm', () => {
    const qtc = [40, 60, 70, 100, 150].map(hr => {
      const m = measureQT('normal', hr);
      return m.qt / Math.cbrt(m.rr);
    });
    for (const v of qtc) {
      expect(v).toBeGreaterThan(380);
      expect(v).toBeLessThan(420);
    }
  });

  it('repolarisation never reaches the next QRS, even at 180-220 bpm', () => {
    for (const hr of [180, 200, 220]) {
      const m = measureQT('normal', hr);
      expect(m.tend).toBeLessThan(m.nextQon);
      expect(m.qt).toBeGreaterThan(150);
    }
    for (const p of ['ventricularTachycardia', 'hypokalemia', 'stemi', 'lbbb', 'completeHeartBlock'] as const) {
      const tpl = buildTemplate(getPathologyParams(p));
      const repolKeys = new Set(tpl.waves.filter(w => w.kind === 'repolarization').map(w => w.key));
      for (const rr of [0.25, 0.3, 0.33, 0.4]) {
        for (const rrPrev of [rr, 0.6, 1.0]) {
          const placed: PlacedWave[] = [];
          placeBeat(tpl, 0, rrPrev, rr, true, placed);
          for (const w of placed.filter(x => repolKeys.has(x.key))) {
            expect(w.center + WAVE_EXTENT * w.sigma).toBeLessThanOrEqual(rr + tpl.qrsOnset - 0.0099);
          }
        }
      }
    }
  });

  it('a U wave fuses into T at fast rates instead of pulling the QT off Fridericia', () => {
    // hypokalaemia (U wave at 430 ms): QTcF of the T wave stays at the normal-morphology value up to 200 bpm
    for (const p of ['hypokalemia', 'normal'] as const) {
      const tpl = buildTemplate(getPathologyParams(p));
      for (const hr of [60, 140, 180, 200]) {
        const rr = 60 / hr;
        const tEnd = tpl.jPoint + (tpl.tEnd - tpl.jPoint) * repolarizationScale(tpl, rr);
        const qtcF = (tEnd - tpl.qrsOnset) / Math.cbrt(rr);
        expect(qtcF).toBeGreaterThan(0.38);
        expect(qtcF).toBeLessThan(0.42);
      }
    }
  });

  it('QT follows the preceding RR; the following RR only limits the T end', () => {
    const tpl = buildTemplate(getPathologyParams('normal'));
    // same following interval, different preceding interval -> different QT
    expect(repolarizationScale(tpl, 0.6, 1.0)).toBeLessThan(repolarizationScale(tpl, 1.0, 1.0));
    // a long following interval does not lengthen the QT of a beat after a short cycle
    expect(repolarizationScale(tpl, 0.6, 1.5)).toBeCloseTo(repolarizationScale(tpl, 0.6, 0.6), 12);
    // long-short: QT from the long preceding cycle, but T still ends before the early next QRS
    const g = repolarizationScale(tpl, 1.2, 0.35);
    expect(tpl.jPoint + (tpl.tEnd - tpl.jPoint) * g).toBeLessThanOrEqual(0.35 + tpl.qrsOnset - 0.0099);
  });

  it('first-degree AV block keeps PR > 200 ms at any rate (C9)', () => {
    for (const hr of [30, 40, 70, 100, 150, 180]) {
      expect(measurePR('firstDegreeAVBlock', hr)).toBeGreaterThan(200);
    }
  });
});

describe('pathology morphology (C2, C6-C9)', () => {
  it('VT: wide monomorphic QRS >= 140 ms, no P waves, ~180 bpm', () => {
    expect(measureQRS('ventricularTachycardia', 180)).toBeGreaterThanOrEqual(140);
    const params = getPathologyParams('ventricularTachycardia');
    expect(params.P.amplitude).toBe(0);
    expect(params.heartRate).toBe(180);
    const { signal, rPeaks } = render('ventricularTachycardia');
    const s = signal.get('II')!;
    const peaks = rPeaks.slice(1, -1).map(t => s[idx(t)]);
    expect(std(peaks)).toBeLessThan(1e-3); // monomorphic
  });

  it('LBBB: QRS >= 120 ms with a notched R and discordant T in lead II', () => {
    expect(measureQRS('lbbb', 70)).toBeGreaterThanOrEqual(120);
    const { signal, rPeaks } = render('lbbb');
    const s = signal.get('II')!;
    const r = idx(rPeaks[3]);
    // two local maxima within the QRS (notch)
    let maxima = 0;
    for (let i = r - 40; i < r + 80; i++) if (s[i] > 0.3 && s[i] > s[i - 1] && s[i] >= s[i + 1]) maxima++;
    expect(maxima).toBe(2);
    expect(s[argExt(s, r + 120, r + 450, 'abs')]).toBeLessThan(-0.2);
  });

  it('RBBB: QRS >= 120 ms with a broad terminal S in lead II', () => {
    expect(measureQRS('rbbb', 70)).toBeGreaterThanOrEqual(120);
    const { signal, rPeaks } = render('rbbb');
    const s = signal.get('II')!;
    const r = idx(rPeaks[3]);
    const sMin = argExt(s, r, r + 100, 'min');
    expect(s[sMin]).toBeLessThan(-0.2);
    expect(sMin - r).toBeGreaterThan(35);
    const [a, b] = bumpBounds(s, sMin, 0.5);
    expect(b - a).toBeGreaterThan(40); // broad, slurred S
  });

  it('STEMI: pathological Q and ST elevation between J point and T at any rate and under irregular RR (C6)', () => {
    for (const variant of [
      { heartRate: 50 }, { heartRate: 70 }, { heartRate: 120 },
      { heartRate: 100, rhythm: { kind: 'atrialFibrillation' as const } },
    ]) {
      const { signal, rPeaks } = render('stemi', { ...variant, duration: 12 });
      const s = signal.get('II')!;
      for (let k = 1; k < rPeaks.length - 1; k++) {
        const r = idx(rPeaks[k]);
        const rrNext = rPeaks[k + 1] - rPeaks[k];
        const j = r + 50;
        const tPeak = argExt(s, r + 60, r + idx(0.9 * rrNext) - 50, 'max');
        expect(tPeak).toBeGreaterThan(j + 30);
        // ST segment (J+20 ms .. halfway to the T peak) elevated >= 0.15 mV
        for (let i = j + 20; i < (j + tPeak) / 2; i += 5) expect(s[i]).toBeGreaterThan(0.15);
        // the elevation is phase locked: the PR segment before each QRS is isoelectric
        if (!('rhythm' in variant)) expect(Math.abs(s[r - idx(0.065)])).toBeLessThan(0.03);
      }
      const r = idx(rPeaks[2]);
      const q = s[argExt(s, r - 50, r, 'min')];
      expect(q).toBeLessThan(-0.25 * s[r]); // Q depth > 25 % of R
    }
  });

  it('hyperkalaemia: tall, narrow, peaked T', () => {
    const { signal, rPeaks } = render('hyperkalemia');
    const s = signal.get('II')!;
    const r = idx(rPeaks[3]);
    const tp = argExt(s, r + 80, r + 400, 'max');
    expect(s[tp]).toBeGreaterThan(0.75 * s[r]);
    const [a, b] = bumpBounds(s, tp, 0.5);
    expect(b - a).toBeLessThan(80); // narrow (FWHM < 80 ms)
  });

  it('hypokalaemia: flat T followed by a larger U wave before the next P (C7)', () => {
    for (const hr of [50, 70, 85]) {
      const { signal, rPeaks } = render('hypokalemia', { heartRate: hr });
      const s = signal.get('II')!;
      const k = 3;
      const r = idx(rPeaks[k]);
      const rr = rPeaks[k + 1] - rPeaks[k];
      const tWin = argExt(s, r + 150, r + idx(0.3 * Math.cbrt(rr)), 'max');
      const u = argExt(s, r + idx(0.32 * Math.cbrt(rr)), r + idx(0.6 * Math.cbrt(rr)), 'max');
      expect(s[u]).toBeGreaterThan(0.1);
      expect(s[tWin]).toBeLessThan(s[u]);
      const nextR = idx(rPeaks[k + 1]);
      const nextP = argExt(s, nextR - idx(0.25), nextR - 50, 'max');
      expect(u).toBeLessThan(nextP);
      expect(u).toBeGreaterThan(tWin);
    }
  });

  it('pericarditis: PR depression and ST elevation in lead II', () => {
    const { signal, rPeaks } = render('pericarditis');
    const s = signal.get('II')!;
    const r = idx(rPeaks[3]);
    expect(s[r - 65]).toBeLessThan(-0.03); // PR segment
    expect(s[r + 85]).toBeGreaterThan(0.08); // ST segment
  });

  it('atrial fibrillation: irregularly irregular RR without P waves (C4)', () => {
    const { rPeaks } = render('atrialFibrillation', { duration: 120 });
    const rr = rPeaks.slice(1).map((t, i) => t - rPeaks[i]);
    const cv = std(rr) / mean(rr);
    expect(cv).toBeGreaterThan(0.12);
    expect(cv).toBeLessThan(0.4);
    // no beat-to-beat correlation (irregularly irregular, not a slow drift)
    const d = rr.map(v => v - mean(rr));
    let num = 0, den = 0;
    for (let i = 0; i < d.length; i++) {
      den += d[i] * d[i];
      if (i > 0) num += d[i] * d[i - 1];
    }
    expect(Math.abs(num / den)).toBeLessThan(0.25);
    expect(60 / mean(rr)).toBeGreaterThan(100);
    expect(60 / mean(rr)).toBeLessThan(120);
    expect(getPathologyParams('atrialFibrillation').P.amplitude).toBe(0);
  });

  it('complete heart block: independent atrial rate, slow wide escape rhythm, no fixed PR (C8)', () => {
    const { signal, rPeaks, synth } = render('completeHeartBlock', { duration: 30 });
    const pTimes = synth.independentPWaveTimes.filter(t => t > 0 && t < 30);
    const pp = pTimes.slice(1).map((t, i) => t - pTimes[i]);
    expect(60 / mean(pp)).toBeGreaterThan(69);
    expect(60 / mean(pp)).toBeLessThan(81);
    expect(std(pp)).toBeGreaterThan(0.005); // the sinus node has its own variability
    const rr = mean(rPeaks.slice(1).map((t, i) => t - rPeaks[i]));
    expect(60 / rr).toBeCloseTo(40, 5);
    // PR "interval" (last P before each QRS) varies widely
    const prs = rPeaks.map(r => r - Math.max(...pTimes.filter(t => t < r - 0.05))).filter(Number.isFinite);
    expect(std(prs)).toBeGreaterThan(0.1);
    // P waves are visible in the waveform at their own times (outside QRS/T)
    const s = signal.get('II')!;
    let visible = 0;
    for (const t of pTimes) {
      const clear = rPeaks.every(r => t < r - 0.12 || t > r + 0.75);
      if (clear) {
        visible++;
        expect(s[idx(t)]).toBeGreaterThan(0.12);
      }
    }
    expect(visible).toBeGreaterThan(5);
    expect(measureQRS('completeHeartBlock', 40)).toBeGreaterThanOrEqual(120);
  });

  it('complete heart block keeps AV dissociation at escape rates commensurate with 75/min', () => {
    for (const heartRate of [25, 37.5, 40, 50, 75]) {
      for (const seed of [0, 1, 2, 3, 4, 5]) {
        const synth = new ECGSynth({
          params: getPathologyParams('completeHeartBlock', heartRate),
          pathology: 'completeHeartBlock',
          samplingRate: 250,
          tolerance: 1e-6,
          leads: ['II'],
          variation: 0,
          streams: new RandomStreams(seed),
        });
        synth.render(60 * 250);
        const pTimes = synth.independentPWaveTimes;
        const prs = synth.rPeakTimes
          .filter(t => t > 0 && t < 60)
          .map(r => r - Math.max(...pTimes.filter(t => t < r - 0.05)))
          .filter(Number.isFinite);
        expect(new Set(prs.map(v => v.toFixed(3))).size).toBeGreaterThan(prs.length / 2);
        expect(std(prs)).toBeGreaterThan(0.1);
      }
    }
  });
});
