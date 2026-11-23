/**
 * Small deterministic pseudo-random number utilities.
 *
 * All randomness in the generator goes through these helpers so that a single
 * `seed` makes every stochastic component (biological variation, rhythm, noise,
 * fibrillatory waves) reproducible. Independent components draw from
 * independent streams derived from the seed and a stream name, so e.g. adding
 * noise does not change the RR sequence.
 */

/** A function returning uniformly distributed numbers in [0, 1). */
export type RandomSource = () => number;

/** 32-bit FNV-1a hash of a string, mixed with a numeric seed. */
export function hashSeed(seed: number, stream: string): number {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < stream.length; i++) {
    h ^= stream.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // final avalanche (murmur3 fmix32)
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 PRNG: fast, 32-bit state, good enough statistical quality for signal synthesis. */
export function mulberry32(seed: number): RandomSource {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Factory for named, independent random streams.
 * Without a seed, the base seed itself is drawn from Math.random.
 *
 * Every distinct finite seed selects its own family of streams: integer
 * seeds in [0, 2^32) are used directly, any other finite number (negative,
 * fractional, >= 2^32) is identified by its full IEEE-754 bit pattern, so
 * e.g. 0, -1, 0.5 and 2^32 + 1 all differ. (-0 is treated as 0.)
 */
export class RandomStreams {
  /** Low 32 bits of the seed identity (the seed itself for integer seeds in [0, 2^32)). */
  readonly baseSeed: number;
  /** High word of the seed identity: 0 for integer seeds in [0, 2^32), otherwise (float64 high word + 1), never 0. */
  readonly seedHigh: number;

  constructor(seed?: number) {
    if (seed !== undefined && (typeof seed !== 'number' || !Number.isFinite(seed))) {
      throw new Error(`Invalid seed: expected a finite number, got ${seed}`);
    }
    if (seed === undefined) {
      this.baseSeed = Math.floor(Math.random() * 4294967296) >>> 0;
      this.seedHigh = 0;
    } else if (Number.isInteger(seed) && seed >= 0 && seed < 4294967296) {
      this.baseSeed = seed >>> 0; // also maps -0 to 0
      this.seedHigh = 0;
    } else {
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, seed);
      this.baseSeed = view.getUint32(4);
      // a finite double's high word is never 0xffffffff (that is NaN space), so this is never 0
      this.seedHigh = (view.getUint32(0) + 1) >>> 0;
    }
  }

  stream(name: string): RandomSource {
    const key = this.seedHigh === 0 ? name : `${name}#${this.seedHigh.toString(16)}`;
    return mulberry32(hashSeed(this.baseSeed, key));
  }
}

/** Standard normal variate (Box-Muller) from a uniform source. */
export function gaussian(rng: RandomSource): number {
  let u1 = rng();
  while (u1 <= 1e-300) u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
