import React, { useEffect, useRef } from 'react'
import './ECGGrid.css'

interface ECGGridProps {
  width: number
  height: number
  pixelsPerMm: number
}

const ECGGrid: React.FC<ECGGridProps> = ({ width, height, pixelsPerMm }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Handle high-DPI displays
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    // Clear canvas with ECG paper background
    const bgColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--ecg-background') || '#fffafa'
    ctx.fillStyle = bgColor.trim()
    ctx.fillRect(0, 0, width, height)

    // ECG paper standard: 1mm and 5mm grid
    const smallSquare = pixelsPerMm // 1mm
    const largeSquare = pixelsPerMm * 5 // 5mm

    // Draw small grid (1mm squares) - light but visible
    const gridColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--ecg-grid-color') || '#fde8e8'
    ctx.strokeStyle = gridColor.trim()
    ctx.lineWidth = 0.5  // Thin lines for 1mm grid
    ctx.globalAlpha = 0.8  // More visible

    // Vertical lines (1mm)
    for (let x = 0; x <= width; x += smallSquare) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }

    // Horizontal lines (1mm)
    for (let y = 0; y <= height; y += smallSquare) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    // Draw large grid (5mm squares) - bold and clearly visible
    ctx.globalAlpha = 1.0  // Full opacity
    const boldGridColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--ecg-grid-bold-color') || '#fac5c5'
    ctx.strokeStyle = boldGridColor.trim()
    ctx.lineWidth = 1.0  // Thicker lines for 5mm grid

    // Vertical lines (5mm)
    for (let x = 0; x <= width; x += largeSquare) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }

    // Horizontal lines (5mm)
    for (let y = 0; y <= height; y += largeSquare) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }
  }, [width, height, pixelsPerMm])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: `${width}px`, height: `${height}px` }}
      className="ecg-grid-canvas"
    />
  )
}

export default ECGGrid
