import React, { useEffect, useRef } from 'react'
import { Paper, boxStyle, cssPxToMm, setupCanvas } from '../../paper'

interface CalibrationPulseProps {
  widthMm: number
  heightMm: number
  /** Isoelectric line, mm from the top (same as the traces in the row). */
  baselineMm: number
  mmPerSecond: number
  mmPerMv: number
  paper: Paper
  style?: React.CSSProperties
}

/** Standard 1 mV x 200 ms calibration pulse at the current gain and speed. */
const CalibrationPulse: React.FC<CalibrationPulseProps> = ({
  widthMm,
  heightMm,
  baselineMm,
  mmPerSecond,
  mmPerMv,
  paper,
  style
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = setupCanvas(canvas, paper, widthMm, heightMm)
    if (!ctx) return

    const x0 = 2
    const pulseWidth = 0.2 * mmPerSecond
    const top = baselineMm - mmPerMv

    ctx.strokeStyle = '#000000'
    ctx.lineWidth = cssPxToMm(paper, 1.2)
    ctx.lineCap = 'butt'
    ctx.lineJoin = 'miter'
    ctx.beginPath()
    ctx.moveTo(0, baselineMm)
    ctx.lineTo(x0, baselineMm)
    ctx.lineTo(x0, top)
    ctx.lineTo(x0 + pulseWidth, top)
    ctx.lineTo(x0 + pulseWidth, baselineMm)
    ctx.lineTo(widthMm, baselineMm)
    ctx.stroke()
  }, [widthMm, heightMm, baselineMm, mmPerSecond, mmPerMv, paper])

  return (
    <canvas
      ref={canvasRef}
      style={{ ...boxStyle(paper, widthMm, heightMm), ...style }}
      className="ecg-trace-canvas"
    />
  )
}

export default CalibrationPulse
