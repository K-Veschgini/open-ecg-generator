/**
 * Rate-aware mapping of the reference (60 bpm) wave table to time.
 *
 * In the original ECGSYN every wave lives at a fixed phase, so all intervals
 * scale linearly with the RR interval (PR of 55 ms at 180 bpm, QT ignoring
 * rate). Here each wave is classified and mapped to a time offset from its
 * own R peak:
 *
 * - depolarisation (Q, R, S and extra waves centred inside the QRS):
 *   fixed in milliseconds, so QRS duration does not depend on rate;
 * - atrial (P and extra waves centred before QRS onset): the distance to the
 *   QRS onset is scaled by RR^0.15 (clamped to 0.75..1.15), i.e. PR shortens
 *   mildly at fast rates as it does physiologically;
 * - repolarisation (T and extra waves centred after the S wave): distances
 *   from the J point (and widths) are scaled so that the QT interval follows
 *   Fridericia's correction QT = QTc * RR^(1/3), where RR is the PRECEDING
 *   cycle length (as physiologically, the QT adapts to the cycle that ends
 *   with this beat). Independently, every repolarisation wave must end at
 *   least 10 ms before the next QRS onset (waves never wrap into the next
 *   cycle): the T wave is shortened only when it itself would reach the next
 *   QRS; later waves (e.g. a U wave) are compressed towards the J point
 *   first, so they fuse with the T wave at fast rates (T-U fusion) instead
 *   of forcing the QT off Fridericia.
 *
 * Wave extents are measured at 2.45 sigma, where a Gaussian has fallen to 5 %
 * of its peak.
 */

import { ECGSynParameters, SECONDS_PER_RADIAN, WaveParameters } from './types.js';
import { QTCorrection } from '../enhancements/realistic-features.js';

/** Half-extent of a Gaussian wave in sigmas (5 % of peak). */
export const WAVE_EXTENT = 2.45;

export type WaveKind = 'atrial' | 'depolarization' | 'repolarization';

export interface TemplateWave {
  /** 'P' | 'Q' | 'R' | 'S' | 'T' | 'X<i>' (index into extraWaves) */
  key: string;
  kind: WaveKind;
  /** lead-II amplitude in mV */
  amplitude: number;
  /** centre at the 60-bpm reference, seconds relative to R */
  center: number;
  /** Gaussian sigma at the 60-bpm reference, seconds */
  sigma: number;
}

export interface BeatTemplate {
  waves: TemplateWave[];
  /** QRS onset relative to R (s), reference */
  qrsOnset: number;
  /** J point relative to R (s) */
  jPoint: number;
  /** T-wave end at the reference rate (s) */
  tEnd: number;
  /** Latest end of any repolarisation wave at the reference rate (s) */
  repolEnd: number;
  /** P-wave centre at the reference rate (s), or NaN if there is no P wave */
  pCenter: number;
  /** QT interval at 60 bpm (= QTc), seconds */
  qtRef: number;
  /** Earliest atrial wave start relative to the P centre / R (s, <= 0) */
  atrialLead: number;
  /** Latest repolarisation wave end (s) for the slowest plausible scale */
  maxTail: number;
}

function toTemplateWave(key: string, w: WaveParameters, kind: WaveKind): TemplateWave {
  return {
    key,
    kind,
    amplitude: w.amplitude,
    center: w.position * SECONDS_PER_RADIAN,
    sigma: w.width * SECONDS_PER_RADIAN,
  };
}

/** Classify the waves of a parameter set and compute the reference landmarks. */
export function buildTemplate(params: ECGSynParameters): BeatTemplate {
  const P = toTemplateWave('P', params.P, 'atrial');
  const Q = toTemplateWave('Q', params.Q, 'depolarization');
  const R = toTemplateWave('R', params.R, 'depolarization');
  const S = toTemplateWave('S', params.S, 'depolarization');
  const T = toTemplateWave('T', params.T, 'repolarization');
  const extras = (params.extraWaves ?? []).map((w, i) => toTemplateWave(`X${i}`, w, 'repolarization'));

  const qrsMain = [Q, R, S].filter(w => w.amplitude !== 0);
  let qrsOnset = qrsMain.length ? Math.min(...qrsMain.map(w => w.center - WAVE_EXTENT * w.sigma)) : -0.04;
  // classify extras
  for (const x of extras) {
    if (x.center < qrsOnset) x.kind = 'atrial';
    else if (x.center <= S.center) x.kind = 'depolarization';
    else x.kind = 'repolarization';
  }
  const depol = [...qrsMain, ...extras.filter(x => x.kind === 'depolarization' && x.amplitude !== 0)];
  if (depol.length) {
    qrsOnset = Math.min(qrsOnset, ...depol.map(w => w.center - WAVE_EXTENT * w.sigma));
  }
  const jPoint = depol.length ? Math.max(...depol.map(w => w.center + WAVE_EXTENT * w.sigma)) : 0.04;

  const waves = [P, Q, R, S, T, ...extras].filter(w => w.amplitude !== 0);
  const tEnd = T.center + WAVE_EXTENT * T.sigma;
  const repols = waves.filter(w => w.kind === 'repolarization');
  const repolEnd = Math.max(tEnd, ...repols.map(w => w.center + WAVE_EXTENT * w.sigma));
  const atrial = waves.filter(w => w.kind === 'atrial');
  const atrialLead = atrial.length
    ? Math.min(0, ...atrial.map(w => w.center - 6 * w.sigma))
    : 0;
  return {
    waves,
    qrsOnset,
    jPoint,
    tEnd,
    repolEnd,
    pCenter: params.P.amplitude !== 0 ? P.center : NaN,
    qtRef: tEnd - qrsOnset,
    atrialLead,
    maxTail: Math.max(jPoint, ...waves.map(w => w.center + 6 * w.sigma)),
  };
}

/** Scale applied to the distance between atrial waves and QRS onset. */
export function prScale(rrSeconds: number): number {
  return Math.min(1.15, Math.max(0.75, Math.pow(rrSeconds, 0.15)));
}

/** Latest allowed end of repolarisation, measured from the J point (s), before a QRS `rrNext` later. */
function repolarizationLimit(tpl: BeatTemplate, rrNext: number): number {
  return rrNext + tpl.qrsOnset - 0.01 - tpl.jPoint;
}

/**
 * Scale applied to the T wave (distance from the J point and width) of a
 * beat preceded by an RR interval of `rrPrev` seconds and followed by one of
 * `rrNext` (default: `rrPrev`, i.e. a regular rhythm).
 * The QT follows Fridericia for `rrPrev`; the scale is only reduced further
 * when the T wave would otherwise end less than 10 ms before the next QRS.
 * A coupled P wave of the next beat may ride on the end of the T wave at fast
 * rates (as it does physiologically, e.g. sinus tachycardia or first-degree
 * AV block at > 120 bpm, where PR + QT exceeds RR).
 */
export function repolarizationScale(tpl: BeatTemplate, rrPrev: number, rrNext: number = rrPrev): number {
  const qrsDuration = tpl.jPoint - tpl.qrsOnset;
  const qtTarget = QTCorrection.fridericiaQT(tpl.qtRef, rrPrev);
  const span = tpl.tEnd - tpl.jPoint;
  let g = span > 1e-6 ? (qtTarget - qrsDuration) / span : Math.cbrt(rrPrev);
  if (span > 1e-6) g = Math.min(g, repolarizationLimit(tpl, rrNext) / span);
  return Math.max(0.15, g);
}

/**
 * Scale of one repolarisation wave: the T-wave scale `g`, reduced further
 * for waves that extend beyond the T wave (U wave, late ST plateau) so that
 * they, too, end >= 10 ms before the next QRS onset.
 */
function repolarizationWaveScale(tpl: BeatTemplate, w: TemplateWave, g: number, rrNext: number): number {
  const extent = w.center + WAVE_EXTENT * w.sigma - tpl.jPoint;
  if (extent <= 1e-6) return g;
  return Math.max(0.15, Math.min(g, repolarizationLimit(tpl, rrNext) / extent));
}

/** A Gaussian wave placed in absolute time. */
export interface PlacedWave {
  key: string;
  center: number;
  sigma: number;
}

/**
 * Place the ventricular-coupled waves of one beat.
 * @param rPeak    absolute time of this beat's R peak (s)
 * @param rrPrev   preceding RR interval (s): sets the PR scaling and the Fridericia QT
 * @param rrNext   following RR interval (s): only limits repolarisation so it ends before the next QRS
 * @param includeAtrial  false for rhythms where atrial activity is not coupled (AV dissociation)
 */
export function placeBeat(
  tpl: BeatTemplate,
  rPeak: number,
  rrPrev: number,
  rrNext: number,
  includeAtrial: boolean,
  out: PlacedWave[]
): void {
  const pr = prScale(rrPrev);
  const g = repolarizationScale(tpl, rrPrev, rrNext);
  for (const w of tpl.waves) {
    switch (w.kind) {
      case 'atrial':
        if (!includeAtrial) break;
        out.push({ key: w.key, center: rPeak + tpl.qrsOnset + (w.center - tpl.qrsOnset) * pr, sigma: w.sigma });
        break;
      case 'depolarization':
        out.push({ key: w.key, center: rPeak + w.center, sigma: w.sigma });
        break;
      case 'repolarization':
      {
        const gw = w.key === 'T' ? g : repolarizationWaveScale(tpl, w, g, rrNext);
        out.push({ key: w.key, center: rPeak + tpl.jPoint + (w.center - tpl.jPoint) * gw, sigma: w.sigma * gw });
        break;
      }
    }
  }
}

/** Place the atrial waves of one independent atrial depolarisation whose P wave peaks at `pPeak`. */
export function placeAtrial(tpl: BeatTemplate, pPeak: number, out: PlacedWave[]): void {
  const ref = Number.isFinite(tpl.pCenter) ? tpl.pCenter : 0;
  for (const w of tpl.waves) {
    if (w.kind !== 'atrial') continue;
    out.push({ key: w.key, center: pPeak + (w.center - ref), sigma: w.sigma });
  }
}
