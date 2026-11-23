import React, { useEffect, useRef } from 'react'
import { Paper, boxStyle, cssPxToMm, setupCanvas } from '../../paper'
import './ECGTrace.css'

interface ECGTraceProps {
  /** Signal in mV, sample i at time i / samplingRate. */
  data: readonly number[]
  samplingRate: number
  /** Seconds of the signal shown at the left edge. */
  startTime: number
  /** Seconds shown; the box is exactly duration * mmPerSecond wide. */
  duration: number
  mmPerSecond: number
  mmPerMv: number
  heightMm: number
  /** Isoelectric (0 mV) line, mm from the top. */
  baselineMm: number
  paper: Paper
  style?: React.CSSProperties
}

/**
 * Draws an ECG segment at true calibration: x = (t - startTime) * mmPerSecond,
 * y = baseline - v * mmPerMv. Never rescales; excursions beyond the box are
 * clipped. Every sample in the window is drawn, at device-pixel resolution.
 */
const ECGTrace: React.FC<ECGTraceProps> = ({
  data,
  samplingRate,
  startTime,
  duration,
  mmPerSecond,
  mmPerMv,
  heightMm,
  baselineMm,
  paper,
  style
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const widthMm = duration * mmPerSecond

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Always clear first so stale traces never survive an empty data set.
    const ctx = setupCanvas(canvas, paper, widthMm, heightMm)
    if (!ctx || data.length === 0 || !(samplingRate > 0)) return

    const first = Math.max(0, Math.floor(startTime * samplingRate))
    const last = Math.min(data.length - 1, Math.ceil((startTime + duration) * samplingRate))
    if (last < first) return

    ctx.beginPath()
    ctx.rect(0, 0, widthMm, heightMm)
    ctx.clip()

    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ecg-trace-color').trim() || '#000000'
    ctx.lineWidth = cssPxToMm(paper, 1.2)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.beginPath()
    for (let i = first; i <= last; i++) {
      const v = data[i]
      const x = (i / samplingRate - startTime) * mmPerSecond
      const y = baselineMm - (Number.isFinite(v) ? v : 0) * mmPerMv
      if (i === first) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }, [data, samplingRate, startTime, duration, mmPerSecond, mmPerMv, widthMm, heightMm, baselineMm, paper])

  return (
    <canvas
      ref={canvasRef}
      style={{ ...boxStyle(paper, widthMm, heightMm), ...style }}
      className="ecg-trace-canvas"
    />
  )
}

export default ECGTrace
