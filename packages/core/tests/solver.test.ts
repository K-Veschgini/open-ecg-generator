import { describe, it, expect } from 'vitest';
import { solveODE, interpolate } from '../math/ode-solver.js';
import { generateECGSyn } from '../models/ecgsyn.js';
import { getPathologyParams } from '../models/pathologies.js';
import { buildTemplate, placeBeat, PlacedWave } from '../models/rate.js';

const oscillator = (_t: number, y: number[]) => [y[1], -y[0]];

describe('solveODE (C13)', () => {
  it('error decreases with tolerance (harmonic oscillator)', () => {
    const errs = [1e-3, 1e-6, 1e-9].map(tol => {
      const sol = solveODE(oscillator, { initialConditions: [0, 1], timeSpan: [0, 20], timePoints: 401, tolerance: tol });
      return Math.max(...sol.t.map((t, i) => Math.abs(sol.y[i][0] - Math.sin(t))));
    });
    expect(errs[0]).toBeGreaterThan(errs[1] * 10);
    expect(errs[1]).toBeGreaterThan(errs[2] * 10);
    expect(errs[2]).toBeLessThan(1e-6);
  });

  it('dense output: tEval and timePoints grids are honoured exactly', () => {
    const tEval = [0, 0.1, 0.25, 1, 3.3, 5];
    const sol = solveODE(oscillator, { initialConditions: [0, 1], timeSpan: [0, 5], tEval, tolerance: 1e-10 });
    expect(sol.t).toEqual(tEval);
    sol.y.forEach((y, i) => expect(y[0]).toBeCloseTo(Math.sin(tEval[i]), 7));
    const one = solveODE(oscillator, { initialConditions: [0, 1], timeSpan: [0, 5], timePoints: 1 });
    expect(one.t).toEqual([0]);
    expect(one.y).toEqual([[0, 1]]);
    const steps = solveODE(oscillator, { initialConditions: [0, 1], timeSpan: [0, 5] });
    expect(steps.t[0]).toBe(0);
    expect(steps.t[steps.t.length - 1]).toBe(5);
  });

  it('terminates with a descriptive error on NaN, step underflow and bad input', () => {
    const t0 = performance.now();
    expect(() => solveODE(() => [NaN], { initialConditions: [0], timeSpan: [0, 1] })).toThrow(/non-finite/);
    expect(() => solveODE((t) => [t > 0.5 ? NaN : 1], { initialConditions: [0], timeSpan: [0, 1] })).toThrow(/non-finite/);
    expect(() => solveODE((t) => [1 / (0.5 - t)], { initialConditions: [0], timeSpan: [0, 1], tolerance: 1e-9 })).toThrow(/underflow|non-finite|maxSteps/);
    expect(() => solveODE(oscillator, { initialConditions: [0, 1], timeSpan: [0, 1], timePoints: 0 })).toThrow();
    expect(() => solveODE(oscillator, { initialConditions: [0, 1], timeSpan: [1, 0] })).toThrow();
    expect(() => solveODE(oscillator, { initialConditions: [0, 1], timeSpan: [0, 1e6], maxSteps: 1000 })).toThrow(/maxSteps/);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('tolerance changes the ECG result and the error versus the exact solution decreases', () => {
    const params = { ...getPathologyParams('normal', 75), respiratoryAmplitude: 0 };
    const fs = 1000;
    // exact solution: z(t) = sum of the placed Gaussians
    const tpl = buildTemplate(params);
    const placed: PlacedWave[] = [];
    const rr = 60 / 75;
    for (let k = -4; k < 10; k++) placeBeat(tpl, 0.5 * rr + k * rr, rr, rr, true, placed);
    const amp = new Map(tpl.waves.map(w => [w.key, w.amplitude]));
    const exact = (t: number) => placed.reduce((s, w) => s + amp.get(w.key)! * Math.exp(-((t - w.center) ** 2) / (2 * w.sigma ** 2)), 0);
    const errs = [1e-3, 1e-5, 1e-8].map(tol => {
      const { time, ecg } = generateECGSyn(4, fs, params, tol);
      return { ecg, err: Math.max(...ecg.map((v, i) => Math.abs(v - exact(time[i])))) };
    });
    expect(errs[0].ecg).not.toEqual(errs[2].ecg);
    expect(errs[0].err).toBeGreaterThan(errs[1].err);
    expect(errs[1].err).toBeGreaterThan(errs[2].err);
    expect(errs[0].err).toBeGreaterThan(10 * errs[2].err);
    expect(errs[2].err).toBeLessThan(1e-5);
  });
});

describe('interpolate', () => {
  it('linear interpolation with clamped ends, in linear time', () => {
    expect(interpolate([0, 1, 2], [0, 10, 0], [-1, 0, 0.5, 1.5, 2, 3])).toEqual([0, 0, 5, 5, 0, 0]);
    expect(interpolate([0, 1, 2], [0, 10, 0], [1.5, 0.5])).toEqual([5, 5]);
    const n = 1_000_000;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = x.map(v => 2 * v);
    const xn = Array.from({ length: n }, (_, i) => i + 0.5);
    const t0 = performance.now();
    const out = interpolate(x, y, xn);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(out[1234]).toBe(2469);
    expect(() => interpolate([0, 1], [0], [0])).toThrow();
  });
});
