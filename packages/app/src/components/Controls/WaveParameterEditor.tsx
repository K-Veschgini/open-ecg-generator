import React from 'react'
import type { ECGSynParameters } from '@open-ecg-generator/core'
import './WaveParameterEditor.css'

interface WaveParameterEditorProps {
  params: ECGSynParameters
  onParamsChange: (params: ECGSynParameters) => void
  onReset: () => void
  isCustom: boolean
}

const WaveParameterEditor: React.FC<WaveParameterEditorProps> = ({
  params,
  onParamsChange,
  onReset,
  isCustom
}) => {
  const updateWaveParam = (
    wave: 'P' | 'Q' | 'R' | 'S' | 'T',
    param: 'amplitude' | 'width' | 'position',
    value: number
  ) => {
    const newParams = { ...params }
    newParams[wave] = { ...newParams[wave], [param]: value }
    onParamsChange(newParams)
  }

  return (
    <div className="wave-params-editor">
      {isCustom && (
        <div className="custom-mode-indicator">
          <span>⚠️ Custom Parameters</span>
          <button className="btn btn-secondary btn-sm" onClick={onReset}>
            Reset to Preset
          </button>
        </div>
      )}

      <div className="wave-params-grid">
        {(['P', 'Q', 'R', 'S', 'T'] as const).map(wave => (
          <div key={wave} className="wave-param-group">
            <h4>{wave} Wave</h4>
            
            <div className="param-row">
              <label>Amplitude (mV)</label>
              <input
                type="number"
                step="0.01"
                value={params[wave].amplitude.toFixed(3)}
                onChange={(e) => updateWaveParam(wave, 'amplitude', Number(e.target.value))}
                className="input param-input"
              />
            </div>

            <div className="param-row">
              <label>Width (rad)</label>
              <input
                type="number"
                step="0.01"
                value={params[wave].width.toFixed(3)}
                onChange={(e) => updateWaveParam(wave, 'width', Number(e.target.value))}
                className="input param-input"
              />
            </div>

            <div className="param-row">
              <label>Position (rad)</label>
              <input
                type="number"
                step="0.01"
                value={params[wave].position.toFixed(3)}
                onChange={(e) => updateWaveParam(wave, 'position', Number(e.target.value))}
                className="input param-input"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default WaveParameterEditor
