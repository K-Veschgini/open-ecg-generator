/**
 * Adaptive explicit Runge-Kutta ODE solver: Dormand-Prince 5(4) ("RK45", the
 * method behind MATLAB's ode45 / SciPy's RK45).
 *
 * - Step size is controlled by the embedded 4th-order error estimate using a
 *   mixed absolute/relative RMS error norm, so `tolerance` genuinely controls
 *   accuracy (the step is NOT tied to the output sample interval).
 * - Output on a requested time grid uses the method's 4th-order continuous
 *   extension (dense output) inside each accepted step, so output accuracy
 *   matches the integration accuracy, in linear time.
 * - The solver always terminates: it throws a descriptive Error on non-finite
 *   state/derivative values, on step-size underflow and when `maxSteps` is
 *   exceeded.
 */

export type ODEFunction<P = unknown> = (
  t: number,
  y: number[],
  params: P
) => number[];

export interface ODESolverOptions<P = unknown> {
  initialConditions: number[];
  timeSpan: [number, number];
  /**
   * Number of uniformly spaced output points including both ends of `timeSpan`
   * (`timePoints = 1` returns only the initial point). Ignored if `tEval` is given.
   * If neither is given, the accepted integration steps are returned.
   */
  timePoints?: number;
  /** Explicit, ascending output times within `timeSpan`. */
  tEval?: ArrayLike<number>;
  params?: P;
  /** Error tolerance used as both absolute and relative tolerance (default 1e-6). */
  tolerance?: number;
  /** Overrides the absolute tolerance (default: `tolerance`). */
  absTolerance?: number;
  /** Overrides the relative tolerance (default: `tolerance`). */
  relTolerance?: number;
  /** Smallest allowed step; a smaller required step throws (default: 1e-12 * max(1, |t|) ). */
  minStepSize?: number;
  /** Largest allowed step (default: the whole span). */
  maxStepSize?: number;
  /** Initial step guess (default: estimated automatically). */
  initialStepSize?: number;
  /** Maximum number of attempted steps before giving up (default 1e7). */
  maxSteps?: number;
}

export interface ODESolution {
  t: number[];
  y: number[][];
}

// Dormand-Prince 5(4) tableau
const C2 = 1 / 5, C3 = 3 / 10, C4 = 4 / 5, C5 = 8 / 9;
const A21 = 1 / 5;
const A31 = 3 / 40, A32 = 9 / 40;
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
// 5th-order weights (also row 7 of the tableau, FSAL)
const B1 = 35 / 384, B3 = 500 / 1113, B4 = 125 / 192, B5 = -2187 / 6784, B6 = 11 / 84;
// Error coefficients: b(5th) - b(4th)
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920, E5 = -17253 / 339200, E6 = 22 / 525, E7 = -1 / 40;
// Continuous extension (4th order dense output, Shampine 1986 / Hairer DOPRI5):
// y(t + s h) = y + h * sum_i k_i * (P_i1 s + P_i2 s^2 + P_i3 s^3 + P_i4 s^4)
const DENSE: readonly (readonly [number, number, number, number])[] = [
  [1, -8048581381 / 2820520608, 8663915743 / 2820520608, -12715105075 / 11282082432],
  [0, 0, 0, 0],
  [0, 131558114200 / 32700410799, -68118460800 / 10900136933, 87487479700 / 32700410799],
  [0, -1754552775 / 470086768, 14199869525 / 1410260304, -10690763975 / 1880347072],
  [0, 127303824393 / 49829197408, -318862633887 / 49829197408, 701980252875 / 199316789632],
  [0, -282668133 / 205662961, 2019193451 / 616988883, -1453857185 / 822651844],
  [0, 40617522 / 29380423, -110615467 / 29380423, 69997945 / 29380423],
];

function assertFinite(values: number[], what: string, t: number): void {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      throw new Error(`ODE solver: non-finite ${what} (component ${i} = ${values[i]}) at t = ${t}`);
    }
  }
}

/**
 * Solve y' = f(t, y, params) on `timeSpan` with adaptive Dormand-Prince 5(4).
 */
export function solveODE<P = unknown>(
  func: ODEFunction<P>,
  options: ODESolverOptions<P>
): ODESolution {
  const { initialConditions, timeSpan, timePoints, tEval } = options;
  const params = options.params as P;
  const tolerance = options.tolerance ?? 1e-6;
  const atol = options.absTolerance ?? tolerance;
  const rtol = options.relTolerance ?? tolerance;
  const maxSteps = options.maxSteps ?? 1e7;

  if (!Array.isArray(initialConditions) || initialConditions.length === 0) {
    throw new Error('ODE solver: initialConditions must be a non-empty array');
  }
  assertFinite(initialConditions, 'initial condition', timeSpan[0]);
  const [t0, tf] = timeSpan;
  if (!Number.isFinite(t0) || !Number.isFinite(tf) || tf < t0) {
    throw new Error(`ODE solver: invalid timeSpan [${t0}, ${tf}] (need finite t0 <= tf)`);
  }
  if (!(atol > 0) || !(rtol >= 0) || !Number.isFinite(atol) || !Number.isFinite(rtol)) {
    throw new Error(`ODE solver: tolerance must be a finite positive number (got atol=${atol}, rtol=${rtol})`);
  }

  // Output grid
  let grid: number[] | undefined;
  if (tEval !== undefined) {
    grid = Array.from(tEval);
    const eps = 1e-12 * Math.max(1, Math.abs(tf));
    for (let i = 0; i < grid.length; i++) {
      if (!Number.isFinite(grid[i]) || grid[i] < t0 - eps || grid[i] > tf + eps || (i > 0 && grid[i] < grid[i - 1])) {
        throw new Error('ODE solver: tEval must be finite, ascending and inside timeSpan');
      }
    }
  } else if (timePoints !== undefined) {
    if (!Number.isInteger(timePoints) || timePoints < 1) {
      throw new Error(`ODE solver: timePoints must be a positive integer (got ${timePoints})`);
    }
    grid = new Array(timePoints);
    if (timePoints === 1) {
      grid[0] = t0;
    } else {
      for (let i = 0; i < timePoints; i++) grid[i] = t0 + (i * (tf - t0)) / (timePoints - 1);
      grid[timePoints - 1] = tf;
    }
  }

  const n = initialConditions.length;
  const span = tf - t0;
  const maxStep = Math.min(options.maxStepSize ?? Infinity, span > 0 ? span : Infinity);
  if (!(maxStep > 0)) {
    throw new Error(`ODE solver: maxStepSize must be positive (got ${options.maxStepSize})`);
  }

  const tOut: number[] = [];
  const yOut: number[][] = [];
  let gi = 0; // next grid index

  let t = t0;
  let y = initialConditions.slice();
  let f = func(t, y, params);
  if (!Array.isArray(f) || f.length !== n) {
    throw new Error(`ODE solver: derivative function must return an array of length ${n}`);
  }
  assertFinite(f, 'derivative', t);

  const emit = (tt: number, yy: number[]) => {
    tOut.push(tt);
    yOut.push(yy.slice());
  };

  // grid points at t0
  if (grid) {
    while (gi < grid.length && grid[gi] <= t0) {
      emit(grid[gi], y);
      gi++;
    }
    if (gi >= grid.length || span === 0) {
      while (gi < grid.length) { emit(grid[gi], y); gi++; }
      return { t: tOut, y: yOut };
    }
  } else {
    emit(t, y);
    if (span === 0) return { t: tOut, y: yOut };
  }

  // Initial step estimate (Hairer, Norsett & Wanner, II.4)
  let h: number;
  if (options.initialStepSize !== undefined) {
    h = options.initialStepSize;
  } else {
    let d0 = 0, d1 = 0;
    for (let i = 0; i < n; i++) {
      const sc = atol + rtol * Math.abs(y[i]);
      d0 += (y[i] / sc) ** 2;
      d1 += (f[i] / sc) ** 2;
    }
    d0 = Math.sqrt(d0 / n);
    d1 = Math.sqrt(d1 / n);
    h = d0 < 1e-5 || d1 < 1e-5 ? 1e-6 : 0.01 * d0 / d1;
    h = Math.min(h, maxStep);
    const y1 = new Array(n);
    for (let i = 0; i < n; i++) y1[i] = y[i] + h * f[i];
    const f1 = func(t + h, y1, params);
    assertFinite(f1, 'derivative', t + h);
    let d2 = 0;
    for (let i = 0; i < n; i++) {
      const sc = atol + rtol * Math.abs(y[i]);
      d2 += ((f1[i] - f[i]) / sc) ** 2;
    }
    d2 = Math.sqrt(d2 / n) / h;
    const h1 = Math.max(d1, d2) <= 1e-15 ? Math.max(1e-6, h * 1e-3) : Math.pow(0.01 / Math.max(d1, d2), 1 / 5);
    h = Math.min(100 * h, h1, maxStep);
  }
  if (!(h > 0) || !Number.isFinite(h)) h = Math.min(maxStep, span);

  const yTmp = new Array<number>(n);
  const yNew = new Array<number>(n);
  let steps = 0;

  while (t < tf) {
    if (++steps > maxSteps) {
      throw new Error(`ODE solver: exceeded maxSteps (${maxSteps}) at t = ${t}`);
    }
    const minStep = options.minStepSize ?? 1e-12 * Math.max(1, Math.abs(t));
    let last = false;
    if (t + h >= tf) {
      h = tf - t;
      last = true;
    }

    const k1 = f;
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * A21 * k1[i];
    const k2 = func(t + C2 * h, yTmp, params);
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i]);
    const k3 = func(t + C3 * h, yTmp, params);
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
    const k4 = func(t + C4 * h, yTmp, params);
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
    const k5 = func(t + C5 * h, yTmp, params);
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
    const k6 = func(t + h, yTmp, params);
    for (let i = 0; i < n; i++) yNew[i] = y[i] + h * (B1 * k1[i] + B3 * k3[i] + B4 * k4[i] + B5 * k5[i] + B6 * k6[i]);
    const tNew = last ? tf : t + h;
    const k7 = func(tNew, yNew, params);

    // RMS error norm, scaled by mixed tolerance
    let err = 0;
    for (let i = 0; i < n; i++) {
      const e = h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]);
      const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yNew[i]));
      err += (e / sc) * (e / sc);
    }
    err = Math.sqrt(err / n);

    if (!Number.isFinite(err)) {
      // Non-finite values somewhere in the stages: report which.
      assertFinite(k2, 'derivative', t);
      assertFinite(k3, 'derivative', t);
      assertFinite(k4, 'derivative', t);
      assertFinite(k5, 'derivative', t);
      assertFinite(k6, 'derivative', t);
      assertFinite(yNew, 'state', tNew);
      assertFinite(k7, 'derivative', tNew);
      throw new Error(`ODE solver: non-finite error estimate at t = ${t}`);
    }

    if (err <= 1) {
      // Accept. Dense output on [t, tNew] with the 4th-order continuous extension.
      if (grid) {
        const ks = [k1, k2, k3, k4, k5, k6, k7];
        const c = new Array<number>(7);
        while (gi < grid.length && grid[gi] <= tNew) {
          const tg = grid[gi];
          const sv = tg === tNew ? 1 : (tg - t) / h;
          const s2 = sv * sv, s3 = s2 * sv, s4 = s3 * sv;
          for (let r = 0; r < 7; r++) {
            const P = DENSE[r];
            c[r] = P[0] * sv + P[1] * s2 + P[2] * s3 + P[3] * s4;
          }
          const yi = new Array<number>(n);
          for (let i = 0; i < n; i++) {
            let acc = 0;
            for (let r = 0; r < 7; r++) acc += c[r] * ks[r][i];
            yi[i] = sv === 1 ? yNew[i] : y[i] + h * acc;
          }
          tOut.push(tg);
          yOut.push(yi);
          gi++;
        }
      } else {
        emit(tNew, yNew);
      }
      t = tNew;
      for (let i = 0; i < n; i++) y[i] = yNew[i];
      f = k7;
      const factor = err === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(err, -0.2)));
      h = Math.min(maxStep, h * factor);
    } else {
      const factor = Math.max(0.1, 0.9 * Math.pow(err, -0.25));
      h *= factor;
      if (h < minStep) {
        throw new Error(`ODE solver: step size underflow (h = ${h}) at t = ${t}; the problem may be too stiff or the tolerance too strict`);
      }
    }
  }

  if (grid) {
    while (gi < grid.length) { emit(grid[gi], y); gi++; }
  }
  return { t: tOut, y: yOut };
}

/**
 * Linear interpolation of (xOriginal, yOriginal) at xNew. `xOriginal` must be
 * ascending. Values outside the original range are clamped to the end values.
 * Runs in O(n + m) for ascending `xNew` (O(m log n) otherwise).
 */
export function interpolate(
  xOriginal: number[],
  yOriginal: number[],
  xNew: number[]
): number[] {
  const n = xOriginal.length;
  if (n !== yOriginal.length) {
    throw new Error('interpolate: xOriginal and yOriginal must have the same length');
  }
  if (n === 0) {
    throw new Error('interpolate: cannot interpolate from empty data');
  }
  const out = new Array<number>(xNew.length);
  let i = 0;
  let prevX = -Infinity;
  for (let k = 0; k < xNew.length; k++) {
    const x = xNew[k];
    if (x < prevX) {
      // not ascending: fall back to binary search for this point
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xOriginal[mid] <= x) lo = mid; else hi = mid;
      }
      i = lo;
    }
    prevX = x;
    if (x <= xOriginal[0]) { out[k] = yOriginal[0]; continue; }
    if (x >= xOriginal[n - 1]) { out[k] = yOriginal[n - 1]; continue; }
    while (i < n - 2 && xOriginal[i + 1] <= x) i++;
    const x0 = xOriginal[i], x1 = xOriginal[i + 1];
    out[k] = x1 === x0 ? yOriginal[i] : yOriginal[i] + ((x - x0) / (x1 - x0)) * (yOriginal[i + 1] - yOriginal[i]);
  }
  return out;
}
