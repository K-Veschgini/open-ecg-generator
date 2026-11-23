import React from 'react'
import {
  PATHOLOGY_DEFAULT_HEART_RATE,
  STANDARD_LEADS,
  type ECGSynParameters,
  type LeadName,
  type PathologyType
} from '@open-ecg-generator/core'
import WaveParameterEditor from './WaveParameterEditor'
import {
  PATHOLOGY_LABELS,
  PATHOLOGY_ORDER,
  type ECGSettings,
  type LeadSet,
  type SolverAccuracy
} from '../../types'
import './Controls.css'

interface ControlsProps {
  settings: ECGSettings
  onSettingsChange: (settings: ECGSettings) => void
  /** Parameters the generator actually uses for the current settings (preset or custom). */
  activeParams: ECGSynParameters | null
  /** Actual mean ventricular rate of the displayed recording. */
  actualHeartRate: number | null
  onExportPng: () => void
  onPrint: () => void
  onRegenerate: () => void
  isGenerating: boolean
  statusMessage: string | null
}

const HR_MIN = 30
const HR_MAX = 200

const Controls: React.FC<ControlsProps> = ({
  settings,
  onSettingsChange,
  activeParams,
  actualHeartRate,
  onExportPng,
  onPrint,
  onRegenerate,
  isGenerating,
  statusMessage
}) => {
  const updateSetting = <K extends keyof ECGSettings>(key: K, value: ECGSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value })
  }
  const isCustom = settings.pathology === 'custom'

  const selectPathology = (value: string) => {
    if (value === 'custom') {
      if (isCustom) return
      // Start editing from the parameters currently in use; keep the rhythm of the current preset.
      onSettingsChange({
        ...settings,
        pathology: 'custom',
        customBase: settings.pathology as PathologyType,
        customWaveParams: activeParams ? structuredClone(activeParams) : null
      })
      return
    }
    const p = value as PathologyType
    onSettingsChange({
      ...settings,
      pathology: p,
      customBase: p,
      customWaveParams: null,
      heartRate: Math.min(HR_MAX, Math.max(HR_MIN, PATHOLOGY_DEFAULT_HEART_RATE[p]))
    })
  }

  const editParams = (params: ECGSynParameters) => {
    onSettingsChange({
      ...settings,
      pathology: 'custom',
      customBase: isCustom ? settings.customBase : (settings.pathology as PathologyType),
      customWaveParams: params
    })
  }

  const actualRate = actualHeartRate !== null ? Math.round(actualHeartRate) : null

  return (
    <div className="controls surface">
      <div className="controls-header">
        <h2>ECG Settings</h2>
        <button
          className="btn btn-primary btn-regenerate"
          onClick={onRegenerate}
          disabled={isGenerating}
          title="Generate a new random recording (new seed)"
        >
          🔄 New
        </button>
      </div>

      <div className="control-section">
        <h3>Pathology</h3>
        <div className="form-group">
          <select className="select" value={settings.pathology} onChange={e => selectPathology(e.target.value)}>
            {PATHOLOGY_ORDER.map(p => (
              <option key={p} value={p}>
                {PATHOLOGY_LABELS[p]}
              </option>
            ))}
            <option value="custom">Custom Parameters</option>
          </select>
        </div>
        {isCustom && (
          <div className="info-note">
            <small>Rhythm and rate behaviour of: {PATHOLOGY_LABELS[settings.customBase]}</small>
          </div>
        )}

        {activeParams && (
          <details className="advanced-params" open={isCustom ? true : undefined}>
            <summary>{isCustom ? 'Wave Parameters (custom)' : 'Show Wave Parameters'}</summary>
            <WaveParameterEditor
              params={isCustom && settings.customWaveParams ? settings.customWaveParams : activeParams}
              onParamsChange={editParams}
              onReset={() =>
                onSettingsChange({ ...settings, pathology: settings.customBase, customWaveParams: null })
              }
              isCustom={isCustom}
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
              min={HR_MIN}
              max={HR_MAX}
              value={settings.heartRate}
              onChange={e => updateSetting('heartRate', Number(e.target.value))}
            />
            <span className="slider-value">{settings.heartRate} bpm</span>
          </div>
          {actualRate !== null && actualRate !== settings.heartRate && (
            <div className="info-note" style={{ marginTop: '0.5rem' }}>
              <small>Measured mean ventricular rate of this recording: {actualRate} bpm</small>
            </div>
          )}
        </div>
      </div>

      <div className="control-section">
        <h3>Display Settings</h3>
        <div className="form-group">
          <label className="label">Lead Set</label>
          <select
            className="select"
            value={settings.leadSet}
            onChange={e => updateSetting('leadSet', e.target.value as LeadSet)}
          >
            <option value="12-lead">12-Lead ECG (10 s standard)</option>
            <option value="rhythm">Rhythm Strip (II, V1, V5)</option>
            <option value="single">Single Lead</option>
          </select>
        </div>

        {settings.leadSet === '12-lead' && (
          <div className="info-note">
            <small>
              10 s recording: each column shows the next 2.5 s (0-2.5, 2.5-5, 5-7.5, 7.5-10 s) above a continuous
              10 s lead II rhythm strip.
            </small>
          </div>
        )}

        {settings.leadSet === 'single' && (
          <div className="form-group">
            <label className="label">Lead</label>
            <select
              className="select"
              value={settings.selectedLead}
              onChange={e => updateSetting('selectedLead', e.target.value as LeadName)}
            >
              {STANDARD_LEADS.map(l => (
                <option key={l} value={l}>
                  Lead {l}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="form-group">
          <label className="label">Paper Speed</label>
          <div className="button-group">
            {([25, 50] as const).map(s => (
              <button
                key={s}
                className={`btn ${settings.paperSpeed === s ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => updateSetting('paperSpeed', s)}
              >
                {s} mm/s
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="label">Gain</label>
          <div className="button-group">
            {([5, 10, 20] as const).map(g => (
              <button
                key={g}
                className={`btn ${settings.gain === g ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => updateSetting('gain', g)}
              >
                {g} mm/mV
              </button>
            ))}
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
              max="1"
              step="0.05"
              value={settings.noiseLevel}
              onChange={e => updateSetting('noiseLevel', Number(e.target.value))}
            />
            <span className="slider-value">{(settings.noiseLevel * 100).toFixed(0)}%</span>
          </div>
          <div className="info-note" style={{ marginTop: '0.5rem' }}>
            <small>
              {settings.noiseLevel > 0
                ? `Baseline wander ${(0.2 * settings.noiseLevel).toFixed(2)} mV, EMG ${(0.05 * settings.noiseLevel).toFixed(3)} mV RMS, broadband ${(0.015 * settings.noiseLevel).toFixed(3)} mV RMS, 50 Hz ${(0.02 * settings.noiseLevel).toFixed(3)} mV`
                : 'Clean signal (no noise)'}
            </small>
          </div>
        </div>

        <div className="form-group">
          <label className="label">Biological Variation</label>
          <div className="slider-container">
            <input
              type="range"
              className="slider"
              min="0"
              max="1"
              step="0.05"
              value={settings.variation}
              onChange={e => updateSetting('variation', Number(e.target.value))}
            />
            <span className="slider-value">{(settings.variation * 100).toFixed(0)}%</span>
          </div>
          <div className="info-note" style={{ marginTop: '0.5rem' }}>
            <small>
              Random wave-shape jitter (keeps the pathology's morphology) and heart-rate variability; "New" draws a new
              random recording.{isCustom ? ' Custom wave values are used exactly.' : ''}
            </small>
          </div>
        </div>

        <div className="form-group">
          <label className="label checkbox-label">
            <input
              type="checkbox"
              checked={settings.respiratoryWander}
              onChange={e => updateSetting('respiratoryWander', e.target.checked)}
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
                onChange={e => updateSetting('respiratoryRate', Number(e.target.value))}
              />
              <span className="slider-value">{settings.respiratoryRate} /min</span>
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="label">Solver Accuracy</label>
          <select
            className="select"
            value={settings.solverAccuracy}
            onChange={e => updateSetting('solverAccuracy', e.target.value as SolverAccuracy)}
          >
            <option value="fast">Fast (tolerance 1e-4)</option>
            <option value="standard">Standard (tolerance 1e-6)</option>
            <option value="high">High (tolerance 1e-8)</option>
          </select>
        </div>
      </div>

      {/* Duration only for rhythm/single lead views - 12-lead is always 10 s */}
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
                step="5"
                value={settings.duration}
                onChange={e => updateSetting('duration', Number(e.target.value))}
              />
              <span className="slider-value">{settings.duration}s</span>
            </div>
          </div>
        </div>
      )}

      <div className="control-section actions">
        <button className="btn btn-primary" onClick={onExportPng} disabled={isGenerating}>
          Export PNG
        </button>
        <button className="btn btn-secondary" onClick={onPrint} disabled={isGenerating}>
          Print / PDF
        </button>
        {statusMessage && (
          <div className="info-note" role="status" style={{ marginTop: '0.5rem' }}>
            <small>{statusMessage}</small>
          </div>
        )}
      </div>
    </div>
  )
}

export default Controls
