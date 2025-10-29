import React, { useRef } from 'react'
import { useContainerSize } from '../../hooks/useContainerSize'
import ECGGrid from '../ECGGrid/ECGGrid'
import ECGTrace from '../ECGTrace/ECGTrace'

interface RhythmStripProps {
  lead: string
  data: number[]
  pixelsPerMm: number
  mmPerSecond: number
  mmPerMv: number
  samplingRate: number
  duration?: number
  heartRate?: number
  showTechnicalInfo?: boolean
}

const RhythmStrip: React.FC<RhythmStripProps> = ({
  lead,
  data,
  pixelsPerMm,
  mmPerSecond,
  mmPerMv,
  samplingRate,
  duration,
  heartRate,
  showTechnicalInfo = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const { width, height } = useContainerSize(containerRef)

  return (
    <div className="ecg-rhythm-strip">
      <div className="ecg-lead-label">
        Lead {lead}
        {showTechnicalInfo && heartRate && (
          <span className="ecg-tech-info"> | {mmPerSecond} mm/s | {mmPerMv} mm/mV | 0.05-150 Hz | {heartRate} bpm</span>
        )}
      </div>
      <div className="ecg-canvas-container" ref={containerRef}>
        {width > 0 && height > 0 && (
          <>
            <ECGGrid
              width={width}
              height={height}
              pixelsPerMm={pixelsPerMm}
            />
            <ECGTrace
              data={data}
              width={width}
              height={height}
              pixelsPerMm={pixelsPerMm}
              mmPerSecond={mmPerSecond}
              mmPerMv={mmPerMv}
              samplingRate={samplingRate}
              duration={duration}
            />
          </>
        )}
      </div>
    </div>
  )
}

export default RhythmStrip
