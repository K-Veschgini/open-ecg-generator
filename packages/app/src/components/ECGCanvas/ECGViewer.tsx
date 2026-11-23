import React, { useMemo, useRef } from 'react'
import type { LeadName } from '@open-ecg-generator/core'
import ECGRow, { RowSegment, rowWidthMm } from './ECGRow'
import { useContainerSize } from '../../hooks/useContainerSize'
import { useDevicePixelRatio } from '../../hooks/useDevicePixelRatio'
import type { ECGData, ECGSettings } from '../../types'
import type { Paper } from '../../paper'
import './ECGViewer.css'

interface ECGViewerProps {
  data: ECGData | null
  settings: ECGSettings
  isLoading: boolean
  error: string | null
}

/** Standard 3 x 4 layout: each row shows 4 leads, column k covers k*2.5 .. (k+1)*2.5 s. */
export const TWELVE_LEAD_ROWS: LeadName[][] = [
  ['I', 'aVR', 'V1', 'V4'],
  ['II', 'aVL', 'V2', 'V5'],
  ['III', 'aVF', 'V3', 'V6']
]
export const SEGMENT_SECONDS = 2.5
export const RHYTHM_LEAD: LeadName = 'II'
const RHYTHM_VIEW_LEADS: LeadName[] = ['II', 'V1', 'V5']

/** Paper width of one row in the rhythm / single-lead views (10 s at 25 mm/s). */
const ROW_PAPER_MM = 250

const ROW_HEIGHT_12: Record<ECGSettings['gain'], number> = { 5: 20, 10: 30, 20: 50 }
const ROW_HEIGHT_SINGLE: Record<ECGSettings['gain'], number> = { 5: 30, 10: 40, 20: 65 }

export function twelveLeadSegments(data: ECGData, row: LeadName[]): RowSegment[] {
  return row.map((lead, col) => ({
    label: lead,
    data: data.leads[lead]?.signal ?? [],
    startTime: col * SEGMENT_SECONDS,
    duration: SEGMENT_SECONDS
  }))
}

export function techInfo(data: ECGData, settings: ECGSettings): string {
  return `${settings.paperSpeed} mm/s | ${settings.gain} mm/mV | ${Math.round(data.heartRate)} bpm | ${data.samplingRate} Hz`
}

function fmtSeconds(s: number): string {
  return Number.isInteger(s) ? `${s}` : s.toFixed(1)
}

const ECGViewer: React.FC<ECGViewerProps> = ({ data, settings, isLoading, error }) => {
  const bodyRef = useRef<HTMLDivElement>(null)
  const { width } = useContainerSize(bodyRef)
  const dpr = useDevicePixelRatio()
  const mmPerSecond = settings.paperSpeed
  const mmPerMv = settings.gain

  // Scale so a 10 s row at 25 mm/s fills the available width; 1 mm = pixelsPerMm everywhere.
  // At 50 mm/s the 12-lead page is twice as wide and scrolls horizontally.
  const pixelsPerMm = useMemo(() => {
    if (width <= 0) return 4
    const fit = width / rowWidthMm([10], 25)
    return Math.min(6, Math.max(2, Math.floor(fit * 4) / 4))
  }, [width])
  // dpr is part of Paper so every canvas re-renders its backing store when it changes.
  const paper: Paper = useMemo(() => ({ cssPxPerMm: pixelsPerMm, dpr }), [pixelsPerMm, dpr])

  let content: React.ReactNode
  if (error) {
    content = <div className="ecg-viewer-message error">Could not generate ECG: {error}</div>
  } else if (!data) {
    content = <div className="ecg-viewer-message">{isLoading ? 'Generating ECG...' : 'No ECG data available.'}</div>
  } else if (settings.leadSet === '12-lead') {
    const h = ROW_HEIGHT_12[settings.gain]
    content = (
      <div className="ecg-12-lead-container">
        {TWELVE_LEAD_ROWS.map((row, r) => (
          <ECGRow
            key={r}
            segments={twelveLeadSegments(data, row)}
            samplingRate={data.samplingRate}
            mmPerSecond={mmPerSecond}
            mmPerMv={mmPerMv}
            heightMm={h}
            paper={paper}
          />
        ))}
        <ECGRow
          className="ecg-rhythm-row"
          segments={[{ label: `Lead ${RHYTHM_LEAD}`, data: data.leads[RHYTHM_LEAD]?.signal ?? [], startTime: 0, duration: 10 }]}
          samplingRate={data.samplingRate}
          mmPerSecond={mmPerSecond}
          mmPerMv={mmPerMv}
          heightMm={h}
          paper={paper}
          info={techInfo(data, settings)}
        />
      </div>
    )
  } else {
    // Rhythm (3-channel II/V1/V5) or single lead: wrap the whole duration into rows.
    const secondsPerRow = ROW_PAPER_MM / mmPerSecond
    const total = data.duration
    const windows: { start: number; dur: number }[] = []
    for (let start = 0; start < total - 1e-9; start += secondsPerRow) {
      windows.push({ start, dur: Math.min(secondsPerRow, total - start) })
    }
    const leads = settings.leadSet === 'rhythm' ? RHYTHM_VIEW_LEADS : [settings.selectedLead]
    const h = settings.leadSet === 'rhythm' ? ROW_HEIGHT_12[settings.gain] : ROW_HEIGHT_SINGLE[settings.gain]
    content = (
      <div className="ecg-strip-container">
        {windows.map((w, wi) => (
          <div key={wi} className="ecg-strip-group">
            {leads.map((lead, li) => (
              <ECGRow
                key={lead}
                segments={[{
                  label: `${lead}  ${fmtSeconds(w.start)}-${fmtSeconds(w.start + w.dur)} s`,
                  data: data.leads[lead]?.signal ?? [],
                  startTime: w.start,
                  duration: w.dur
                }]}
                samplingRate={data.samplingRate}
                mmPerSecond={mmPerSecond}
                mmPerMv={mmPerMv}
                heightMm={h}
                paper={paper}
                info={wi === 0 && li === 0 ? techInfo(data, settings) : undefined}
              />
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={`ecg-viewer surface ${isLoading ? 'is-loading' : ''}`}>
      <div className="ecg-viewer-body" ref={bodyRef}>
        {content}
      </div>
      {isLoading && data && <div className="ecg-viewer-busy">Generating...</div>}
    </div>
  )
}

export default ECGViewer
