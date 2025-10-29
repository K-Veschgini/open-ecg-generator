import { useState, useEffect, useRef } from 'react'
import { ECGGenerator, PathologyType, type ECGSynParameters } from '@open-ecg-generator/core'
import html2canvas from 'html2canvas'
import Layout from './components/Layout/Layout'
import ECGViewer from './components/ECGCanvas/ECGViewer'
import Controls from './components/Controls/Controls'
import PrintView from './components/PrintView/PrintView'
import './styles/App.css'

export interface ECGSettings {
  pathology: PathologyType | 'custom'
  heartRate: number
  paperSpeed: 25 | 50 // mm/s
  gain: 5 | 10 | 20 // mm/mV
  noiseLevel: number
  leadSet: '12-lead' | 'rhythm' | 'single'
  selectedLead: string
  duration: number // seconds - only for rhythm/single lead views
  respiratoryWander: boolean
  respiratoryRate: number // breaths per minute
  skipFirst5s: boolean // Skip first 5 seconds to avoid initialization artifacts
  solverAccuracy: 'standard' | 'high' | 'ultra' // ODE solver accuracy
  customWaveParams: ECGSynParameters | null // null = use preset, object = custom
}

function App() {
  const [settings, setSettings] = useState<ECGSettings>({
    pathology: 'normal',
    heartRate: 70,
    paperSpeed: 25,
    gain: 10,
    noiseLevel: 0.0,  // Start with clean signal
    leadSet: '12-lead',
    selectedLead: 'II',
    duration: 10,
    respiratoryWander: false,
    respiratoryRate: 15,
    skipFirst5s: false,
    solverAccuracy: 'high',  // Use high accuracy by default
    customWaveParams: null  // Start with preset
  })

  const [ecgData, setEcgData] = useState<any>(null)
  const [isPrintView, setIsPrintView] = useState(false)
  const [regenerateTrigger, setRegenerateTrigger] = useState(0)
  const generatorRef = useRef<ECGGenerator | null>(null)
  const viewerRef = useRef<HTMLDivElement>(null)

  // Initialize ECG generator
  useEffect(() => {
    try {
      generatorRef.current = new ECGGenerator()
    } catch (error) {
      console.error('Failed to initialize ECGGenerator:', error)
    }
  }, [])

  // Generate ECG data when settings change
  useEffect(() => {
    if (!generatorRef.current) return
    
    const generateECG = () => {
      try {
        // Configure generator based on settings
        // For 12-lead view, always generate 10 seconds (medical standard)
        // For rhythm/single views, use user-specified duration
        const baseDuration = settings.leadSet === '12-lead' ? 10 : settings.duration
        
        // Add extra time: 5 seconds if skipping, or 1 beat for random phase
        const beatDuration = 60 / settings.heartRate
        const generationDuration = settings.skipFirst5s ? baseDuration + 5 : baseDuration + beatDuration
        
        // Map accuracy setting to ODE solver tolerance
        const toleranceMap = {
          'standard': 1e-5,  // Fast, good for preview
          'high': 1e-7,      // Recommended for medical use
          'ultra': 1e-9      // Maximum accuracy, slower
        }
        
        // Add biological variation to make each generation unique
        // Randomize wave parameters (unless using custom params)
        const variation = 0.3 // 30% variation for clearly visible differences
        
        const customParams = settings.customWaveParams || {
          respiratoryRate: settings.respiratoryWander ? settings.respiratoryRate : 0,
          respiratoryAmplitude: settings.respiratoryWander ? 0.01 : 0,
          // Add subtle wave parameter variations for uniqueness
          P: {
            amplitude: 0.15 * (1 + (Math.random() - 0.5) * variation * 2),
            width: 0.09 * (1 + (Math.random() - 0.5) * variation),
            position: -Math.PI / 3 + (Math.random() - 0.5) * 0.3
          },
          Q: {
            amplitude: -0.025 * (1 + (Math.random() - 0.5) * variation * 3),
            width: 0.066 * (1 + (Math.random() - 0.5) * variation),
            position: -Math.PI / 12 + (Math.random() - 0.5) * 0.2
          },
          R: {
            amplitude: 1.6 * (1 + (Math.random() - 0.5) * variation * 1.5),
            width: 0.11 * (1 + (Math.random() - 0.5) * variation),
            position: 0
          },
          S: {
            amplitude: -0.25 * (1 + (Math.random() - 0.5) * variation * 3),
            width: 0.066 * (1 + (Math.random() - 0.5) * variation),
            position: Math.PI / 12 + (Math.random() - 0.5) * 0.2
          },
          T: {
            amplitude: 0.35 * (1 + (Math.random() - 0.5) * variation * 2.5),
            width: 0.142 * (1 + (Math.random() - 0.5) * variation * 1.5),
            position: Math.PI / 2 + (Math.random() - 0.5) * 0.4
          }
        }
        
        // Calculate random time offset to vary starting phase
        const randomHR = settings.heartRate * (1 + (Math.random() - 0.5) * 0.03)
        const timeToSkip = settings.skipFirst5s 
          ? 5  // Skip full 5 seconds as requested
          : Math.random() * (60 / randomHR)  // Skip random portion of one beat
        
        const config = {
          heartRate: settings.heartRate * (1 + (Math.random() - 0.5) * 0.03), // ±1.5% HR variation
          duration: generationDuration,
          samplingRate: 500,
          // Always add some noise to ensure variation
          noise: {
            gaussian: {
              amplitude: Math.max(0.005, settings.noiseLevel * 0.05)  // At least 0.005 for visible variation
            }
          },
          pathology: (settings.pathology === 'custom' ? 'normal' : settings.pathology) as PathologyType,
          // Use custom params with biological variation
          customParams: customParams,
          // ODE solver tolerance for adaptive RK45
          solverTolerance: toleranceMap[settings.solverAccuracy]
        }
        
        console.log('Regenerating ECG - Trigger:', regenerateTrigger, 'Time offset:', timeToSkip.toFixed(3), 's')

        // Generate all 12 leads
        const allLeads = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']
        let leads = generatorRef.current!.generateMultiLead(config, allLeads)
        
        const samplesToSkip = Math.floor(timeToSkip * 500)
        const processedLeads: typeof leads = {}
        
        for (const leadName of allLeads) {
          if (leads[leadName]) {
            processedLeads[leadName] = {
              ...leads[leadName],
              signal: leads[leadName].signal.slice(samplesToSkip),
              time: leads[leadName].time.slice(samplesToSkip).map(t => t - timeToSkip)
            }
          }
        }
        
        leads = processedLeads
        
        // Format data for components
        const data = {
          leads: leads,
          samplingRate: 500
        }
        
        // Debug: Check signal values
        if (leads['II']?.signal) {
          const signal = leads['II'].signal
          const min = Math.min(...signal)
          const max = Math.max(...signal)
          const mean = signal.reduce((a, b) => a + b, 0) / signal.length
          console.log('ECG Signal stats:', { min, max, mean, range: max - min })
        }
        
        setEcgData(data)
      } catch (error) {
        console.error('Error generating ECG:', error)
      }
    }
    
    generateECG()
  }, [settings, regenerateTrigger])

  const handleRegenerate = () => {
    setRegenerateTrigger(prev => prev + 1)
  }

  const handlePrint = () => {
    setIsPrintView(true)
    setTimeout(() => {
      window.print()
      setIsPrintView(false)
    }, 100)
  }

  const handleExport = async (format: 'png' | 'pdf') => {
    if (!viewerRef.current) return

    try {
      if (format === 'png') {
        // Find the actual ECG viewer element (skip the wrapper)
        const ecgViewer = viewerRef.current.querySelector('.ecg-viewer')
        if (!ecgViewer) return

        // Capture the ECG viewer as canvas
        const canvas = await html2canvas(ecgViewer as HTMLElement, {
          backgroundColor: '#ffffff',
          scale: 2, // Higher resolution
          logging: false,
          useCORS: true,
          windowWidth: ecgViewer.scrollWidth,
          windowHeight: ecgViewer.scrollHeight
        })

        // Convert to blob and download
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
            link.download = `ECG-${settings.pathology}-${timestamp}.png`
            link.href = url
            link.click()
            URL.revokeObjectURL(url)
          }
        })
      } else if (format === 'pdf') {
        // For PDF, use the browser's print-to-PDF functionality
        handlePrint()
      }
    } catch (error) {
      console.error('Error exporting ECG:', error)
      alert('Failed to export ECG. Please try again.')
    }
  }

  if (isPrintView) {
    return <PrintView ecgData={ecgData} settings={settings} />
  }

  return (
    <Layout>
      <div className="app-container">
        <main className="app-main">
          <div className="controls-section no-print">
            <Controls
              settings={settings}
              onSettingsChange={setSettings}
              onExport={handleExport}
              onRegenerate={handleRegenerate}
              isGenerating={false}
            />
          </div>

          <div className="viewer-section" ref={viewerRef}>
            {ecgData ? (
              <ECGViewer
                data={ecgData}
                settings={settings}
                isLoading={false}
              />
            ) : (
              <div className="loading-placeholder">
                <p>Initializing ECG generator...</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </Layout>
  )
}

export default App
