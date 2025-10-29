import React, { useRef } from 'react'
import { useContainerSize } from '../../hooks/useContainerSize'
import ECGGrid from '../ECGGrid/ECGGrid'
import ECGTrace from '../ECGTrace/ECGTrace'
import CalibrationPulse from './CalibrationPulse'

interface ECGLeadBoxProps {
  lead: string
  data: number[]
  pixelsPerMm: number
  mmPerSecond: number
  mmPerMv: number
  samplingRate: number
  duration?: number
  showCalibration?: boolean
}

const ECGLeadBox: React.FC<ECGLeadBoxProps> = ({
  lead,
  data,
  pixelsPerMm,
  mmPerSecond,
  mmPerMv,
  samplingRate,
  duration,
  showCalibration = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const { width, height } = useContainerSize(containerRef)

  return (
    <div className="ecg-lead-box">
      <div className="ecg-lead-label">{lead}</div>
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
            {showCalibration && (
              <CalibrationPulse
                width={width}
                height={height}
                pixelsPerMm={pixelsPerMm}
                mmPerMv={mmPerMv}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default ECGLeadBox
