import React, { useEffect, useRef } from 'react'

interface CalibrationPulseProps {
  width: number
  height: number
  pixelsPerMm: number
  mmPerMv: number
}

const CalibrationPulse: React.FC<CalibrationPulseProps> = ({
  width,
  height,
  pixelsPerMm,
  mmPerMv
}) => {
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

    // Clear
    ctx.clearRect(0, 0, width, height)

    // Standard 1mV calibration pulse
    const pulseX = 2 * pixelsPerMm // 2mm from left
    const pulseHeight = mmPerMv * pixelsPerMm // 1mV at current gain
    const pulseWidth = 5 * pixelsPerMm // 5mm wide (0.2 seconds at 25mm/s)
    
    // Position baseline lower when gain is high to prevent clipping
    // Leave 10% margin at top and ensure pulse fits
    const baselineY = Math.min(height * 0.7, height - pulseHeight - height * 0.1)

    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 1.2
    ctx.lineCap = 'square'
    ctx.lineJoin = 'miter'

    ctx.beginPath()
    // Baseline before pulse
    ctx.moveTo(0, baselineY)
    ctx.lineTo(pulseX, baselineY)
    // Vertical up
    ctx.lineTo(pulseX, baselineY - pulseHeight)
    // Horizontal top
    ctx.lineTo(pulseX + pulseWidth, baselineY - pulseHeight)
    // Vertical down
    ctx.lineTo(pulseX + pulseWidth, baselineY)
    ctx.stroke()
  }, [width, height, pixelsPerMm, mmPerMv])

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 3,
        pointerEvents: 'none'
      }}
    />
  )
}

export default CalibrationPulse
