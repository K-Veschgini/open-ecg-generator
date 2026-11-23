import React, { useEffect, useRef, useState } from 'react'
import type { ECGSynParameters, WaveParameters } from '@open-ecg-generator/core'
import './WaveParameterEditor.css'

interface WaveParameterEditorProps {
  params: ECGSynParameters
  onParamsChange: (params: ECGSynParameters) => void
  onReset: () => void
  isCustom: boolean
}

/** Model angles are referenced to 60 bpm: 1 rad = 1000 / (2 pi) ms. */
const MS_PER_RAD = 1000 / (2 * Math.PI)

type Field = 'amplitude' | 'width' | 'position'

interface FieldSpec {
  label: string
  unit: string
  title: string
  min: number
  max: number
  step: number
  decimals: number
  /** model value -> display value */
  toDisplay: (v: number) => number
  /** display value -> model value */
  fromDisplay: (v: number) => number
  /** extra validation beyond [min, max]; return an error message or null */
  check?: (v: number) => string | null
}

const FIELDS: Record<Field, FieldSpec> = {
  amplitude: {
    label: 'Peak',
    unit: 'mV',
    title: 'True peak deflection of this wave in lead II (mV). Negative = downward.',
    min: -5,
    max: 5,
    step: 0.01,
    decimals: 3,
    toDisplay: v => v,
    fromDisplay: v => v
  },
  width: {
    label: 'Width σ',
    unit: 'ms',
    title: 'Gaussian standard deviation at the 60 bpm reference (ms). Must be > 0.',
    min: 2,
    max: 300,
    step: 1,
    decimals: 1,
    toDisplay: v => v * MS_PER_RAD,
    fromDisplay: v => v / MS_PER_RAD,
    check: v => (v > 0 ? null : 'must be > 0')
  },
  position: {
    label: 'Centre',
    unit: 'ms',
    title: 'Centre of the wave relative to the R peak at the 60 bpm reference (ms). Negative = before R.',
    min: -500,
    max: 500,
    step: 5,
    decimals: 1,
    toDisplay: v => v * MS_PER_RAD,
    fromDisplay: v => v / MS_PER_RAD
  }
}

function format(spec: FieldSpec, modelValue: number): string {
  return Number(spec.toDisplay(modelValue).toFixed(spec.decimals)).toString()
}

/** Parse and validate display text; returns the display number or an error message. */
function parse(spec: FieldSpec, text: string): { value: number } | { error: string } {
  const trimmed = text.trim()
  if (trimmed === '') return { error: 'required' }
  const v = Number(trimmed)
  if (!Number.isFinite(v)) return { error: 'not a number' }
  const extra = spec.check?.(v)
  if (extra) return { error: extra }
  if (v < spec.min || v > spec.max) return { error: `${spec.min} to ${spec.max}` }
  return { value: v }
}

interface NumberFieldProps {
  spec: FieldSpec
  value: number
  onCommit: (modelValue: number) => void
}

/**
 * Number input with local text state: typing is never overwritten, empty or
 * invalid text is ignored (and reverted on blur), valid values commit live.
 */
const NumberField: React.FC<NumberFieldProps> = ({ spec, value, onCommit }) => {
  const [text, setText] = useState(() => format(spec, value))
  const [error, setError] = useState<string | null>(null)
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) {
      setText(format(spec, value))
      setError(null)
    }
  }, [spec, value])

  const handleChange = (next: string) => {
    setText(next)
    const r = parse(spec, next)
    if ('error' in r) {
      setError(r.error)
      return
    }
    setError(null)
    const modelValue = spec.fromDisplay(r.value)
    if (Math.abs(modelValue - value) > 1e-12) onCommit(modelValue)
  }

  return (
    <div className="param-row">
      <label title={spec.title}>
        {spec.label} ({spec.unit})
      </label>
      <input
        type="number"
        inputMode="decimal"
        step={spec.step}
        min={spec.min}
        max={spec.max}
        value={text}
        title={spec.title}
        aria-invalid={error !== null}
        className={`input param-input ${error ? 'invalid' : ''}`}
        onFocus={() => {
          focused.current = true
        }}
        onChange={e => handleChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        onBlur={() => {
          focused.current = false
          setText(format(spec, value))
          setError(null)
        }}
      />
      {error && <span className="param-error">{error}</span>}
    </div>
  )
}

const WAVES = ['P', 'Q', 'R', 'S', 'T'] as const
type WaveKey = (typeof WAVES)[number]

const WaveGroup: React.FC<{
  title: string
  wave: WaveParameters
  onChange: (w: WaveParameters) => void
}> = ({ title, wave, onChange }) => (
  <div className="wave-param-group">
    <h4>{title}</h4>
    {(Object.keys(FIELDS) as Field[]).map(f => (
      <NumberField key={f} spec={FIELDS[f]} value={wave[f]} onCommit={v => onChange({ ...wave, [f]: v })} />
    ))}
  </div>
)

const WaveParameterEditor: React.FC<WaveParameterEditorProps> = ({ params, onParamsChange, onReset, isCustom }) => {
  const setWave = (key: WaveKey, w: WaveParameters) => onParamsChange({ ...params, [key]: w })
  const setExtra = (i: number, w: WaveParameters) => {
    const extra = (params.extraWaves ?? []).map((x, j) => (j === i ? w : x))
    onParamsChange({ ...params, extraWaves: extra })
  }

  return (
    <div className="wave-params-editor">
      {isCustom && (
        <div className="custom-mode-indicator">
          <span>Custom Parameters</span>
          <button className="btn btn-secondary btn-sm" onClick={onReset}>
            Reset to Preset
          </button>
        </div>
      )}
      <p className="wave-params-note">
        Peak = true wave amplitude in lead II (mV). Width and centre are given at the 60 bpm reference; the model
        rescales them with heart rate (fixed QRS, Fridericia QT).
        {!isCustom && ' Editing a value switches to custom mode.'}
      </p>

      <div className="wave-params-grid">
        {WAVES.map(w => (
          <WaveGroup key={w} title={`${w} Wave`} wave={params[w]} onChange={nw => setWave(w, nw)} />
        ))}
        {(params.extraWaves ?? []).map((w, i) => (
          <WaveGroup key={`x${i}`} title={`Extra wave ${i + 1}`} wave={w} onChange={nw => setExtra(i, nw)} />
        ))}
      </div>
    </div>
  )
}

export default WaveParameterEditor
