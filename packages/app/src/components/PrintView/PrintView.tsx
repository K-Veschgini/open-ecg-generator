import React from 'react'
import ECGGrid from '../ECGGrid/ECGGrid'
import ECGTrace from '../ECGTrace/ECGTrace'
import { ECGSettings } from '../../App'
import './PrintView.css'

interface PrintViewProps {
  ecgData: any
  settings: ECGSettings
}

const PrintView: React.FC<PrintViewProps> = ({ ecgData, settings }) => {
  // A4 print dimensions in mm
  const pageWidthMm = 210
  const pageHeightMm = 297
  const marginMm = 10
  const printableWidthMm = pageWidthMm - (2 * marginMm)
  const printableHeightMm = pageHeightMm - (2 * marginMm)
  
  // Pixels per mm for print (higher resolution for better quality)
  const pixelsPerMm = 12 // ~300 DPI
  
  // Standard 12-lead ECG layout (column-based format)
  const leads12 = [
    'I', 'aVR', 'V1', 'V4',
    'II', 'aVL', 'V2', 'V5',
    'III', 'aVF', 'V3', 'V6'
  ]
  
  // ECG parameters
  const mmPerSecond = settings.paperSpeed
  const mmPerMv = settings.gain
  
  // Calculate dimensions for 12-lead layout (4 columns x 3 rows)
  const leadBoxWidthMm = 47.5 // 4 columns across 190mm
  const leadBoxHeightMm = 35 // Standard height for 2.5 seconds
  const rhythmStripHeightMm = 35
  
  const today = new Date()
  const dateStr = today.toLocaleDateString()
  const timeStr = today.toLocaleTimeString()

  return (
    <div className="print-view">
      <div className="print-page">
        {/* Header */}
        <div className="print-header">
          <div className="header-info">
            <div className="patient-info">
              <div className="info-row">
                <span className="label">Name:</span>
                <span className="value">____________________</span>
              </div>
              <div className="info-row">
                <span className="label">ID:</span>
                <span className="value">____________________</span>
              </div>
              <div className="info-row">
                <span className="label">DOB:</span>
                <span className="value">____________________</span>
              </div>
            </div>
            <div className="recording-info">
              <div className="info-row">
                <span className="label">Date:</span>
                <span className="value">{dateStr}</span>
              </div>
              <div className="info-row">
                <span className="label">Time:</span>
                <span className="value">{timeStr}</span>
              </div>
              <div className="info-row">
                <span className="label">HR:</span>
                <span className="value">{settings.heartRate} bpm</span>
              </div>
            </div>
            <div className="technical-info">
              <div className="info-row">
                <span className="label">Speed:</span>
                <span className="value">{settings.paperSpeed} mm/s</span>
              </div>
              <div className="info-row">
                <span className="label">Gain:</span>
                <span className="value">{settings.gain} mm/mV</span>
              </div>
              <div className="info-row">
                <span className="label">Filter:</span>
                <span className="value">0.05-150 Hz</span>
              </div>
            </div>
          </div>
        </div>

        {/* 12-Lead ECG Grid */}
        <div className="print-12-lead-grid">
          {leads12.map((lead, index) => (
            <div 
              key={lead} 
              className="print-lead-box"
              style={{
                width: `${leadBoxWidthMm}mm`,
                height: `${leadBoxHeightMm}mm`
              }}
            >
              <div className="print-lead-label">{lead}</div>
              <div className="print-canvas-container">
                <ECGGrid
                  width={leadBoxWidthMm * pixelsPerMm}
                  height={leadBoxHeightMm * pixelsPerMm}
                  pixelsPerMm={pixelsPerMm}
                />
                <ECGTrace
                  data={ecgData?.leads?.[lead]?.signal || []}
                  width={leadBoxWidthMm * pixelsPerMm}
                  height={leadBoxHeightMm * pixelsPerMm}
                  pixelsPerMm={pixelsPerMm}
                  mmPerSecond={mmPerSecond}
                  mmPerMv={mmPerMv}
                  samplingRate={ecgData?.samplingRate || 500}
                  duration={2.5} // 2.5 seconds per lead box
                />
              </div>
            </div>
          ))}
        </div>

        {/* Rhythm Strip */}
        <div 
          className="print-rhythm-strip"
          style={{
            width: `${printableWidthMm}mm`,
            height: `${rhythmStripHeightMm}mm`
          }}
        >
          <div className="print-lead-label">II</div>
          <div className="print-canvas-container">
            <ECGGrid
              width={printableWidthMm * pixelsPerMm}
              height={rhythmStripHeightMm * pixelsPerMm}
              pixelsPerMm={pixelsPerMm}
            />
            <ECGTrace
              data={ecgData?.leads?.['II']?.signal || []}
              width={printableWidthMm * pixelsPerMm}
              height={rhythmStripHeightMm * pixelsPerMm}
              pixelsPerMm={pixelsPerMm}
              mmPerSecond={mmPerSecond}
              mmPerMv={mmPerMv}
              samplingRate={ecgData?.samplingRate || 500}
              duration={printableWidthMm / mmPerSecond} // Full width duration
            />
          </div>
        </div>

        {/* Calibration and interpretation area */}
        <div className="print-footer">
          <div className="calibration-box">
            <canvas
              width={10 * pixelsPerMm}
              height={10 * pixelsPerMm}
              className="calibration-pulse"
            />
            <span>1 mV</span>
          </div>
          <div className="interpretation-area">
            <div className="interpretation-label">Interpretation:</div>
            <div className="interpretation-lines">
              <div className="line">_____________________________________________</div>
              <div className="line">_____________________________________________</div>
              <div className="line">_____________________________________________</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PrintView
