# Technical Documentation

This document describes how `@open-ecg-generator/core` (`packages/core`) synthesises ECG
signals. All statements refer to the implementation in that package; file names are relative
to it.

## 1. Model

The generator is a variant of the ECGSYN dynamical model (McSharry et al., *IEEE Trans.
Biomed. Eng.* 50(3), 2003). Each beat is a sum of Gaussian waves (P, Q, R, S, T plus optional
extra waves). For each synthesised lead the signal `z` obeys (`models/synth.ts`)

```
dz/dt = Σᵢ aᵢ · d/dt gᵢ(t)  +  dz₀/dt  −  K · ( z − z₀(t) − Σᵢ aᵢ · gᵢ(t) )

gᵢ(t) = exp( −(t − cᵢ)² / (2σᵢ²) )        z₀(t) = A_resp · sin(2π f_resp t)        K = 1 s⁻¹
```

where `cᵢ` and `σᵢ` are the wave's centre and Gaussian width in seconds for the current beat.
Differences from the original ECGSYN:

- **True-mV amplitudes.** The Gaussian-derivative term is scaled by `a/b²`, so `aᵢ` is the true
  peak deflection in mV, independent of width and heart rate.
- **No baseline depression or start-up transient.** The restoring term pulls `z` towards the
  respiratory baseline *plus the wave sum*, not towards the baseline alone. The initial state is
  placed on the steady-state solution, so the output is valid from sample 0: the first R peak
  equals later ones and the isoelectric line is at 0 mV. The first R peak of a recording is at
  RR/2, so at fast rates sample 0 can lie inside a T wave of the preceding (pre-roll) beat.
- **Explicit beat schedule.** Instead of a phase oscillator with a fixed angular velocity, every
  beat has its own R-peak time from the rhythm model (§3) and its waves are placed by the
  rate-aware mapping (§2). This allows HRV, irregular AF intervals and AV dissociation.

Waves are symmetric Gaussians, so the T wave is not physiologically asymmetric.

### Parameters (`models/types.ts`)

```ts
interface WaveParameters {
  amplitude: number; // true peak in mV (lead II)
  width: number;     // Gaussian sigma, radians at the 60 bpm reference, > 0
  position: number;  // centre relative to the R peak, radians at the 60 bpm reference
}

interface ECGSynParameters {
  P, Q, R, S, T: WaveParameters;
  heartRate: number;              // mean ventricular rate, bpm
  respiratoryRate?: number;       // breaths/min (respiratory baseline modulation)
  respiratoryAmplitude?: number;  // mV
  extraWaves?: WaveParameters[];  // U wave, ST plateau, R', PR depression, ...
}
```

Angles are referenced to one cycle at 60 bpm, so 1 rad = 1000/(2π) ms ≈ 159.2 ms. The helper
`waveMs(amplitude, centerMs, sigmaMs)` builds a wave from milliseconds; all presets are written
this way. Every value must be finite and every width > 0.

## 2. Rate-aware timing (`models/rate.ts`)

In the original ECGSYN all waves sit at fixed phases, so every interval scales linearly with RR.
Here each wave is classified and mapped to a time offset from its own R peak:

| Class | Waves | Mapping |
|---|---|---|
| Depolarisation | Q, R, S, extra waves centred inside the QRS | fixed in ms: QRS duration does not depend on rate |
| Atrial | P, extra waves centred before QRS onset | distance to QRS onset × RR^0.15 (clamped 0.75–1.15), using the preceding RR |
| Repolarisation | T, extra waves after the S wave | distance from the J point and widths scaled so QT = QTc · RR^(1/3) (Fridericia), using the following RR |

Wave extents are measured at 2.45 σ (5 % of peak). Repolarisation is additionally limited so that
it ends at least 10 ms before the next QRS onset; waves never wrap into the next cycle. A coupled
P wave may still sit on the end of the T wave when PR + QT exceeds RR (above roughly 150 bpm, or
first-degree AV block at fast rates).

For the normal preset this gives a QRS of about 87 ms at every rate, a PR of about 156 ms and a
QT of about 400 ms at 60 bpm (QTcF ≈ 400 ms at all rates), with PR shortening to about 140 ms and
QT to about 280 ms at 180 bpm.

## 3. Rhythms (`models/pathologies.ts`, `models/synth.ts`)

| Rhythm | Used by | Beat schedule |
|---|---|---|
| Sinus | all presets not listed below | regular RR = 60/heartRate. With `variation` > 0, RR is modulated by `HRVGenerator`: respiratory sinus arrhythmia, a ~0.1 Hz Mayer-wave component and a correlated random walk, scaled by `variation` |
| Atrial fibrillation | `atrialFibrillation` | independent log-normal RR intervals (CV ≈ 0.25), normalised in blocks of 8 beats to the requested mean rate; no P waves; f-waves added (below) |
| Ventricular | `ventricularTachycardia` | regular; with `variation` > 0, RR jitter with SD 1 % × `variation` (clamped to ±10 %) |
| AV dissociation | `completeHeartBlock` | ventricular escape rhythm as above; P waves at an independent atrial rate of 75/min, not coupled to the QRS |

**f-waves** (`models/noise.ts`): a phase-continuous quasi-periodic oscillation with a mean
frequency of 6 Hz, slowly varying between about 4.8 and 7.2 Hz (≈ 290–430 per minute), with
amplitude modulation and a weak second harmonic. The source amplitude is 0.08 mV, scaled per lead
(V1 × 1.0, II × 0.6, I × 0.2, …).

Second-degree AV block, ectopic beats and other arrhythmias are not implemented.

## 4. Pathology presets

`getPathologyParams(pathology, heartRate?)` returns a fresh, deterministic copy of a preset
(lead-II morphology). Without `heartRate` the preset's typical rate is used
(`PATHOLOGY_DEFAULT_HEART_RATE`). Lead-specific morphology is in `models/leads.ts`.

| Preset | Default rate | Lead II morphology |
|---|---|---|
| `normal` | 70 | P 0.15 mV, R 1.2 mV, small q and s, T 0.3 mV, PR ≈ 150 ms, QRS ≈ 87 ms, QTc ≈ 400 ms |
| `bradycardia` / `tachycardia` | 45 / 140 | normal morphology; PR and QT adapt through the rate mapping |
| `firstDegreeAVBlock` | 70 | P moved earlier, PR ≈ 280 ms at 70 bpm and > 200 ms at any rate |
| `atrialFibrillation` | 110 | no P waves, f-waves, irregularly irregular RR, narrow QRS |
| `ventricularTachycardia` | 180 | no P waves, wide QRS (≈ 160 ms), discordant T |
| `completeHeartBlock` | 40 | P at 75/min marching through a wide escape QRS (≈ 135 ms), discordant T, varying PR |
| `stemi` | 70 | inferior STEMI: pathological Q (> 25 % of R, ≈ 40 ms), reduced R, ST elevation ≈ 0.3 mV merging into a hyperacute T; ST elevation in II, III, aVF with reciprocal depression in I/aVL |
| `lbbb` | 70 | no septal q, broad notched R, QRS ≈ 150 ms, discordant ST depression and T inversion; deep QS in V1 |
| `rbbb` | 70 | QRS ≈ 135 ms, broad terminal S in II, I and V6; rsR′ with T inversion in V1 |
| `hyperkalemia` | 70 | flat P (0.07 mV), QRS ≈ 110 ms, tall narrow tented T (≈ 0.85 mV), short QT |
| `hypokalemia` | 70 | flat T (0.08 mV), ST depression, U wave (0.15 mV) larger than T |
| `lvh` | 70 | tall R (1.9 mV), Sokolow–Lyon S(V1) + R(V5) ≈ 4.9 mV, strain ST depression and T inversion laterally |
| `pericarditis` | 70 | PR depression, diffuse concave ST elevation; reversed (PR elevation, ST depression) in aVR |

ST segments, U waves, notches, R′ and PR depression are modelled as `extraWaves`.

`PATHOLOGY_PARAMS[p](base?)` and `ENHANCED_PATHOLOGY_PARAMS[p](base?)` are kept for
compatibility; both return `getPathologyParams(p)` and ignore `base`.

## 5. Leads (`models/leads.ts`)

Only I, II and V1–V6 are synthesised. Each wave has a per-lead amplitude given as a ratio to its
lead-II amplitude (normal R-wave progression and transition at V3–V4; preset-specific tables for
VT, STEMI, heart block, bundle branch blocks, LVH, pericarditis and the potassium disorders). The
remaining limb leads are derived exactly:

```
III = II − I     aVR = −(I + II)/2     aVL = I − II/2     aVF = II − I/2
```

The identities hold sample by sample (to < 1e-12), with or without noise. All leads of one call
share the same beat schedule.

## 6. Noise (`models/noise.ts`)

All amplitudes are in mV. Each synthesised lead gets its own random stream and a random coupling
gain (0.7–1.3) and phase for the sinusoidal components.

| Option | Signal |
|---|---|
| `baseline: { amplitude, frequency }` | sinusoidal baseline wander (typically 0.05–0.5 Hz), peak amplitude |
| `powerline: { amplitude, frequency: 50 \| 60 }` | sinusoidal mains interference, peak amplitude; must be below Nyquist |
| `muscle: { amplitude }` | white Gaussian noise band-passed 20–150 Hz (4th-order high- and low-pass, upper corner clamped below Nyquist), RMS amplitude |
| `gaussian: { amplitude }` | white Gaussian noise, standard deviation |

Separately, `respiratoryRate` / `respiratoryAmplitude` in the parameters add the respiratory
baseline `z₀(t)` inside the model (presets use 15 /min and 0.01 mV).

## 7. ODE solver (`math/ode-solver.ts`)

`solveODE` is an adaptive explicit Dormand–Prince 5(4) Runge–Kutta method (the method of MATLAB's
`ode45` and SciPy's `RK45`):

- step-size control from the embedded 4th-order estimate with a mixed absolute/relative RMS error
  norm (`tolerance`, or `absTolerance` / `relTolerance`);
- 4th-order dense output onto the requested times (`timePoints` or `tEval`) in linear time;
  `timePoints = 1` returns the initial point;
- options `minStepSize`, `maxStepSize`, `initialStepSize`, `maxSteps` (default 1e7);
- throws on non-finite state, step-size underflow or exceeding `maxSteps`.

The generator integrates in 0.5 s segments aligned to absolute sample indices and caps the step at
1.5 σ of the narrowest active wave, so no wave can be stepped over. `solverTolerance` (default
1e-6) sets both tolerances; the maximum error against the exact solution is about 1.7e-5 mV at
1e-6 and 1.3e-6 mV at 1e-7.

## 8. API (`index.ts`)

### `new ECGGenerator(samplingRate = 1000)`

Throws if `samplingRate` < 250 Hz.

| Method | Returns |
|---|---|
| `generate(options)` | `ECGResult` for lead II |
| `generateMultiLead(options, leads = all 12)` | `{ [lead]: ECGResult }` in the requested order; unknown lead names throw |
| `generateStream(options, chunkDuration = 1)` | generator of lead-II `ECGResult` chunks; state, rhythm and noise carry over, so the concatenation equals one recording (matches `generate()` to within 1e-4 mV); endless if `duration` is undefined |
| `resolveParams(options)` | the `ECGSynParameters` a call with these options would use |

### `ECGGeneratorOptions`

| Option | Default | Meaning |
|---|---|---|
| `samplingRate` | constructor value | Hz, ≥ 250 |
| `duration` | 10 s (stream: endless) | > 0 |
| `pathology` | `'normal'` | one of the 14 presets (`PATHOLOGY_TYPES`) |
| `heartRate` | preset default | mean ventricular rate, bpm, > 0 |
| `variation` | 0 | 0–1. Jitters the resolved waves once per generation (amplitude SD 15 %·v, width 10 %·v, position 0.04·v rad; R stays at 0) and enables HRV for sinus rhythms |
| `customParams` | – | `Partial<ECGSynParameters>`; only given fields override, waves may be partial |
| `noise` | none | see §6; all values ≥ 0 |
| `solverTolerance` | 1e-6 | > 0 |
| `seed` | from `Math.random` | seeds independent streams for variation, rhythm, HRV, f-waves and per-lead noise |

Precedence: preset → `heartRate` → `variation` → `customParams`.

### `ECGResult`

```ts
{
  time: number[];      // seconds, time[i] = globalSampleIndex / samplingRate
  signal: number[];    // mV
  samplingRate: number;
  metadata: { duration, heartRate /* actual mean ventricular rate of the output */, pathology, noise };
}
```

Invalid input throws an `Error` naming the problem: sampling rate < 250 Hz, non-positive or
non-finite heart rate, duration or chunk duration, width ≤ 0, any non-finite parameter,
`variation` outside 0–1, tolerance ≤ 0, negative noise, unknown pathology or lead.

### Other exports

- `getPathologyParams`, `PATHOLOGY_DEFAULT_HEART_RATE`, `PATHOLOGY_TYPES`, `STANDARD_LEADS`,
  `waveMs`, `DEFAULT_ECGSYN_PARAMS` (= `getPathologyParams('normal')`).
- `generateECGSyn(duration, fs, params?, tol?)`: clean lead II with a regular rhythm.
- `generateNormalECG(duration?, heartRate?, fs?)`, `generatePathologicalECG(pathology, duration?, fs?)`.
- `solveODE`, `interpolate`.
- `enhancements/realistic-features.ts`: `HRVGenerator` and `QTCorrection` (used by the generator),
  plus optional helpers that are not used by the generator: `LeadMorphology` (single-dipole lead
  projection), `ArtifactGenerator` (stand-alone artifact signals), `DemographicAdjustments`,
  `PathologyProgression` (ischaemia onset) and `ExerciseResponse`.
- Types: `ECGGeneratorOptions`, `ECGResult`, `ECGSynParameters`, `WaveParameters`,
  `PathologyType`, `NoiseOptions`, `LeadName`, `ODEFunction`, `ODESolverOptions`, `ODESolution`,
  `HRVParams`, `DemographicParams`.

## 9. Build, test and deploy

Core is ESM compiled with `tsc` (`module`/`moduleResolution: NodeNext`, so relative imports use
`.js` extensions). Tests are in `packages/core/tests` and run with vitest (`npm test`); they cover
the model properties above (steady state, amplitudes, intervals across rates, every preset's
morphology, lead identities, streaming continuity, noise spectra, solver accuracy and input
validation). Development, build and deployment commands are listed in the [README](../README.md).

## References

- P. E. McSharry, G. D. Clifford, L. Tarassenko, L. A. Smith. A dynamical model for generating
  synthetic electrocardiogram signals. *IEEE Trans. Biomed. Eng.* 50(3):289–294, 2003.
- L. S. Fridericia. Die Systolendauer im Elektrokardiogramm bei normalen Menschen und bei
  Herzkranken. *Acta Med. Scand.* 53:469–486, 1920.
