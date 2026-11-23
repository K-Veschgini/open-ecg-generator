import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ECGGenerator,
  STANDARD_LEADS,
  type ECGGeneratorOptions,
  type ECGResult,
  type ECGSynParameters,
  type LeadName
} from '@open-ecg-generator/core'
import html2canvas from 'html2canvas'
import Layout from './components/Layout/Layout'
import ECGViewer from './components/ECGCanvas/ECGViewer'
import Controls from './components/Controls/Controls'
import PrintView from './components/PrintView/PrintView'
import {
  GENERATOR_SAMPLING_RATE,
  buildGeneratorOptions,
  randomSeed,
  type ECGData,
  type ECGSettings
} from './types'
import './styles/App.css'

export type { ECGSettings } from './types'

const INITIAL_SETTINGS: ECGSettings = {
  pathology: 'normal',
  customBase: 'normal',
  heartRate: 70,
  paperSpeed: 25,
  gain: 10,
  noiseLevel: 0.15,
  variation: 0.3,
  leadSet: '12-lead',
  selectedLead: 'II',
  duration: 10,
  respiratoryWander: false,
  respiratoryRate: 15,
  solverAccuracy: 'standard',
  customWaveParams: null
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function generateAllLeads(
  generator: ECGGenerator,
  options: ECGGeneratorOptions,
  pathology: ECGSettings['pathology']
): ECGData {
  const raw = generator.generateMultiLead(options, [...STANDARD_LEADS])
  const leads = {} as Record<LeadName, ECGResult>
  for (const lead of STANDARD_LEADS) {
    const r = raw[lead]
    if (!r) throw new Error(`Generator returned no data for lead ${lead}`)
    leads[lead] = r
  }
  const ref = leads.II
  return {
    leads,
    samplingRate: ref.samplingRate,
    duration: ref.metadata.duration,
    heartRate: ref.metadata.heartRate,
    pathology
  }
}

function App() {
  const [settings, setSettings] = useState<ECGSettings>(INITIAL_SETTINGS)
  const [seed, setSeed] = useState<number>(randomSeed)
  const [ecgData, setEcgData] = useState<ECGData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(true)
  const [printData, setPrintData] = useState<ECGData | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const viewerRef = useRef<HTMLDivElement>(null)

  const generator = useMemo(() => new ECGGenerator(GENERATOR_SAMPLING_RATE), [])
  const options = useMemo(() => buildGeneratorOptions(settings, seed), [settings, seed])

  // Parameters the generator really uses (preset -> rate -> variation -> custom), for the parameter panel.
  const activeParams = useMemo<ECGSynParameters | null>(() => {
    try {
      return generator.resolveParams(options)
    } catch {
      return null
    }
  }, [generator, options])

  // Generate asynchronously (debounced) so slider drags stay responsive and the busy state can render.
  useEffect(() => {
    setIsGenerating(true)
    const id = window.setTimeout(() => {
      try {
        setEcgData(generateAllLeads(generator, options, settings.pathology))
        setError(null)
      } catch (e) {
        setEcgData(null)
        setError(errorMessage(e))
      } finally {
        setIsGenerating(false)
      }
    }, 30)
    return () => window.clearTimeout(id)
  }, [generator, options, settings.pathology])

  const handleRegenerate = () => setSeed(randomSeed())

  const handlePrint = () => {
    try {
      // The print page is always the standard 10 s 12-lead layout; same seed => same recording.
      const data =
        settings.leadSet === '12-lead' && ecgData && ecgData.duration >= 10
          ? ecgData
          : generateAllLeads(generator, buildGeneratorOptions({ ...settings, leadSet: '12-lead' }, seed), settings.pathology)
      setStatusMessage(null)
      setPrintData(data)
    } catch (e) {
      setStatusMessage(`Could not prepare print view: ${errorMessage(e)}`)
    }
  }

  const closePrint = useCallback(() => setPrintData(null), [])

  const handleExportPng = async () => {
    const target = viewerRef.current?.querySelector<HTMLElement>('.ecg-viewer-body > *')
    if (!target) {
      setStatusMessage('Nothing to export yet.')
      return
    }
    try {
      setStatusMessage('Exporting PNG...')
      const canvas = await html2canvas(target, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
        useCORS: true,
        width: target.scrollWidth,
        height: target.scrollHeight,
        windowWidth: Math.max(document.documentElement.clientWidth, target.scrollWidth)
      })
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve))
      if (!blob) throw new Error('Canvas could not be encoded')
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
      link.download = `ECG-${settings.pathology}-${timestamp}.png`
      link.href = url
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatusMessage('PNG exported.')
    } catch (e) {
      setStatusMessage(`Export failed: ${errorMessage(e)}`)
    }
  }

  if (printData) {
    return <PrintView ecgData={printData} settings={settings} onClose={closePrint} />
  }

  return (
    <Layout>
      <div className="app-container">
        <main className="app-main">
          <div className="controls-section no-print">
            <Controls
              settings={settings}
              onSettingsChange={setSettings}
              activeParams={activeParams}
              actualHeartRate={ecgData?.heartRate ?? null}
              onExportPng={handleExportPng}
              onPrint={handlePrint}
              onRegenerate={handleRegenerate}
              isGenerating={isGenerating}
              statusMessage={statusMessage}
            />
          </div>

          <div className="viewer-section" ref={viewerRef}>
            <ECGViewer data={ecgData} settings={settings} isLoading={isGenerating} error={error} />
          </div>
        </main>
      </div>
    </Layout>
  )
}

export default App
