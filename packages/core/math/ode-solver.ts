/**
 * Adaptive Runge-Kutta-Fehlberg (RK45) ODE solver
 * Uses Dormand-Prince coefficients for high accuracy
 */

export type ODEFunction = (
  t: number,
  y: number[],
  params: any
) => number[];

export interface ODESolverOptions {
  initialConditions: number[];
  timeSpan: [number, number];
  timePoints?: number;
  params?: any;
  tolerance?: number;  // Error tolerance for adaptive stepping (default: 1e-6)
  minStepSize?: number;  // Minimum step size (default: 1e-8)
  maxStepSize?: number;  // Maximum step size (default: auto)
}

/**
 * Dormand-Prince RK45 coefficients
 */
const DP_A = [0, 1/5, 3/10, 4/5, 8/9, 1, 1];
const DP_B = [
  [],
  [1/5],
  [3/40, 9/40],
  [44/45, -56/15, 32/9],
  [19372/6561, -25360/2187, 64448/6561, -212/729],
  [9017/3168, -355/33, 46732/5247, 49/176, -5103/18656],
  [35/384, 0, 500/1113, 125/192, -2187/6784, 11/84]
];
const DP_C5 = [35/384, 0, 500/1113, 125/192, -2187/6784, 11/84, 0]; // 5th order
const DP_C4 = [5179/57600, 0, 7571/16695, 393/640, -92097/339200, 187/2100, 1/40]; // 4th order for error

/**
 * Solves a system of ordinary differential equations using adaptive RK45 method
 */
export function solveODE(
  func: ODEFunction,
  options: ODESolverOptions
): { t: number[]; y: number[][] } {
  const { 
    initialConditions, 
    timeSpan, 
    timePoints,
    params = {},
    tolerance = 1e-6,
    minStepSize = 1e-8,
    maxStepSize
  } = options;
  
  const [t0, tf] = timeSpan;
  const duration = tf - t0;
  
  // If timePoints specified, use it to determine target spacing
  const targetSpacing = timePoints ? duration / (timePoints - 1) : undefined;
  const defaultMaxStep = targetSpacing ? targetSpacing / 2 : 0.01;
  const maxStep = maxStepSize || defaultMaxStep;
  
  const tResult: number[] = [];
  const yResult: number[][] = [];
  
  let currentT = t0;
  let currentY = [...initialConditions];
  let stepSize = maxStep;
  
  // Store initial condition
  tResult.push(currentT);
  yResult.push([...currentY]);
  
  // Adaptive stepping
  while (currentT < tf) {
    // Don't overshoot final time
    if (currentT + stepSize > tf) {
      stepSize = tf - currentT;
    }
    
    // Compute RK45 step
    const [yNext5, yNext4, error] = rk45Step(func, currentT, currentY, stepSize, params);
    
    // Calculate error magnitude
    const errorNorm = Math.sqrt(error.reduce((sum, e) => sum + e * e, 0)) / error.length;
    
    if (errorNorm < tolerance || stepSize <= minStepSize) {
      // Accept step
      currentT += stepSize;
      currentY = yNext5;
      
      tResult.push(currentT);
      yResult.push([...currentY]);
      
      // Increase step size for next iteration (but not too aggressively)
      if (errorNorm > 0) {
        const factor = Math.min(2.0, 0.9 * Math.pow(tolerance / errorNorm, 0.2));
        stepSize = Math.min(maxStep, stepSize * factor);
      }
    } else {
      // Reject step and reduce step size
      const factor = Math.max(0.1, 0.9 * Math.pow(tolerance / errorNorm, 0.25));
      stepSize = Math.max(minStepSize, stepSize * factor);
    }
  }
  
  // If timePoints specified, interpolate to get exact number of points
  if (timePoints && tResult.length !== timePoints) {
    const tInterp: number[] = [];
    for (let i = 0; i < timePoints; i++) {
      tInterp.push(t0 + (i * duration) / (timePoints - 1));
    }
    
    const yInterp = interpolateMulti(tResult, yResult, tInterp);
    return { t: tInterp, y: yInterp };
  }
  
  return { t: tResult, y: yResult };
}

/**
 * Single RK45 step using Dormand-Prince coefficients
 * Returns [y5, y4, error] where y5 is 5th order, y4 is 4th order
 */
function rk45Step(
  func: ODEFunction,
  t: number,
  y: number[],
  h: number,
  params: any
): [number[], number[], number[]] {
  const n = y.length;
  
  // Compute k values
  const k: number[][] = new Array(7);
  
  // k1
  k[0] = func(t, y, params);
  
  // k2 through k7
  for (let i = 1; i < 7; i++) {
    const tNew = t + DP_A[i] * h;
    const yNew = new Array(n);
    
    for (let j = 0; j < n; j++) {
      yNew[j] = y[j];
      for (let m = 0; m < i; m++) {
        yNew[j] += h * DP_B[i][m] * k[m][j];
      }
    }
    
    k[i] = func(tNew, yNew, params);
  }
  
  // Compute 5th order solution
  const y5 = new Array(n);
  for (let j = 0; j < n; j++) {
    y5[j] = y[j];
    for (let i = 0; i < 7; i++) {
      y5[j] += h * DP_C5[i] * k[i][j];
    }
  }
  
  // Compute 4th order solution
  const y4 = new Array(n);
  for (let j = 0; j < n; j++) {
    y4[j] = y[j];
    for (let i = 0; i < 7; i++) {
      y4[j] += h * DP_C4[i] * k[i][j];
    }
  }
  
  // Error estimate
  const error = new Array(n);
  for (let j = 0; j < n; j++) {
    error[j] = Math.abs(y5[j] - y4[j]);
  }
  
  return [y5, y4, error];
}

/**
 * Multi-dimensional linear interpolation for resampling state vectors
 */
function interpolateMulti(
  tOriginal: number[],
  yOriginal: number[][],
  tNew: number[]
): number[][] {
  const yNew: number[][] = [];
  
  for (const t of tNew) {
    // Find surrounding points
    let i = 0;
    while (i < tOriginal.length - 1 && tOriginal[i + 1] < t) {
      i++;
    }
    
    if (i === tOriginal.length - 1) {
      yNew.push([...yOriginal[i]]);
    } else if (tOriginal[i] === t) {
      yNew.push([...yOriginal[i]]);
    } else {
      // Linear interpolation for each component
      const t0 = tOriginal[i];
      const t1 = tOriginal[i + 1];
      const alpha = (t - t0) / (t1 - t0);
      const y0 = yOriginal[i];
      const y1 = yOriginal[i + 1];
      
      const yInterp = y0.map((val, j) => val + alpha * (y1[j] - val));
      yNew.push(yInterp);
    }
  }
  
  return yNew;
}

/**
 * Simple linear interpolation for resampling
 */
export function interpolate(
  xOriginal: number[],
  yOriginal: number[],
  xNew: number[]
): number[] {
  const yNew: number[] = [];
  
  for (const x of xNew) {
    // Find surrounding points
    let i = 0;
    while (i < xOriginal.length - 1 && xOriginal[i + 1] < x) {
      i++;
    }
    
    if (i === xOriginal.length - 1) {
      yNew.push(yOriginal[i]);
    } else if (xOriginal[i] === x) {
      yNew.push(yOriginal[i]);
    } else {
      // Linear interpolation
      const x0 = xOriginal[i];
      const x1 = xOriginal[i + 1];
      const y0 = yOriginal[i];
      const y1 = yOriginal[i + 1];
      const y = y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
      yNew.push(y);
    }
  }
  
  return yNew;
}
