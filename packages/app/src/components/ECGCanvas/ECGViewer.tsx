import React from 'react'
import ECGLeadBox from './ECGLeadBox'
import RhythmStrip from './RhythmStrip'
import { ECGSettings } from '../../App'
import './ECGViewer.css'

interface ECGViewerProps {
  data: any
  settings: ECGSettings
  isLoading: boolean
}

const ECGViewer: React.FC<ECGViewerProps> = ({ data, settings, isLoading }) => {
  // Calculate dimensions based on settings
  const pixelsPerMm = 4 // Base scaling for screen display
  const mmPerSecond = settings.paperSpeed // 25 or 50 mm/s
  const mmPerMv = settings.gain // 5, 10, or 20 mm/mV
  
  // Standard 12-lead ECG layout (column-based format):
  // Column 1: I, II, III (limb leads)
  // Column 2: aVR, aVL, aVF (augmented limb leads)
  // Column 3: V1, V2, V3 (precordial septal/anterior)
  // Column 4: V4, V5, V6 (precordial lateral)
  const leads12 = [
    'I', 'aVR', 'V1', 'V4',
    'II', 'aVL', 'V2', 'V5',
    'III', 'aVF', 'V3', 'V6'
  ]
  
  if (isLoading) {
    return (
      <div className="ecg-viewer loading">
        <p>Generating ECG...</p>
      </div>
    )
  }

  if (!data || !data.leads) {
    return (
      <div className="ecg-viewer loading">
        <p>No ECG data available.</p>
      </div>
    )
  }

  return (
    <div className="ecg-viewer surface">
      {settings.leadSet === '12-lead' ? (
        <div className="ecg-12-lead-container">
          {/* 12-lead grid layout: 4 columns × 3 rows (medical standard) */}
          <div className="ecg-12-lead-grid">
            {leads12.map((lead, index) => (
              <ECGLeadBox
                key={lead}
                lead={lead}
                data={data?.leads?.[lead]?.signal || []}
                pixelsPerMm={pixelsPerMm}
                mmPerSecond={mmPerSecond}
                mmPerMv={mmPerMv}
                samplingRate={data?.samplingRate || 500}
                duration={2.5}
                showCalibration={index === 0}
              />
            ))}
          </div>
          
          {/* Rhythm strip (usually Lead II) */}
          <RhythmStrip
            lead="II"
            data={data?.leads?.['II']?.signal || []}
            pixelsPerMm={pixelsPerMm}
            mmPerSecond={mmPerSecond}
            mmPerMv={mmPerMv}
            samplingRate={data?.samplingRate || 500}
            duration={10}
            heartRate={settings.heartRate}
            showTechnicalInfo={true}
          />
        </div>
      ) : settings.leadSet === 'rhythm' ? (
        <RhythmStrip
          lead={settings.selectedLead}
          data={data?.leads?.[settings.selectedLead]?.signal || []}
          pixelsPerMm={pixelsPerMm}
          mmPerSecond={mmPerSecond}
          mmPerMv={mmPerMv}
          samplingRate={data?.samplingRate || 500}
          heartRate={settings.heartRate}
          showTechnicalInfo={true}
        />
      ) : (
        <RhythmStrip
          lead={settings.selectedLead}
          data={data?.leads?.[settings.selectedLead]?.signal || []}
          pixelsPerMm={pixelsPerMm}
          mmPerSecond={mmPerSecond}
          mmPerMv={mmPerMv}
          samplingRate={data?.samplingRate || 500}
          heartRate={settings.heartRate}
          showTechnicalInfo={true}
        />
      )}
      
    </div>
  )
}

export default ECGViewer
