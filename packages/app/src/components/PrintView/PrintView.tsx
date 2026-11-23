import React, { useEffect, useMemo } from 'react'
import ECGRow from '../ECGCanvas/ECGRow'
import { RHYTHM_LEAD, TWELVE_LEAD_ROWS, twelveLeadSegments } from '../ECGCanvas/ECGViewer'
import type { ECGData, ECGSettings } from '../../types'
import { pathologyLabel } from '../../types'
import type { Paper } from '../../paper'
import './PrintView.css'

interface PrintViewProps {
  ecgData: ECGData
  settings: ECGSettings
  onClose: () => void
}

/** Printed in real millimetres, backing store at 12 px/mm (~300 dpi). */
const PRINT_PAPER: Paper = { cssPxPerMm: null, printPxPerMm: 12 }
/** A 10 s 12-lead page is only defined at 25 mm/s on A4 (250 mm of trace). */
const PRINT_MM_PER_SECOND = 25
/**
 * Row height per gain. The isoelectric line sits at BASELINE_FRACTION of the
 * row, and the 1 mV calibration pulse (gain mm tall) must fit above it with
 * a margin: 0.55 * 36 = 19.8 mm is enough for 5 and 10 mm/mV, but 20 mm/mV
 * needs 40 mm rows (baseline 22 mm, pulse top 2 mm below the row edge).
 * Four 40 mm rows plus gaps, header and footer still fit the 190 mm content
 * height of the A4 landscape page (see the gaps in PrintView.css).
 */
const PRINT_ROW_HEIGHT_MM: Record<ECGSettings['gain'], number> = { 5: 36, 10: 36, 20: 40 }

const PrintView: React.FC<PrintViewProps> = ({ ecgData, settings, onClose }) => {
  const mmPerMv = settings.gain
  const rowHeightMm = PRINT_ROW_HEIGHT_MM[settings.gain] ?? 40
  const now = useMemo(() => new Date(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const speedNote =
    settings.paperSpeed !== PRINT_MM_PER_SECOND ? ` (screen: ${settings.paperSpeed} mm/s)` : ''

  return (
    <div className="print-view">
      {/* A4 landscape, no browser margins: the page itself carries a 10 mm margin */}
      <style>{'@page { size: A4 landscape; margin: 0; }'}</style>

      <div className="print-toolbar no-print">
        <button className="btn btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
        <button className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
        <span className="print-toolbar-hint">
          A4 landscape, scale 100% ("Actual size"), margins "None" - 1 mm on paper = 1 mm of ECG grid.
        </span>
      </div>

      <div className="print-page">
        <div className="print-header">
          <div className="header-info">
            <div>
              <div className="info-row">
                <span className="label">Rhythm:</span>
                <span className="value">{pathologyLabel(ecgData.pathology, settings.customBase)}</span>
              </div>
              <div className="info-row">
                <span className="label">Name / ID:</span>
                <span className="value">Simulated ECG (not a patient record)</span>
              </div>
            </div>
            <div>
              <div className="info-row">
                <span className="label">Date:</span>
                <span className="value">{now.toLocaleDateString()} {now.toLocaleTimeString()}</span>
              </div>
              <div className="info-row">
                <span className="label">HR:</span>
                <span className="value">{Math.round(ecgData.heartRate)} bpm</span>
              </div>
            </div>
            <div>
              <div className="info-row">
                <span className="label">Speed / Gain:</span>
                <span className="value">
                  {PRINT_MM_PER_SECOND} mm/s{speedNote}, {mmPerMv} mm/mV
                </span>
              </div>
              <div className="info-row">
                <span className="label">Sampling:</span>
                <span className="value">{ecgData.samplingRate} Hz, {ecgData.duration} s</span>
              </div>
            </div>
          </div>
        </div>

        <div className="print-rows">
          {TWELVE_LEAD_ROWS.map((row, r) => (
            <ECGRow
              key={r}
              className="print-row"
              segments={twelveLeadSegments(ecgData, row)}
              samplingRate={ecgData.samplingRate}
              mmPerSecond={PRINT_MM_PER_SECOND}
              mmPerMv={mmPerMv}
              heightMm={rowHeightMm}
              paper={PRINT_PAPER}
            />
          ))}
          <ECGRow
            className="print-row"
            segments={[{ label: RHYTHM_LEAD, data: ecgData.leads[RHYTHM_LEAD]?.signal ?? [], startTime: 0, duration: 10 }]}
            samplingRate={ecgData.samplingRate}
            mmPerSecond={PRINT_MM_PER_SECOND}
            mmPerMv={mmPerMv}
            heightMm={rowHeightMm}
            paper={PRINT_PAPER}
          />
        </div>

        <div className="print-footer">
          <span>Calibration pulse: 1 mV, 200 ms at the start of each row. Columns: 0-2.5 s, 2.5-5 s, 5-7.5 s, 7.5-10 s.</span>
          <span>Open ECG Generator - synthetic signal for education only</span>
        </div>
      </div>
    </div>
  )
}

export default PrintView
