/**
 * 12-lead model.
 *
 * Only eight leads are independent: I, II and V1-V6. Each wave of a beat has
 * a lead-specific amplitude expressed as a ratio to its lead-II amplitude
 * (the amplitude in ECGSynParameters). III, aVR, aVL and aVF are then derived
 * exactly with Einthoven's and Goldberger's equations, so
 *   III = II - I, aVR = -(I + II) / 2, aVL = I - II / 2, aVF = II - I / 2
 * hold sample by sample, including noise (noise is generated per electrode
 * pair for I and II and independently per precordial lead).
 */

import { PathologyType } from './types.js';
import { BeatTemplate, WaveKind } from './rate.js';

export type LeadName =
  | 'I' | 'II' | 'III' | 'aVR' | 'aVL' | 'aVF'
  | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6';

export const STANDARD_LEADS: readonly LeadName[] = [
  'I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6',
];

/** Leads that are synthesised directly (everything else is derived). */
export type BaseLead = 'I' | 'II' | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6';
export const BASE_LEADS: readonly BaseLead[] = ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

/** Ratios to the lead-II amplitude, in the order [I, V1, V2, V3, V4, V5, V6]. */
type Ratios = readonly [number, number, number, number, number, number, number];
type LeadTable = Partial<Record<string, Ratios>>;

const RATIO_LEADS: readonly BaseLead[] = ['I', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

const NORMAL_TABLE: Required<Pick<LeadTable, 'P' | 'Q' | 'R' | 'S' | 'T'>> = {
  //    I     V1    V2    V3    V4    V5    V6
  P: [0.5, 0.5, 0.6, 0.6, 0.6, 0.6, 0.6],
  Q: [0.8, 0, 0, 0, 0.5, 1.0, 1.2],            // septal q only laterally
  R: [0.58, 0.2, 0.45, 0.8, 1.25, 1.3, 1.05],  // R-wave progression
  S: [0.5, 3.6, 5.6, 4.0, 2.0, 0.8, 0.4],      // deep S in V1-V2, transition V3-V4
  T: [0.73, 0.3, 1.4, 1.5, 1.3, 1.0, 0.8],
};

const TABLES: Partial<Record<PathologyType, LeadTable>> = {
  hyperkalemia: {
    T: [0.73, 0.6, 1.6, 1.7, 1.5, 1.1, 0.9],
  },
  hypokalemia: {
    X0: [0.73, 0.3, 1.0, 1.2, 1.2, 1.0, 0.8],
    X1: [0.6, 1.2, 1.8, 1.8, 1.4, 1.0, 0.8], // U wave most prominent V2-V3
  },
  ventricularTachycardia: {
    R: [-0.3, 0.9, 0.8, 0.5, 0.2, -0.1, -0.3],
    S: [1.0, 0.2, 0.6, 1.2, 1.8, 2.2, 2.4],
    T: [-0.5, 0.8, 0.7, 0.3, -0.3, -0.6, -0.7], // discordant to the QRS
  },
  stemi: {
    // inferior STEMI: Q and ST elevation in II, III, aVF; reciprocal ST
    // depression in I, aVL and V1-V3 (posterior), lateral extension V5-V6
    Q: [0, 0, 0, 0, 0, 0.25, 0.3],
    R: [0.6, 0.3, 0.68, 1.2, 1.9, 1.95, 1.6],
    S: [0.5, 18, 28, 20, 10, 4, 2],
    T: [-0.1, 0.18, 0.84, 0.9, 0.78, 0.6, 0.48],  // precordial T as in the normal ECG; inverted in aVL
    X0: [-0.2, -0.3, -0.45, -0.3, 0, 0.1, 0.15],  // III > II (RCA pattern), reciprocal in aVL > I
  },
  completeHeartBlock: {
    R: [0.7, 0.15, 0.3, 0.6, 1.0, 1.3, 1.3],
    S: [0.8, 3, 3.5, 2, 1, 0.3, 0.2],
    T: [0.9, -0.8, -0.8, -0.3, 0.5, 1.2, 1.1],
  },
  lbbb: {
    // broad notched R in I, aVL, V5-V6; QS / rS with discordant ST-T in V1-V3
    R: [1.2, 0.15, 0.2, 0.3, 0.6, 1.3, 1.4],
    X0: [1.1, -1.8, -2.3, -1.5, -0.7, 1.4, 1.5],  // late transition (V5)
    S: [1, 4, 6, 4, 2, 0.5, 0.2],
    X1: [1.3, -1.5, -2, -1.2, -0.3, 1.3, 1.3],
    T: [1.3, -1.2, -1.5, -1.0, -0.3, 1.3, 1.2],
  },
  rbbb: {
    // rsR' in V1-V2 (terminal S wave of the limb leads is the R' there),
    // broad terminal S in I and V6, secondary T inversion V1-V2
    R: [0.6, 0.3, 0.5, 0.9, 1.3, 1.4, 1.2],
    X0: [1, 25, 20, 5, 1, 1, 1],
    S: [2.0, -3.2, -1.9, 0.4, 1.2, 1.6, 1.8],  // terminal vector to the right and anterior
    T: [1.0, -1.0, -0.5, 1.2, 1.4, 1.2, 1.0],
  },
  lvh: {
    R: [1.1, 0.1, 0.25, 0.6, 1.3, 1.55, 1.35],
    S: [0.4, 6.5, 8, 5, 2, 0.6, 0.3],
    T: [1.0, -1.0, -1.0, -0.3, 0.5, 1.3, 1.3],   // strain pattern in I, aVL, V5-V6
    X0: [1.0, -1.0, -1.0, -0.3, 0.5, 1.3, 1.3],
  },
  pericarditis: {
    X0: [0.7, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6], // PR depression (PR elevation in aVR)
    X1: [0.8, 0.2, 0.9, 1.0, 1.0, 0.9, 0.8], // diffuse ST elevation (depression in aVR)
    S: [0.8, 9, 14, 10, 5, 1.5, 0.8],        // precordial S waves as in the normal ECG
    T: [0.73, 0.3, 1.2, 1.3, 1.2, 1.0, 0.8],
  },
};

/** Fibrillatory-wave amplitude per base lead, relative to the f-wave source. */
export const FWAVE_LEAD_GAIN: Record<BaseLead, number> = {
  I: 0.2, II: 0.6, V1: 1.0, V2: 0.7, V3: 0.45, V4: 0.3, V5: 0.2, V6: 0.15,
};

function fallbackKey(kind: WaveKind): 'P' | 'R' | 'T' {
  return kind === 'atrial' ? 'P' : kind === 'depolarization' ? 'R' : 'T';
}

/**
 * Amplitude (mV) of every template wave in each requested base lead.
 * Returns a map wave key -> Float64Array aligned with `leads`.
 */
export function leadAmplitudes(
  tpl: BeatTemplate,
  pathology: PathologyType,
  leads: readonly BaseLead[]
): Map<string, Float64Array> {
  const table = TABLES[pathology] ?? {};
  const out = new Map<string, Float64Array>();
  for (const w of tpl.waves) {
    const main = (w.key === 'P' || w.key === 'Q' || w.key === 'R' || w.key === 'S' || w.key === 'T') ? w.key : undefined;
    const ratios: Ratios = table[w.key]
      ?? (main ? NORMAL_TABLE[main] : undefined)
      ?? table[fallbackKey(w.kind)]
      ?? NORMAL_TABLE[fallbackKey(w.kind)] as Ratios;
    const amps = new Float64Array(leads.length);
    leads.forEach((lead, i) => {
      amps[i] = lead === 'II' ? w.amplitude : w.amplitude * ratios[RATIO_LEADS.indexOf(lead)];
    });
    out.set(w.key, amps);
  }
  return out;
}

export function isLeadName(name: string): name is LeadName {
  return (STANDARD_LEADS as readonly string[]).includes(name);
}

/** Base leads needed to produce the requested leads. */
export function requiredBaseLeads(leads: readonly LeadName[]): BaseLead[] {
  const need = new Set<BaseLead>();
  for (const l of leads) {
    if (l === 'I' || l === 'II') need.add(l);
    else if (l === 'III' || l === 'aVR' || l === 'aVL' || l === 'aVF') { need.add('I'); need.add('II'); }
    else need.add(l);
  }
  return BASE_LEADS.filter(l => need.has(l));
}

/** Derive a limb lead from leads I and II (Einthoven / Goldberger). */
export function deriveLimbLead(lead: 'III' | 'aVR' | 'aVL' | 'aVF', I: number[], II: number[]): number[] {
  const n = I.length;
  const out = new Array<number>(n);
  switch (lead) {
    case 'III': for (let i = 0; i < n; i++) out[i] = II[i] - I[i]; break;
    case 'aVR': for (let i = 0; i < n; i++) out[i] = -(I[i] + II[i]) / 2; break;
    case 'aVL': for (let i = 0; i < n; i++) out[i] = I[i] - II[i] / 2; break;
    case 'aVF': for (let i = 0; i < n; i++) out[i] = II[i] - I[i] / 2; break;
  }
  return out;
}
