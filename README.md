# Open ECG Generator

Synthetic electrocardiogram generator and viewer for teaching and software testing.

> **Disclaimer:** the signals are produced by a mathematical model. They are not recordings
> of real patients and must not be used for clinical diagnosis or for validating medical devices.

The repository is an npm workspaces monorepo:

```
packages/
├── core/   @open-ecg-generator/core – TypeScript ECG signal library (ESM, no runtime dependencies)
└── app/    React + Vite viewer that renders the signals on standard ECG paper
docs/       Technical documentation (model, presets, solver)
```

## Core library

- ECGSYN-style dynamical model (McSharry et al., 2003) integrated with an adaptive
  Dormand–Prince 5(4) solver.
- Wave amplitudes are true peak values in mV (lead II).
- Rate-aware timing: QRS duration is constant, PR shortens slightly with rate, QT follows
  Fridericia's correction and never runs into the next QRS.
- 12 standard leads. I, II and V1–V6 are synthesised with lead-specific amplitudes; III, aVR,
  aVL and aVF are derived exactly from I and II (Einthoven/Goldberger).
- 14 deterministic presets: `normal`, `bradycardia`, `tachycardia`, `firstDegreeAVBlock`,
  `atrialFibrillation`, `ventricularTachycardia`, `completeHeartBlock`, `stemi` (inferior),
  `lbbb`, `rbbb`, `hyperkalemia`, `hypokalemia`, `lvh`, `pericarditis`.
- Optional biological variation (`variation`, 0–1) and heart-rate variability, all reproducible
  with a `seed`.
- Noise: baseline wander, 50/60 Hz powerline, band-limited muscle noise, white Gaussian noise.
- Seamless chunked streaming (`generateStream`), finite or endless.
- Invalid input throws a descriptive `Error`.

```ts
import { ECGGenerator, getPathologyParams } from '@open-ecg-generator/core';

const gen = new ECGGenerator(500);              // sampling rate in Hz, must be >= 250

// Lead II, 10 s, normal sinus rhythm at 72 bpm
const ecg = gen.generate({ heartRate: 72, duration: 10, seed: 42 });
ecg.time;    // seconds, time[i] = i / 500
ecg.signal;  // mV

// 12 leads of the same recording, with a preset, variation and noise
const leads = gen.generateMultiLead({
  pathology: 'stemi',
  variation: 0.3,
  seed: 7,
  noise: { gaussian: { amplitude: 0.01 }, powerline: { amplitude: 0.02, frequency: 50 } },
});
leads.aVF.signal;

// Override only part of a preset (here: the T-wave amplitude)
gen.generate({ pathology: 'lbbb', customParams: { T: { amplitude: -0.4 } } });

// Continuous 1-second chunks; omit `duration` for an endless stream
for (const chunk of gen.generateStream({ pathology: 'atrialFibrillation', duration: 30 }, 1)) {
  // chunk.time continues where the previous chunk ended
}

getPathologyParams('hyperkalemia');             // resolved preset parameters (fresh copy)
```

Parameters are resolved in this order: preset (`pathology`, default `normal`) → `heartRate`
(default: the preset's typical rate) → `variation` → `customParams` (only the fields given).
`gen.resolveParams(options)` returns the parameters a call would use. See
[docs/technical-documentation.md](docs/technical-documentation.md) for the model, the presets
and the full option list.

## Viewer app

The app renders the core's output on ECG paper (1 mm / 5 mm grid) as a 12-lead layout, a rhythm
strip or a single lead. Paper speed (25 or 50 mm/s), gain (5, 10 or 20 mm/mV), heart rate
(30–200 bpm), pathology, noise level and respiratory baseline wander can be adjusted, wave
parameters can be edited, **New** generates a new variation, and the view can be exported as PNG.

## Development

Requires Node.js 18 or later.

```bash
npm ci                 # install (use `npm install` to update package-lock.json)
npm run dev            # build core, then start the Vite dev server at http://localhost:5173/
npm run dev:core       # optional, in a second terminal: rebuild core on change (tsc --watch)
npm test               # run the core test suite (vitest)
npm run test:watch -w packages/core   # tests in watch mode
npm run build          # build core, then the app (packages/app/dist)
npm run preview        # serve the production build locally
```

Production builds use the base path `/open-ecg-generator/` (GitHub Pages); set `VITE_BASE` to
host elsewhere, e.g. `VITE_BASE=/ npm run build`. `npm run preview` serves the build at the same
base (http://localhost:4173/open-ecg-generator/); pass the same `VITE_BASE` to preview a custom-base build.

### Deployment

Pushes to `main` run `.github/workflows/deploy.yml`: `npm ci`, `npm test`, `npm run build`, then
publish `packages/app/dist` to the `gh-pages` branch.

To deploy manually, run `npm run deploy`. It builds, then force-pushes the build output (plus
`.nojekyll`) to `gh-pages` on `origin` from a temporary repository; it does not switch branches or
modify your working tree. Options: `npm run deploy -- --dry-run` (prepare but do not push) and
`npm run deploy -- --skip-build` (publish the existing `packages/app/dist`).

## License

[MIT](LICENSE). The disclaimer above is a statement about intended use, not a licence restriction.
