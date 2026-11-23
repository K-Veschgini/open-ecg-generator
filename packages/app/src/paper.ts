import type { CSSProperties } from 'react'

/**
 * How millimetres of ECG paper map to the output medium.
 * - Screen: `cssPxPerMm` CSS pixels per mm; the canvas backing store is
 *   rendered at device-pixel resolution.
 * - Print: `cssPxPerMm = null` sizes elements in real CSS millimetres
 *   (1 mm on paper = 1 mm) and renders the backing store at `printPxPerMm`.
 * All drawing code works in millimetre coordinates.
 */
export interface Paper {
  cssPxPerMm: number | null
  printPxPerMm?: number
  /**
   * Device pixel ratio the screen backing store is rendered for. Part of the
   * Paper value so that a DPR change (e.g. moving the window to another
   * monitor) produces a new Paper and every canvas redraws at the new
   * resolution. Falls back to window.devicePixelRatio when omitted.
   */
  dpr?: number
}

/** 1 CSS px is 1/96 inch. */
const MM_PER_CSS_PX = 25.4 / 96

export function cssLength(paper: Paper, mm: number): string {
  return paper.cssPxPerMm === null ? `${mm}mm` : `${mm * paper.cssPxPerMm}px`
}

export function boxStyle(paper: Paper, widthMm: number, heightMm: number): CSSProperties {
  return { width: cssLength(paper, widthMm), height: cssLength(paper, heightMm) }
}

/** Backing-store pixels per mm. */
export function backingPxPerMm(paper: Paper): number {
  if (paper.cssPxPerMm === null) return paper.printPxPerMm ?? 12
  const dpr = paper.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
  return paper.cssPxPerMm * dpr
}

/** A line width given in CSS pixels, expressed in mm. */
export function cssPxToMm(paper: Paper, px: number): number {
  return paper.cssPxPerMm === null ? px * MM_PER_CSS_PX : px / paper.cssPxPerMm
}

/**
 * Size a canvas for a box of widthMm x heightMm and return a context whose
 * user units are millimetres. The canvas is cleared.
 */
export function setupCanvas(
  canvas: HTMLCanvasElement,
  paper: Paper,
  widthMm: number,
  heightMm: number
): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const scale = backingPxPerMm(paper)
  const w = Math.max(1, Math.round(widthMm * scale))
  const h = Math.max(1, Math.round(heightMm * scale))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.setTransform(w / widthMm, 0, 0, h / heightMm, 0, 0)
  return ctx
}

/** Spacing of the major (5 mm) grid lines. */
export const MAJOR_GRID_MM = 5

/**
 * Width of the calibration margin at the start of each row: the 0.2 s pulse
 * plus at least 2 mm on each side, rounded up to a whole number of major
 * grid squares so that t = 0 of every trace sits on a 5 mm line
 * (10 mm at 25 mm/s, 15 mm at 50 mm/s).
 */
export function calibrationMarginMm(mmPerSecond: number): number {
  const minimum = 0.2 * mmPerSecond + 4
  return Math.ceil(minimum / MAJOR_GRID_MM - 1e-9) * MAJOR_GRID_MM
}

/** Isoelectric line position as a fraction of row height from the top. */
export const BASELINE_FRACTION = 0.55
