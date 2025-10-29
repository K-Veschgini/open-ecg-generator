import React, { useEffect, useRef } from 'react'
import './ECGTrace.css'

interface ECGTraceProps {
  data: number[]
  width: number
  height: number
  pixelsPerMm: number
  mmPerSecond: number
  mmPerMv: number
  samplingRate: number
  duration?: number
}

const ECGTrace: React.FC<ECGTraceProps> = ({
  data,
  width,
  height,
  pixelsPerMm,
  mmPerSecond,
  mmPerMv,
  samplingRate,
  duration
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !data || data.length === 0) {
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear canvas
    ctx.clearRect(0, 0, width, height)
    

    // Calculate scaling factors
    const pixelsPerSecond = mmPerSecond * pixelsPerMm
    const pixelsPerMv = mmPerMv * pixelsPerMm
    const samplesPerPixel = samplingRate / pixelsPerSecond
    
    // Calculate baseline (mean of signal) to center the trace properly
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length
    const centeredData = data.map(val => val - mean)
    
    // Determine how many samples we'll actually display
    const maxSamples = duration 
      ? Math.min(centeredData.length, duration * samplingRate)
      : centeredData.length
    
    // Get only the data that will be displayed
    const displayData = centeredData.slice(0, maxSamples)
    
    // Calculate peak-to-peak amplitude for DISPLAYED portion only
    const minVoltage = Math.min(...displayData)
    const maxVoltage = Math.max(...displayData)
    
    // Calculate actual required space for top and bottom peaks from centerline
    const topPeak = Math.abs(maxVoltage) * pixelsPerMv
    const bottomPeak = Math.abs(minVoltage) * pixelsPerMv
    const maxPeak = Math.max(topPeak, bottomPeak)
    
    // Center line (0 mV baseline)
    const centerY = height / 2
    
    // Available space from center to edge (with 15% margin for safety)
    const availableFromCenter = (height / 2) * 0.85
    
    // Auto-scale only if peaks would exceed available space
    const effectivePixelsPerMv = maxPeak > availableFromCenter
      ? pixelsPerMv * (availableFromCenter / maxPeak)
      : pixelsPerMv

    // Set up drawing style for clean ECG trace
    ctx.strokeStyle = '#000000' // Black for clear visibility
    ctx.lineWidth = 1.2 // Slightly thicker for better visibility while still professional
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    
    const maxPixels = Math.min(width, maxSamples / samplesPerPixel)

    // Begin drawing path
    ctx.beginPath()
    
    let prevX = 0
    let prevY = centerY

    
    // Draw ECG trace
    for (let pixel = 0; pixel < maxPixels; pixel++) {
      const sampleIndex = Math.floor(pixel * samplesPerPixel)
      if (sampleIndex >= maxSamples) break

      const x = pixel
      const voltage = centeredData[sampleIndex] || 0
      const y = centerY - (voltage * effectivePixelsPerMv)

      if (pixel === 0) {
        ctx.moveTo(x, y)
      } else {
        // Simple line for cleaner appearance
        ctx.lineTo(x, y)
      }

      prevX = x
      prevY = y
    }

    // Complete the path to the last point
    if (prevX < maxPixels - 1) {
      ctx.lineTo(prevX, prevY)
    }

    ctx.stroke()
  }, [data, width, height, pixelsPerMm, mmPerSecond, mmPerMv, samplingRate, duration])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="ecg-trace-canvas"
    />
  )
}

export default ECGTrace
