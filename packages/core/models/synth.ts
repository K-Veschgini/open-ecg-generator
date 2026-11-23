/**
 * Streaming ECG synthesiser.
 *
 * The model (an ECGSYN variant) integrates, for every synthesised lead,
 *
 *   dz/dt = sum_i  -(a_i / b_i^2) * omega * dTheta_i * exp(-dTheta_i^2 / (2 b_i^2))
 *           + dz0/dt - K * (z - z0(t) - sum_i a_i exp(-dTheta_i^2 / (2 b_i^2)))
 *
 * with adaptive Dormand-Prince RK45. dTheta_i = omega (t - c_i) is the phase
 * distance to wave i of a beat and b_i = omega * sigma_i its phase width,
 * so the first term equals -(a_i / sigma_i^2) (t - c_i) exp(...): scaling the
 * Gaussian-derivative term by amplitude / width^2 makes a_i the true peak
 * deflection in mV independent of width and rate. The restoring term pulls
 * z towards the isoelectric baseline z0 (respiration) plus the wave sum
 * rather than towards z0 alone, which removes ECGSYN's well-known baseline
 * depression and start-up transient, so the signal is at steady state from
 * sample 0 with the isoelectric line at ~0 mV.
 *
 * Wave centres/widths are placed per beat by the rate-aware mapping in
 * rate.ts, beat times come from the rhythm model (regular, HRV-modulated,
 * irregularly irregular AF, or AV dissociation with an independent atrial
 * schedule), and integration is carried across render calls, so chunks are
 * seamlessly continuous.
 *
 * All synthesised base leads (I, II, V1-V6) are always integrated together,
 * whatever subset is requested, so the adaptive step sequence and therefore
 * every lead's samples do not depend on which leads were asked for.
 */

import { ECGSynParameters, PathologyType, validateParams, validateSamplingRate } from './types.js';
import { BeatTemplate, PlacedWave, buildTemplate, placeAtrial, placeBeat } from './rate.js';
import { BASE_LEADS, BaseLead, FWAVE_LEAD_GAIN, leadAmplitudes } from './leads.js';
import { PATHOLOGY_RHYTHM, RhythmDescriptor } from './pathologies.js';
import { FibrillatoryWaves, LeadNoise, NoiseOptions } from './noise.js';
import { RandomSource, RandomStreams, gaussian } from '../math/random.js';
import { HRVGenerator } from '../enhancements/realistic-features.js';
import { solveODE } from '../math/ode-solver.js';

/** Relaxation rate of the restoring term (1/s), as in ECGSYN. */
const RESTORE_RATE = 1;
/** Gaussian support used when deciding which waves are active (sigmas). */
const SUPPORT = 6;
/** Integration segment length in samples is round(SEGMENT_SECONDS * fs), aligned to absolute sample indices. */
const SEGMENT_SECONDS = 0.5;
/** Hard bound (s) on how far ahead of / behind a beat's R peak any wave may be scheduled. */
const MAX_WAVE_REACH = 10;
/** Beat history (s) kept for diagnostics; older R-peak / P-wave times are dropped. */
const HISTORY_SECONDS = 60;
/** Only prune history once it is at least this long (amortises the splice). */
const HISTORY_PRUNE_MIN = 1024;
/** Default independent atrial rate (bpm) for AV dissociation. */
const DEFAULT_ATRIAL_RATE = 75;
/** Per-recording spread of the atrial rate around its nominal value (+- fraction). */
const ATRIAL_RATE_SPREAD = 0.05;

/**
 * Nudge an atrial rate away from small-integer multiples p/q (q <= 4) of the
 * ventricular rate: the rate ratio is kept at least 5 %/sqrt(q) away from
 * p/q (well beyond the slow drift of the atrial HRV), so the P-QRS relation
 * keeps sweeping the whole atrial cycle instead of mimicking a fixed
 * 1:1 / 2:1 / 3:2 ... conduction pattern.
 */
function avoidCommensurateRate(atrialRate: number, ventricularRate: number): number {
  let ratio = atrialRate / ventricularRate;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let q = 1; q <= 4; q++) {
      const p = Math.round(ratio * q);
      if (p < 1) continue;
      const f = p / q, tol = 0.05 / Math.sqrt(q);
      if (Math.abs(ratio - f) < tol * f) {
        ratio = f * (ratio < f ? 1 - tol : 1 + tol);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return ratio * ventricularRate;
}

/** Index of the first element of the ascending array `a` that is >= x. */
function lowerBound(a: readonly number[], x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface SynthConfig {
  params: ECGSynParameters;
  pathology: PathologyType;
  samplingRate: number;
  tolerance: number;
  leads: readonly BaseLead[];
  noise?: NoiseOptions;
  /** 0..1, enables HRV for sinus rhythms */
  variation: number;
  streams: RandomStreams;
  /** override the rhythm (defaults to the pathology's rhythm) */
  rhythm?: RhythmDescriptor;
}

interface ActiveWave {
  center: number;
  sigma: number;
  inv2s2: number;
  invS2: number;
  amps: Float64Array;
}

interface ODEParams {
  waves: ActiveWave[];
  nLeads: number;
  respAmp: number;
  respOmega: number;
}

/** Wave sum (target) for all leads at time t. */
function targetAt(p: ODEParams, t: number, out: number[]): void {
  const z0 = p.respAmp * Math.sin(p.respOmega * t);
  for (let i = 0; i < p.nLeads; i++) out[i] = z0;
  for (const w of p.waves) {
    const d = t - w.center;
    const g = Math.exp(-d * d * w.inv2s2);
    if (g < 1e-12) continue;
    for (let i = 0; i < p.nLeads; i++) out[i] += w.amps[i] * g;
  }
}

/** ECGSYN-style right-hand side (see module doc). */
export function ecgsynODE(t: number, z: number[], p: ODEParams): number[] {
  const n = p.nLeads;
  const dz = new Array<number>(n);
  const z0 = p.respAmp * Math.sin(p.respOmega * t);
  const dz0 = p.respAmp * p.respOmega * Math.cos(p.respOmega * t);
  const target = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    dz[i] = dz0;
    target[i] = z0;
  }
  for (const w of p.waves) {
    const d = t - w.center;
    const g = Math.exp(-d * d * w.inv2s2);
    if (g < 1e-12) continue;
    const dg = -d * w.invS2 * g; // = -(a/b^2) omega dTheta g / a
    for (let i = 0; i < n; i++) {
      dz[i] += w.amps[i] * dg;
      target[i] += w.amps[i] * g;
    }
  }
  for (let i = 0; i < n; i++) dz[i] -= RESTORE_RATE * (z[i] - target[i]);
  return dz;
}

export interface RenderResult {
  time: number[];
  leads: Map<BaseLead, number[]>;
  /** Mean ventricular rate (bpm) of the beats whose R peak falls in this chunk. */
  meanHeartRate: number;
}

export class ECGSynth {
  private readonly fs: number;
  private readonly tpl: BeatTemplate;
  private readonly amps: Map<string, Float64Array>;
  private readonly nLeads: number;
  private readonly rhythm: RhythmDescriptor;
  private readonly baseRR: number;
  private readonly rhythmRng: RandomSource;
  private readonly hrv?: HRVGenerator;
  private readonly noise: LeadNoise[] = [];
  private readonly fwaves?: FibrillatoryWaves;
  private readonly earliestOffset: number;
  /** indices into the integrated base-lead state of the requested leads */
  private readonly outIndex: number[];
  private readonly atrialHrv?: HRVGenerator;
  private readonly atrialRR: number;
  private readonly segmentSamples: number;
  private readonly respAmp: number;
  private readonly respOmega: number;

  /** R-peak times generated so far */
  private rTimes: number[] = [];
  /** index of the next beat whose waves have not been placed */
  private nextPlace = 0;
  private atrialNext = NaN;
  private atrialTimes: number[] = [];
  private afBlock: number[] = [];
  private waves: ActiveWave[] = [];

  private sampleIndex = 0;
  private z: number[] | undefined;

  constructor(private readonly cfg: SynthConfig) {
    const { params, samplingRate } = cfg;
    validateSamplingRate(samplingRate);
    validateParams(params);
    if (!Array.isArray(cfg.leads) || cfg.leads.length === 0 || cfg.leads.some(l => !BASE_LEADS.includes(l))) {
      throw new Error(`ECGSynth: leads must be a non-empty subset of ${BASE_LEADS.join(', ')}`);
    }
    this.fs = samplingRate;
    this.tpl = buildTemplate(params);
    this.amps = leadAmplitudes(this.tpl, cfg.pathology, BASE_LEADS);
    this.nLeads = BASE_LEADS.length;
    this.outIndex = cfg.leads.map(l => BASE_LEADS.indexOf(l));
    this.rhythm = cfg.rhythm ?? PATHOLOGY_RHYTHM[cfg.pathology];
    this.baseRR = 60 / params.heartRate;
    this.rhythmRng = cfg.streams.stream('rhythm');
    if (this.rhythm.kind === 'sinus' && cfg.variation > 0) {
      this.hrv = new HRVGenerator(cfg.streams.stream('hrv'), { respiratoryRate: params.respiratoryRate || 15 });
    }
    if (cfg.noise) {
      for (const lead of cfg.leads) {
        this.noise.push(new LeadNoise(cfg.noise, samplingRate, cfg.streams.stream(`noise:${lead}`)));
      }
    }
    if (this.rhythm.kind === 'atrialFibrillation') {
      this.fwaves = new FibrillatoryWaves(cfg.streams.stream('fwaves'));
    }
    this.respAmp = params.respiratoryRate && params.respiratoryAmplitude ? params.respiratoryAmplitude : 0;
    this.respOmega = 2 * Math.PI * ((params.respiratoryRate ?? 0) / 60);
    this.segmentSamples = Math.max(1, Math.round(SEGMENT_SECONDS * samplingRate));
    // (validateParams bounds widths and positions, so these never reach the
    // hard MAX_WAVE_REACH clamp; it only guarantees bounded look-ahead.)
    this.earliestOffset = Math.max(
      -MAX_WAVE_REACH,
      Math.min(0, ...this.tpl.waves.map(w => 1.2 * w.center - 1.2 * Math.abs(this.tpl.qrsOnset) - SUPPORT * w.sigma))
    );

    // Pre-roll: the first beat after t = 0 has its R peak at half an RR
    // interval (phase -pi at t = 0); enough earlier beats are scheduled so
    // that their tails (T, U waves) are present at t = 0.
    const rr0 = this.drawRR();
    const tailBound = Math.min(MAX_WAVE_REACH, Math.max(0.5, this.tpl.maxTail * 1.6 + 0.2));
    const preBeats = Math.ceil(tailBound / rr0) + 1;
    let r = 0.5 * rr0 - preBeats * rr0;
    this.rTimes.push(r);
    for (let k = 0; k < preBeats; k++) {
      r += k === preBeats - 1 ? rr0 : this.drawRR();
      this.rTimes.push(r);
    }
    if (this.rhythm.kind === 'avDissociation') {
      // Independent sinus node: its own mean rate (nominal +- 5 % per
      // recording) and its own sinus-arrhythmia/HRV, applied even at
      // variation 0, so the atrial and escape rhythms never phase-lock and
      // the P-QRS relation keeps drifting (true AV dissociation) even when the
      // nominal rates are commensurate (e.g. 75 / 37.5).
      const arng = cfg.streams.stream('atrial');
      const nominal = this.rhythm.atrialRate ?? DEFAULT_ATRIAL_RATE;
      const atrialRate = avoidCommensurateRate(nominal * (1 + ATRIAL_RATE_SPREAD * (2 * arng() - 1)), params.heartRate);
      this.atrialRR = 60 / atrialRate;
      this.atrialHrv = new HRVGenerator(arng, { respiratoryRate: params.respiratoryRate || 15, walkStd: 0.01 });
      this.atrialNext = this.rTimes[0] + arng() * this.atrialRR;
    } else {
      this.atrialRR = NaN;
    }
  }

  private drawRR(): number {
    const base = this.baseRR;
    switch (this.rhythm.kind) {
      case 'sinus':
        return this.hrv ? this.hrv.nextRR(base, this.cfg.variation) : base;
      case 'ventricular':
      case 'avDissociation':
        return this.cfg.variation > 0
          ? base * Math.max(0.9, Math.min(1.1, 1 + 0.01 * this.cfg.variation * gaussian(this.rhythmRng)))
          : base;
      case 'atrialFibrillation': {
        if (this.afBlock.length === 0) {
          // irregularly irregular: independent log-normal RR (CV ~0.25),
          // normalised per block of 8 beats to the requested mean rate
          const block: number[] = [];
          const sigma = 0.28;
          for (let i = 0; i < 8; i++) {
            const rr = base * Math.exp(sigma * gaussian(this.rhythmRng) - (sigma * sigma) / 2);
            block.push(Math.min(1.9 * base, Math.max(Math.max(0.25, 0.5 * base), rr)));
          }
          const scale = (8 * base) / block.reduce((a, b) => a + b, 0);
          this.afBlock = block.map(rr => Math.max(0.2, rr * scale));
        }
        return this.afBlock.shift() as number;
      }
    }
  }

  private addWaves(placed: PlacedWave[]): void {
    for (const p of placed) {
      const amps = this.amps.get(p.key);
      if (!amps) continue;
      this.waves.push({
        center: p.center,
        sigma: p.sigma,
        inv2s2: 1 / (2 * p.sigma * p.sigma),
        invS2: 1 / (p.sigma * p.sigma),
        amps,
      });
    }
  }

  /** Make sure every wave that starts before `tUntil` has been placed. */
  private ensureWaves(tUntil: number): void {
    const coupled = this.rhythm.kind !== 'avDissociation';
    const placed: PlacedWave[] = [];
    while (true) {
      const k = this.nextPlace;
      while (this.rTimes.length < k + 2) {
        this.rTimes.push(this.rTimes[this.rTimes.length - 1] + this.drawRR());
      }
      const rK = this.rTimes[k];
      if (rK + this.earliestOffset > tUntil) break;
      const rrNext = this.rTimes[k + 1] - rK;
      const rrPrev = k > 0 ? rK - this.rTimes[k - 1] : rrNext;
      placeBeat(this.tpl, rK, rrPrev, rrNext, coupled, placed);
      this.nextPlace++;
    }
    if (this.atrialHrv) {
      while (this.atrialNext + this.tpl.atrialLead - 1 < tUntil) {
        placeAtrial(this.tpl, this.atrialNext, placed);
        this.atrialTimes.push(this.atrialNext);
        this.atrialNext += this.atrialHrv.nextRR(this.atrialRR, 1);
      }
    }
    this.addWaves(placed);
  }

  private odeParams(t0: number, t1: number): { params: ODEParams; maxStep: number } {
    this.ensureWaves(t1 + 1);
    // prune waves that are over, and old beat history
    this.waves = this.waves.filter(w => w.center + SUPPORT * w.sigma >= t0 - 1);
    this.pruneHistory(t0 - HISTORY_SECONDS);
    const active = this.waves.filter(w => w.center - SUPPORT * w.sigma < t1 && w.center + SUPPORT * w.sigma > t0);
    let minSigma = Infinity;
    for (const w of active) minSigma = Math.min(minSigma, w.sigma);
    // Cap the step at 1.5 sigma of the narrowest active wave: the RK stages are
    // then at most ~sigma apart, so no wave can be stepped over unseen, while
    // accuracy is governed by the error tolerance.
    const maxStep = Number.isFinite(minSigma) ? Math.min(0.05, Math.max(1e-4, 1.5 * minSigma)) : 0.05;
    return {
      params: { waves: active, nLeads: this.nLeads, respAmp: this.respAmp, respOmega: this.respOmega },
      maxStep,
    };
  }

  /** Drop R-peak / P-wave times before `tMin` (keeps the beats still needed for placement). */
  private pruneHistory(tMin: number): void {
    if (this.rTimes.length >= HISTORY_PRUNE_MIN) {
      const drop = Math.min(lowerBound(this.rTimes, tMin), this.nextPlace - 2);
      if (drop > 0) {
        this.rTimes.splice(0, drop);
        this.nextPlace -= drop;
      }
    }
    if (this.atrialTimes.length >= HISTORY_PRUNE_MIN) {
      const drop = lowerBound(this.atrialTimes, tMin);
      if (drop > 0) this.atrialTimes.splice(0, drop);
    }
  }

  /** Render the next `n` samples (continuing from the previous call). */
  render(n: number): RenderResult {
    const fs = this.fs;
    const i0 = this.sampleIndex;
    const time = new Array<number>(n);
    for (let j = 0; j < n; j++) time[j] = (i0 + j) / fs;
    const nL = this.nLeads;
    const out: number[][] = BASE_LEADS.map(() => new Array<number>(n));

    let j = 0; // next output index within this chunk
    if (n > 0 && this.z === undefined) {
      // initial condition: exactly on the steady-state solution
      const { params } = this.odeParams(time[0], time[0]);
      const z = new Array<number>(nL);
      targetAt(params, time[0], z);
      this.z = z;
      for (let l = 0; l < nL; l++) out[l][0] = z[l];
      j = 1;
    }
    while (j < n) {
      const gIndex = i0 + j; // global index of first sample of this segment
      const segEndGlobal = Math.min(i0 + n - 1, (Math.floor(gIndex / this.segmentSamples) + 1) * this.segmentSamples);
      const tStart = (gIndex - 1) / fs;
      const tEnd = segEndGlobal / fs;
      const tEval: number[] = [];
      for (let g = gIndex; g <= segEndGlobal; g++) tEval.push(g / fs);
      const { params, maxStep } = this.odeParams(tStart, tEnd);
      const sol = solveODE(ecgsynODE, {
        initialConditions: this.z as number[],
        timeSpan: [tStart, tEnd],
        tEval,
        params,
        tolerance: this.cfg.tolerance,
        maxStepSize: maxStep,
      });
      for (let s = 0; s < sol.y.length; s++) {
        const y = sol.y[s];
        for (let l = 0; l < nL; l++) out[l][j + s] = y[l];
      }
      this.z = sol.y[sol.y.length - 1].slice();
      j += sol.y.length;
    }

    // additive components: f-waves (atrial activity) and noise
    const res: number[][] = this.outIndex.map(i => out[i]);
    const nOut = res.length;
    if (this.fwaves) {
      const gains = this.cfg.leads.map(l => FWAVE_LEAD_GAIN[l]);
      for (let s = 0; s < n; s++) {
        const f = this.fwaves.next(time[s]);
        for (let l = 0; l < nOut; l++) res[l][s] += gains[l] * f;
      }
    }
    if (this.noise.length) {
      for (let l = 0; l < nOut; l++) {
        const src = this.noise[l];
        const arr = res[l];
        for (let s = 0; s < n; s++) arr[s] += src.next(time[s]);
      }
    }
    for (let l = 0; l < nOut; l++) {
      const arr = res[l];
      for (let s = 0; s < n; s++) {
        if (!Number.isFinite(arr[s])) {
          throw new Error(`ECG synthesis produced a non-finite value at t = ${time[s]} s`);
        }
      }
    }

    this.sampleIndex += n;
    const leads = new Map<BaseLead, number[]>();
    this.cfg.leads.forEach((lead, l) => leads.set(lead, res[l]));
    return { time, leads, meanHeartRate: this.meanRate(i0 / fs, (i0 + n) / fs) };
  }

  /** Mean ventricular rate of beats with R peak in [t0, t1). */
  private meanRate(t0: number, t1: number): number {
    const r = this.rTimes;
    const first = lowerBound(r, t0);
    let sum = 0, count = 0;
    for (let k = first; k + 1 < r.length && r[k] < t1; k++) {
      sum += r[k + 1] - r[k];
      count++;
    }
    if (count === 0) {
      // no R peak inside the chunk: rate of the RR interval spanning t0
      const k = first > 0 && (first >= r.length || r[first] > t0) ? first - 1 : first;
      if (k >= 0 && k + 1 < r.length && r[k] <= t0 && r[k + 1] > t0) return 60 / (r[k + 1] - r[k]);
      return 60 / this.baseRR;
    }
    return 60 / (sum / count);
  }

  /** Independent atrial (P-wave peak) times scheduled so far (AV dissociation only; at least the last 60 s). */
  get independentPWaveTimes(): readonly number[] {
    return this.atrialTimes;
  }

  /** R-peak times scheduled so far (s), including pre-roll beats before t = 0 (at least the last 60 s are kept). */
  get rPeakTimes(): readonly number[] {
    return this.rTimes;
  }
}
