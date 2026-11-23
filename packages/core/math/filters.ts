/**
 * Minimal stateful IIR filters used to synthesise band-limited noise.
 * State is kept inside the filter object, so filtering a signal in several
 * consecutive chunks gives exactly the same output as filtering it at once.
 */

/** Second-order IIR section (RBJ audio-EQ-cookbook design), direct form I. */
export class Biquad {
  private b0: number;
  private b1: number;
  private b2: number;
  private a1: number;
  private a2: number;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  private constructor(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  /** Butterworth (Q = 1/sqrt(2)) low-pass with cutoff `fc` Hz at sampling rate `fs`. */
  static lowpass(fc: number, fs: number, q: number = Math.SQRT1_2): Biquad {
    const w0 = 2 * Math.PI * fc / fs;
    const alpha = Math.sin(w0) / (2 * q);
    const cos = Math.cos(w0);
    return new Biquad((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
  }

  /** Butterworth (Q = 1/sqrt(2)) high-pass with cutoff `fc` Hz at sampling rate `fs`. */
  static highpass(fc: number, fs: number, q: number = Math.SQRT1_2): Biquad {
    const w0 = 2 * Math.PI * fc / fs;
    const alpha = Math.sin(w0) / (2 * q);
    const cos = Math.cos(w0);
    return new Biquad((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

/** A cascade of biquads applied in series. */
export class FilterChain {
  constructor(private readonly sections: Biquad[]) {}

  process(x: number): number {
    let y = x;
    for (const s of this.sections) y = s.process(y);
    return y;
  }

  reset(): void {
    for (const s of this.sections) s.reset();
  }

  /**
   * Output RMS for unit-variance white input, from the energy of the impulse response.
   * Resets the filter state.
   */
  whiteNoiseGain(length: number = 8192): number {
    this.reset();
    let energy = 0;
    for (let i = 0; i < length; i++) {
      const y = this.process(i === 0 ? 1 : 0);
      energy += y * y;
    }
    this.reset();
    return Math.sqrt(energy);
  }
}

/**
 * Band-pass chain (2nd-order Butterworth high-pass followed by 2nd-order
 * Butterworth low-pass, each applied twice for a steeper 24 dB/oct roll-off).
 * The upper corner is clamped below Nyquist.
 */
export function bandpassChain(fLow: number, fHigh: number, fs: number): FilterChain {
  const hi = Math.min(fHigh, 0.45 * fs);
  const lo = Math.min(fLow, hi * 0.5);
  return new FilterChain([
    Biquad.highpass(lo, fs),
    Biquad.highpass(lo, fs),
    Biquad.lowpass(hi, fs),
    Biquad.lowpass(hi, fs),
  ]);
}
