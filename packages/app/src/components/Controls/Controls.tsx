import React from 'react'
import { ECGSettings } from '../../App'
import { DEFAULT_ECGSYN_PARAMS, PATHOLOGY_PARAMS, ENHANCED_PATHOLOGY_PARAMS } from '@open-ecg-generator/core'
import WaveParameterEditor from './WaveParameterEditor'
import './Controls.css'

interface ControlsProps {
  settings: ECGSettings
  onSettingsChange: (settings: ECGSettings) => void
  onExport: (format: 'png' | 'pdf') => void
  onRegenerate: () => void
  isGenerating: boolean
}

// Helper function to get effective parameters for a pathology
const getPathologyParams = (pathology: string) => {
  if (pathology === 'custom') return DEFAULT_ECGSYN_PARAMS
  
  let params = { ...DEFAULT_ECGSYN_PARAMS }
  
  // Try enhanced parameters first
  const enhancedPathology = ENHANCED_PATHOLOGY_PARAMS[pathology as keyof typeof ENHANCED_PATHOLOGY_PARAMS]
  if (enhancedPathology) {
    params = enhancedPathology(params)
  } else if ((PATHOLOGY_PARAMS as any)[pathology]) {
    params = (PATHOLOGY_PARAMS as any)[pathology](params)
  }
  
  return params
}

const Controls: React.FC<ControlsProps> = ({
  settings,
  onSettingsChange,
  onExport,
  onRegenerate,
  isGenerating
}) => {
  const updateSetting = <K extends keyof ECGSettings>(
    key: K,
    value: ECGSettings[K]
  ) => {
    onSettingsChange({ ...settings, [key]: value })
  }

  return (
    <div className="controls surface">
      <div className="controls-header">
        <h2>ECG Settings</h2>
        <button
          className="btn btn-primary btn-regenerate"
          onClick={onRegenerate}
          disabled={isGenerating}
          title="Generate new random variation"
        >
          🔄 New
        </button>
      </div>
      
      <div className="control-section">
        <h3>Pathology</h3>
        <div className="form-group">
          <select
            className="select"
            value={settings.pathology}
            onChange={(e) => {
              const value = e.target.value
              if (value === 'custom') {
                // Switch to custom mode - use current params or defaults
                const currentParams = settings.customWaveParams || { ...DEFAULT_ECGSYN_PARAMS }
                onSettingsChange({
                  ...settings,
                  pathology: 'custom',
                  customWaveParams: currentParams
                })
              } else {
                // Switch to preset - clear custom params
                onSettingsChange({
                  ...settings,
                  pathology: value as any,
                  customWaveParams: null
                })
              }
            }}
          >
            <option value="normal">Normal Sinus Rhythm</option>
            <option value="stemi">Myocardial Infarction (STEMI)</option>
            <option value="atrialFibrillation">Atrial Fibrillation</option>
            <option value="ventricularTachycardia">Ventricular Tachycardia</option>
            <option value="bradycardia">Bradycardia</option>
            <option value="tachycardia">Tachycardia</option>
            <option value="custom">Custom Parameters</option>
          </select>
        </div>

        {/* Advanced Wave Parameters Editor */}
        {settings.pathology === 'custom' ? (
          <WaveParameterEditor
            params={settings.customWaveParams || DEFAULT_ECGSYN_PARAMS}
            onParamsChange={(params) => onSettingsChange({ ...settings, customWaveParams: params })}
            onReset={() => onSettingsChange({ ...settings, pathology: 'normal', customWaveParams: null })}
            isCustom={true}
          />
        ) : (
          <details className="advanced-params">
            <summary>Show Wave Parameters</summary>
            <WaveParameterEditor
              params={settings.customWaveParams || getPathologyParams(settings.pathology)}
              onParamsChange={(params) => onSettingsChange({ ...settings, pathology: 'custom', customWaveParams: params })}
              onReset={() => onSettingsChange({ ...settings, customWaveParams: null })}
              isCustom={false}
            />
          </details>
        )}
      </div>

      <div className="control-section">
        <h3>Heart Rate</h3>
        <div className="form-group">
          <div className="slider-container">
            <input
              type="range"
              className="slider"
              min="30"
              max="200"
              value={settings.heartRate}
              onChange={(e) => updateSetting('heartRate', Number(e.target.value))}
            />
            <span className="slider-value">{settings.heartRate} bpm</span>
          </div>
        </div>
      </div>

      <div className="control-section">
        <h3>Display Settings</h3>
        <div className="form-group">
          <label className="label">Lead Set</label>
          <select
            className="select"
            value={settings.leadSet}
            onChange={(e) => updateSetting('leadSet', e.target.value as any)}
          >
            <option value="12-lead">12-Lead ECG (10s standard)</option>
            <option value="rhythm">Rhythm Strip</option>
            <option value="single">Single Lead</option>
          </select>
        </div>
        
        {settings.leadSet === '12-lead' && (
          <div className="info-note">
            <small>12-lead ECG shows 10 seconds (medical standard): 2.5s per lead + 10s rhythm strip</small>
          </div>
        )}

        {(settings.leadSet === 'rhythm' || settings.leadSet === 'single') && (
          <div className="form-group">
            <label className="label">Lead</label>
            <select
              className="select"
              value={settings.selectedLead}
              onChange={(e) => updateSetting('selectedLead', e.target.value)}
            >
              <option value="I">Lead I</option>
              <option value="II">Lead II</option>
              <option value="III">Lead III</option>
              <option value="aVR">Lead aVR</option>
              <option value="aVL">Lead aVL</option>
              <option value="aVF">Lead aVF</option>
              <option value="V1">Lead V1</option>
              <option value="V2">Lead V2</option>
              <option value="V3">Lead V3</option>
              <option value="V4">Lead V4</option>
              <option value="V5">Lead V5</option>
              <option value="V6">Lead V6</option>
            </select>
          </div>
        )}

        <div className="form-group">
          <label className="label">Paper Speed</label>
          <div className="button-group">
            <button
              className={`btn ${settings.paperSpeed === 25 ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => updateSetting('paperSpeed', 25)}
            >
              25 mm/s
            </button>
            <button
              className={`btn ${settings.paperSpeed === 50 ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => updateSetting('paperSpeed', 50)}
            >
              50 mm/s
            </button>
          </div>
        </div>

        <div className="form-group">
          <label className="label">Gain</label>
          <div className="button-group">
            <button
              className={`btn ${settings.gain === 5 ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => updateSetting('gain', 5)}
            >
              5 mm/mV
            </button>
            <button
              className={`btn ${settings.gain === 10 ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => updateSetting('gain', 10)}
            >
              10 mm/mV
            </button>
            <button
              className={`btn ${settings.gain === 20 ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => updateSetting('gain', 20)}
            >
              20 mm/mV
            </button>
          </div>
        </div>
      </div>

      <div className="control-section">
        <h3>Signal Quality</h3>
        <div className="form-group">
          <label className="label">Noise Level</label>
          <div className="slider-container">
            <input
              type="range"
              className="slider"
              min="0"
              max="0.2"
              step="0.01"
              value={settings.noiseLevel}
              onChange={(e) => updateSetting('noiseLevel', Number(e.target.value))}
            />
            <span className="slider-value">{(settings.noiseLevel * 100).toFixed(0)}%</span>
          </div>
        </div>

        <div className="form-group">
          <label className="label checkbox-label">
            <input
              type="checkbox"
              checked={settings.skipFirst5s}
              onChange={(e) => updateSetting('skipFirst5s', e.target.checked)}
            />
            <span>Skip First 5 Seconds</span>
          </label>
          {settings.skipFirst5s && (
            <div className="info-note" style={{ marginTop: '0.5rem' }}>
              <small>Discards initial 5s to show stabilized signal only</small>
            </div>
          )}
        </div>

        <div className="form-group">
          <label className="label checkbox-label">
            <input
              type="checkbox"
              checked={settings.respiratoryWander}
              onChange={(e) => updateSetting('respiratoryWander', e.target.checked)}
            />
            <span>Respiratory Baseline Wander</span>
          </label>
        </div>

        {settings.respiratoryWander && (
          <div className="form-group">
            <label className="label">Respiratory Rate</label>
            <div className="slider-container">
              <input
                type="range"
                className="slider"
                min="8"
                max="30"
                step="1"
                value={settings.respiratoryRate}
                onChange={(e) => updateSetting('respiratoryRate', Number(e.target.value))}
              />
              <span className="slider-value">{settings.respiratoryRate} /min</span>
            </div>
          </div>
        )}
      </div>

      {/* Duration only for rhythm/single lead views - 12-lead is always 10s (medical standard) */}
      {settings.leadSet !== '12-lead' && (
        <div className="control-section">
          <h3>Duration</h3>
          <div className="form-group">
            <div className="slider-container">
              <input
                type="range"
                className="slider"
                min="5"
                max="60"
                value={settings.duration}
                onChange={(e) => updateSetting('duration', Number(e.target.value))}
              />
              <span className="slider-value">{settings.duration}s</span>
            </div>
          </div>
        </div>
      )}

      <div className="control-section actions">
        <button
          className="btn btn-primary"
          onClick={() => onExport('png')}
          disabled={isGenerating}
        >
          Export PNG
        </button>
      </div>
    </div>
  )
}

export default Controls
