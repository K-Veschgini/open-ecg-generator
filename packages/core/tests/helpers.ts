import { ECGSynth } from '../models/synth.js';
import { RhythmDescriptor } from '../models/pathologies.js';
import { getPathologyParams } from '../models/pathologies.js';
import { ECGSynParameters, PathologyType } from '../models/types.js';
import { BaseLead } from '../models/leads.js';
import { RandomStreams } from '../math/random.js';

export const FS = 1000;

export interface Rendered {
  signal: Map<BaseLead, number[]>;
  rPeaks: number[];
  synth: ECGSynth;
}

/** Render a clean recording directly from the model (no respiration unless given). */
export function render(
  pathology: PathologyType,
  opts: {
    heartRate?: number;
    duration?: number;
    leads?: BaseLead[];
    params?: Partial<ECGSynParameters>;
    rhythm?: RhythmDescriptor;
    variation?: number;
    tolerance?: number;
    fs?: number;
  } = {}
): Rendered {
  const fs = opts.fs ?? FS;
  const base = getPathologyParams(pathology, opts.heartRate);
  const params: ECGSynParameters = { ...base, respiratoryAmplitude: 0, ...opts.params };
  const synth = new ECGSynth({
    params,
    pathology,
    samplingRate: fs,
    tolerance: opts.tolerance ?? 1e-7,
    leads: opts.leads ?? ['II'],
    variation: opts.variation ?? 0,
    streams: new RandomStreams(7),
    rhythm: opts.rhythm,
  });
  const duration = opts.duration ?? 10;
  const r = synth.render(Math.round(duration * fs));
  return { signal: r.leads, rPeaks: synth.rPeakTimes.filter(t => t >= 0 && t < duration).slice(), synth };
}

/** Index of sample nearest to time t. */
export const idx = (t: number, fs: number = FS) => Math.round(t * fs);

/**
 * Walk outward from the R peak until |s| < thr for at least `quiet` consecutive
 * samples (so zero crossings inside the QRS are skipped): [onsetIndex, offsetIndex].
 */
export function qrsBounds(s: number[], rIndex: number, thr: number, quiet: number = 8): [number, number] {
  const isQuiet = (from: number, dir: 1 | -1) => {
    for (let k = 0; k < quiet; k++) {
      const i = from + dir * k;
      if (i < 0 || i >= s.length) return true;
      if (Math.abs(s[i]) >= thr) return false;
    }
    return true;
  };
  let a = rIndex;
  while (a > 0 && !isQuiet(a, -1)) a--;
  let b = rIndex;
  while (b < s.length - 1 && !isQuiet(b, 1)) b++;
  return [a, b];
}

/** Extent of an isolated bump around index `peak`: walk until |s| < frac * |s[peak]|. */
export function bumpBounds(s: number[], peak: number, frac: number): [number, number] {
  const lim = Math.abs(s[peak]) * frac;
  let a = peak;
  while (a > 0 && Math.abs(s[a]) > lim) a--;
  let b = peak;
  while (b < s.length - 1 && Math.abs(s[b]) > lim) b++;
  return [a, b];
}

/** Index of max |value| (or max / min with sign) in [from, to). */
export function argExt(s: number[], from: number, to: number, mode: 'max' | 'min' | 'abs' = 'abs'): number {
  let best = Math.max(0, from);
  for (let i = Math.max(0, from); i < Math.min(s.length, to); i++) {
    const v = s[i], bv = s[best];
    if (mode === 'max' ? v > bv : mode === 'min' ? v < bv : Math.abs(v) > Math.abs(bv)) best = i;
  }
  return best;
}

export function mean(x: number[]): number {
  return x.reduce((a, b) => a + b, 0) / x.length;
}

export function std(x: number[]): number {
  const m = mean(x);
  return Math.sqrt(x.reduce((a, b) => a + (b - m) * (b - m), 0) / x.length);
}

export function correlation(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

/** One-sided power spectrum by direct DFT at frequencies 0..fMax step df. */
export function powerSpectrum(x: number[], fs: number, fMax: number, df: number): { f: number[]; p: number[] } {
  const m = mean(x);
  const f: number[] = [], p: number[] = [];
  for (let fr = df; fr <= fMax; fr += df) {
    let re = 0, im = 0;
    const w = 2 * Math.PI * fr / fs;
    for (let i = 0; i < x.length; i++) {
      re += (x[i] - m) * Math.cos(w * i);
      im -= (x[i] - m) * Math.sin(w * i);
    }
    f.push(fr);
    p.push(re * re + im * im);
  }
  return { f, p };
}

/** Simple R-peak detector on |signal|: local maxima above 50 % of the global maximum, >= 200 ms apart. */
export function detectPeaks(s: number[], fs: number, refractory = 0.2): number[] {
  const mx = Math.max(...s.map(Math.abs));
  const out: number[] = [];
  for (let i = 1; i < s.length - 1; i++) {
    const v = Math.abs(s[i]);
    if (v > 0.5 * mx && v >= Math.abs(s[i - 1]) && v > Math.abs(s[i + 1])) {
      if (!out.length || i - out[out.length - 1] > refractory * fs) out.push(i);
      else if (v > Math.abs(s[out[out.length - 1]])) out[out.length - 1] = i;
    }
  }
  return out;
}
