// Generates synthetic 12-lead ECGs for every pathology with the app's default
// settings and writes them as raw float32 (n x 12 x samples, mV) for classify.py.
// Usage: node export.mjs [count=20] [noiseLevel=0.15] [variation=0.3]
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const core = await import(join(here, '../packages/core/dist/index.js'));
const { ECGGenerator, PATHOLOGY_TYPES, PATHOLOGY_DEFAULT_HEART_RATE, STANDARD_LEADS } = core;

const count = Number(process.argv[2] ?? 20);
const level = Number(process.argv[3] ?? 0.15);
const variation = Number(process.argv[4] ?? 0.3);
const FS = 500, DURATION = 10, N = FS * DURATION;
// same mapping as packages/app/src/types.ts noiseFromLevel()
const noise = level > 0 ? {
  baseline: { amplitude: 0.2 * level, frequency: 0.25 },
  muscle: { amplitude: 0.05 * level },
  gaussian: { amplitude: 0.015 * level },
  powerline: { amplitude: 0.02 * level, frequency: 50 },
} : undefined;

const out = join(here, 'out'); mkdirSync(out, { recursive: true });
const gen = new ECGGenerator(FS);
const index = { fs: FS, samples: N, leads: [...STANDARD_LEADS], count, noiseLevel: level, variation, pathologies: [] };
for (const pathology of PATHOLOGY_TYPES) {
  const buf = new Float32Array(count * 12 * N);
  const rates = [];
  for (let k = 0; k < count; k++) {
    const res = gen.generateMultiLead({
      pathology, heartRate: PATHOLOGY_DEFAULT_HEART_RATE[pathology], duration: DURATION, samplingRate: FS,
      variation, seed: 1000 + k, noise, customParams: { respiratoryAmplitude: 0 },
    }, [...STANDARD_LEADS]);
    STANDARD_LEADS.forEach((lead, li) => buf.set(res[lead].signal, (k * 12 + li) * N));
    rates.push(res.II.metadata.heartRate);
  }
  writeFileSync(join(out, `${pathology}.f32`), Buffer.from(buf.buffer));
  index.pathologies.push({ name: pathology, file: `${pathology}.f32`, heartRates: rates });
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 1));
console.log(`wrote ${PATHOLOGY_TYPES.length} pathologies x ${count} ECGs to ${out}`);
