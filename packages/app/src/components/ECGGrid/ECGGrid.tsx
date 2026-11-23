import React, { useEffect, useRef } from 'react'
import { Paper, boxStyle, cssPxToMm, setupCanvas } from '../../paper'
import './ECGGrid.css'

interface ECGGridProps {
  widthMm: number
  heightMm: number
  paper: Paper
  className?: string
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** ECG paper: 1 mm minor and 5 mm major grid, drawn in mm coordinates. */
const ECGGrid: React.FC<ECGGridProps> = ({ widthMm, heightMm, paper, className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = setupCanvas(canvas, paper, widthMm, heightMm)
    if (!ctx) return

    ctx.fillStyle = cssVar('--ecg-background', '#ffffff')
    ctx.fillRect(0, 0, widthMm, heightMm)

    const drawLines = (stepMm: number, skipEvery: number) => {
      ctx.beginPath()
      for (let i = 0; i * stepMm <= widthMm + 1e-9; i++) {
        if (skipEvery > 0 && i % skipEvery === 0) continue
        const x = i * stepMm
        ctx.moveTo(x, 0)
        ctx.lineTo(x, heightMm)
      }
      for (let i = 0; i * stepMm <= heightMm + 1e-9; i++) {
        if (skipEvery > 0 && i % skipEvery === 0) continue
        const y = i * stepMm
        ctx.moveTo(0, y)
        ctx.lineTo(widthMm, y)
      }
      ctx.stroke()
    }

    // 1 mm minor grid (skip the lines that coincide with the 5 mm grid)
    ctx.strokeStyle = cssVar('--ecg-grid-color', '#ffc9c9')
    ctx.globalAlpha = 0.8
    ctx.lineWidth = cssPxToMm(paper, 0.5)
    drawLines(1, 5)

    // 5 mm major grid
    ctx.globalAlpha = 1
    ctx.strokeStyle = cssVar('--ecg-grid-bold-color', '#ff9999')
    ctx.lineWidth = cssPxToMm(paper, 1)
    drawLines(5, 0)
  }, [widthMm, heightMm, paper])

  return (
    <canvas
      ref={canvasRef}
      style={boxStyle(paper, widthMm, heightMm)}
      className={`ecg-grid-canvas ${className ?? ''}`}
    />
  )
}

export default ECGGrid
