import React from 'react'
import ECGGrid from '../ECGGrid/ECGGrid'
import ECGTrace from '../ECGTrace/ECGTrace'
import CalibrationPulse from './CalibrationPulse'
import { BASELINE_FRACTION, Paper, boxStyle, calibrationMarginMm, cssLength } from '../../paper'

export interface RowSegment {
  label: string
  data: readonly number[]
  /** Seconds into the recording at the segment's left edge. */
  startTime: number
  /** Seconds shown in this segment. */
  duration: number
}

interface ECGRowProps {
  segments: RowSegment[]
  samplingRate: number
  mmPerSecond: number
  mmPerMv: number
  heightMm: number
  paper: Paper
  /** Optional technical info appended to the first label. */
  info?: string
  className?: string
}

/** Total width of a row in mm (calibration margin + segments). */
export function rowWidthMm(segmentSeconds: number[], mmPerSecond: number): number {
  return calibrationMarginMm(mmPerSecond) + segmentSeconds.reduce((a, s) => a + s * mmPerSecond, 0)
}

/**
 * One row of ECG paper: continuous grid, 1 mV calibration pulse at the start,
 * then consecutive lead segments drawn at true gain and paper speed.
 * Segment boundaries are marked with a short vertical tick, as on standard
 * 12-lead printouts.
 */
const ECGRow: React.FC<ECGRowProps> = ({
  segments,
  samplingRate,
  mmPerSecond,
  mmPerMv,
  heightMm,
  paper,
  info,
  className
}) => {
  const calMm = calibrationMarginMm(mmPerSecond)
  const widthMm = rowWidthMm(segments.map(s => s.duration), mmPerSecond)
  const baselineMm = heightMm * BASELINE_FRACTION

  let offsetMm = calMm
  const placed = segments.map(seg => {
    const left = offsetMm
    offsetMm += seg.duration * mmPerSecond
    return { seg, left }
  })

  return (
    <div className={`ecg-row ${className ?? ''}`} style={boxStyle(paper, widthMm, heightMm)}>
      <ECGGrid widthMm={widthMm} heightMm={heightMm} paper={paper} />
      <CalibrationPulse
        widthMm={calMm}
        heightMm={heightMm}
        baselineMm={baselineMm}
        mmPerSecond={mmPerSecond}
        mmPerMv={mmPerMv}
        paper={paper}
        style={{ left: 0 }}
      />
      {placed.map(({ seg, left }, i) => (
        <React.Fragment key={`${seg.label}-${i}`}>
          <ECGTrace
            data={seg.data}
            samplingRate={samplingRate}
            startTime={seg.startTime}
            duration={seg.duration}
            mmPerSecond={mmPerSecond}
            mmPerMv={mmPerMv}
            heightMm={heightMm}
            baselineMm={baselineMm}
            paper={paper}
            style={{ left: cssLength(paper, left) }}
          />
          {i > 0 && (
            <div
              className="ecg-segment-tick"
              style={{
                left: cssLength(paper, left),
                top: cssLength(paper, baselineMm - 3),
                height: cssLength(paper, 6)
              }}
            />
          )}
          <div className="ecg-lead-label" style={{ left: cssLength(paper, left + 1) }}>
            {seg.label}
            {i === 0 && info && <span className="ecg-tech-info"> | {info}</span>}
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}

export default ECGRow
