# Technical Documentation: Generating Realistic Electrocardiograms

## Introduction

This document outlines the technical approach for creating synthetic electrocardiograms that are indistinguishable from real physiological recordings. The focus is on implementation-relevant details rather than clinical aspects, providing a foundation for developing an educational ECG generation system.

## ECG Signal Fundamentals

### Signal Components

An ECG signal consists of repeating cardiac cycles, each containing distinct waveforms:

- **P wave**: Atrial depolarization (duration: 80-120ms, amplitude: 0.05-0.25mV)
- **QRS complex**: Ventricular depolarization (duration: 80-120ms, amplitude: 0.5-3.0mV)
- **T wave**: Ventricular repolarization (duration: 120-160ms, amplitude: 0.1-0.5mV)

### Temporal Parameters

Key intervals between components:
- **PR interval**: 120-200ms (from P wave start to QRS start)
- **QT interval**: 350-440ms (from QRS start to T wave end)
- **RR interval**: Variable based on heart rate (60 bpm = 1000ms)

### Lead System

Standard 12-lead ECG consists of:
- 6 limb leads (I, II, III, aVR, aVL, aVF)
- 6 precordial leads (V1-V6)

Each lead represents a different electrical view of the heart, requiring distinct morphologies.

## Mathematical Modeling Approaches

### ECGSYN Model

The ECGSYN model (McSharry et al., 2003) uses three coupled ordinary differential equations to generate realistic ECG signals without requiring any training data:

```
dx/dt = α·x - ω·y
dy/dt = α·y + ω·x
dz/dt = -Σ[ai·ω·Δθi·exp(-Δθi²/(2·bi²))] - (z - z0)
```

Where:
- **x, y**: Describe trajectory in phase space
- **z**: The actual ECG signal output
- **α = 1 - √(x² + y²)**: Attracts trajectory to unit circle
- **ω = 2π/RR**: Angular velocity (RR = beat-to-beat interval)
- **θ = atan2(y, x)**: Current phase angle
- **Δθi = (θ - θi) mod 2π**: Angular distance from wave i
- **z0(t) = A·sin(2πf·t)**: Baseline wander from respiration

### Practical Implementation

```python
import numpy as np
from scipy.integrate import odeint

def ecgsyn_ode(state, t, params):
    x, y, z = state
    
    # Unpack parameters
    omega = params['omega']
    amplitudes = params['amplitudes']  # [aP, aQ, aR, aS, aT]
    widths = params['widths']          # [bP, bQ, bR, bS, bT]
    positions = params['positions']    # [θP, θQ, θR, θS, θT]
    
    # Calculate alpha
    r = np.sqrt(x**2 + y**2)
    alpha = 1 - r
    
    # Current phase
    theta = np.arctan2(y, x)
    
    # Calculate z derivative
    dz_dt = 0
    for ai, bi, theta_i in zip(amplitudes, widths, positions):
        delta_theta = np.mod(theta - theta_i, 2*np.pi)
        if delta_theta > np.pi:
            delta_theta -= 2*np.pi
        dz_dt -= ai * omega * delta_theta * np.exp(-delta_theta**2 / (2*bi**2))
    
    # Add baseline restoration
    dz_dt -= (z - params['z0'])
    
    # Return derivatives
    return [alpha*x - omega*y, alpha*y + omega*x, dz_dt]
```

#### Key Parameters

Each waveform (P, Q, R, S, T) is characterized by:
- **Amplitude** (ai): Height of the wave in mV
- **Width** (bi): Angular width controlling duration
- **Position** (θi): Angular location in the cardiac cycle

##### Standard Parameter Values

```python
# Normal ECG parameters (for 60 bpm)
standard_params = {
    'P': {'amplitude': 0.15, 'width': 0.09, 'position': -π/3},
    'Q': {'amplitude': -0.025, 'width': 0.066, 'position': -π/12},
    'R': {'amplitude': 1.6, 'width': 0.11, 'position': 0},
    'S': {'amplitude': -0.25, 'width': 0.066, 'position': π/12},
    'T': {'amplitude': 0.35, 'width': 0.142, 'position': π/2}
}
```

#### Heart Rate Variability

Implemented through modulation of ω (angular frequency):
```
ω(t) = 2π/RR(t)
```

Where RR(t) varies according to:
- Respiratory sinus arrhythmia
- Mayer waves
- Random fluctuations

### Noise Components

Realistic ECG signals require several noise sources:

1. **Baseline Wander**: Low-frequency drift (0.05-0.5 Hz)
   - Sinusoidal components with random phase
   - Amplitude: 0.05-0.15 mV

2. **Muscle Artifacts**: High-frequency noise (20-100 Hz)
   - Gaussian white noise filtered through bandpass
   - Amplitude: 0.01-0.05 mV

3. **Power Line Interference**: 50/60 Hz sinusoidal
   - Amplitude: 0.01-0.03 mV

## Existing Python Libraries for ECG Generation

### NeuroKit2

NeuroKit2 provides a simple interface for ECG generation without requiring any training data:

```python
import neurokit2 as nk
import matplotlib.pyplot as plt

# Generate 10 seconds of ECG at 1000Hz sampling rate
ecg = nk.ecg_simulate(duration=10, sampling_rate=1000, heart_rate=70)

# Generate ECG with specific characteristics
ecg_custom = nk.ecg_simulate(
    duration=10, 
    sampling_rate=1000,
    heart_rate=70,
    heart_rate_std=3,  # Heart rate variability
    noise=0.01,  # Noise level
    random_state=42
)

# Plot the ECG
plt.figure(figsize=(12, 4))
plt.plot(ecg[:3000])  # First 3 seconds
plt.xlabel('Sample')
plt.ylabel('Amplitude')
plt.title('Simulated ECG Signal')
plt.show()
```

### BioSPPy

Another option for physiological signal processing:

```python
from biosppy import signals as bio

# BioSPPy focuses more on processing real ECGs
# but can be combined with synthetic generation
```

## Alternative Approaches (Data-Dependent)

### Generative Adversarial Networks (GANs)

**Important Note**: GAN-based approaches require substantial training data from real ECG recordings. Since pre-trained ECG GAN models are not readily available publicly, this approach is not practical without access to large ECG datasets. The mathematical modeling approach (described above) is the recommended solution for generating realistic ECGs without existing data.

GANs could theoretically generate highly realistic ECGs by learning from real data, but this creates a circular dependency - you need ECG data to train the model that generates ECG data.

## Implementation Architecture

### Core Components

1. **Signal Generator Module**
   - Mathematical model implementation
   - Parameter management
   - Waveform synthesis

2. **Pathology Simulator**
   - Pattern library for conditions
   - Parameter modifications
   - Morphology alterations

3. **Noise Generator**
   - Artifact synthesis
   - Realistic interference patterns

4. **Lead Transformer**
   - Single to multi-lead conversion
   - Lead-specific morphologies

### Data Flow

```
Parameters → Signal Generator → Base ECG
                                    ↓
Pathology Parameters → Pathology Simulator → Modified ECG
                                                    ↓
                              Noise Generator → Realistic ECG
                                                    ↓
                              Lead Transformer → 12-Lead ECG
```

## Pathological Pattern Generation

### Arrhythmia Simulation

1. **Atrial Fibrillation**
   - Remove P waves
   - Add fibrillatory baseline (350-600 Hz oscillations)
   - Irregular RR intervals (completely random)

2. **Ventricular Tachycardia**
   - Wide QRS complexes (>120ms)
   - Regular rapid rate (150-250 bpm)
   - AV dissociation patterns

3. **Heart Blocks**
   - First degree: Prolonged PR interval (>200ms)
   - Second degree: Dropped QRS complexes
   - Third degree: Complete AV dissociation

### Morphological Abnormalities

1. **ST Elevation (Myocardial Infarction)**
   - Elevate ST segment by 0.1-0.3 mV
   - Modify T wave morphology
   - Add pathological Q waves

2. **Bundle Branch Blocks**
   - Widen QRS complex
   - Alter QRS morphology based on block type
   - Adjust T wave orientation

## Technical Implementation Guidelines

### Sampling and Resolution

- **Sampling Rate**: Minimum 500 Hz (clinical standard)
- **Bit Resolution**: 12-16 bits
- **Signal Duration**: Configurable (10 seconds typical)

### Parameter Ranges

```python
# Normal parameter ranges
parameters = {
    'heart_rate': (60, 100),  # bpm
    'pr_interval': (0.12, 0.20),  # seconds
    'qrs_duration': (0.08, 0.12),  # seconds
    'qt_interval': (0.35, 0.44),  # seconds
    'p_amplitude': (0.05, 0.25),  # mV
    'qrs_amplitude': (0.5, 3.0),  # mV
    't_amplitude': (0.1, 0.5),  # mV
}
```

### Validation Metrics

1. **Morphological Accuracy**
   - Dynamic Time Warping distance
   - Correlation coefficients
   - Feature extraction comparison

2. **Statistical Validation**
   - Heart rate variability metrics
   - Spectral analysis
   - Interval distributions

3. **Clinical Validation**
   - Expert evaluation
   - Diagnostic accuracy testing
   - Educational effectiveness

## Programming Considerations

### Technology Stack

Recommended implementation:
- **Language**: Python
- **Core Libraries**: NumPy, SciPy
- **Signal Processing**: NeuroKit2 (optional, has built-in ECG simulation)
- **Visualization**: Matplotlib, Plotly

### Quick Start with NeuroKit2

For immediate use without implementing the mathematical model:

```python
# Install: pip install neurokit2
import neurokit2 as nk
import numpy as np

# Generate various ECG types
normal_ecg = nk.ecg_simulate(duration=10, heart_rate=70)
tachy_ecg = nk.ecg_simulate(duration=10, heart_rate=120)  # Tachycardia
brady_ecg = nk.ecg_simulate(duration=10, heart_rate=45)   # Bradycardia

# Add custom noise and artifacts
noisy_ecg = normal_ecg + np.random.normal(0, 0.05, len(normal_ecg))
```

### Complete Custom Implementation

```python
import numpy as np
import matplotlib.pyplot as plt
from scipy.integrate import odeint

class ECGGenerator:
    def __init__(self, sampling_rate=1000):
        self.fs = sampling_rate
        # Standard PQRST parameters
        self.standard_params = {
            'amplitudes': np.array([0.15, -0.025, 1.6, -0.25, 0.35]),
            'widths': np.array([0.09, 0.066, 0.11, 0.066, 0.142]),
            'positions': np.array([-np.pi/3, -np.pi/12, 0, np.pi/12, np.pi/2])
        }
    
    def generate_ecg(self, duration, heart_rate=60, noise_level=0.01):
        """Generate synthetic ECG signal"""
        # Calculate parameters
        rr_interval = 60.0 / heart_rate  # seconds
        omega = 2 * np.pi / rr_interval
        
        # Time vector
        t = np.linspace(0, duration, int(duration * self.fs))
        
        # Parameters for ODE
        params = self.standard_params.copy()
        params['omega'] = omega
        params['z0'] = 0  # No baseline wander for now
        
        # Initial conditions [x, y, z]
        initial = [1, 0, 0]
        
        # Solve ODE
        solution = odeint(ecgsyn_ode, initial, t, args=(params,))
        ecg_clean = solution[:, 2]
        
        # Add noise
        noise = np.random.normal(0, noise_level, len(ecg_clean))
        ecg = ecg_clean + noise
        
        return t, ecg
    
    def add_baseline_wander(self, ecg, amplitude=0.05, frequency=0.25):
        """Add respiratory baseline wander"""
        t = np.arange(len(ecg)) / self.fs
        wander = amplitude * np.sin(2 * np.pi * frequency * t)
        return ecg + wander
    
    def simulate_arrhythmia(self, duration, arrhythmia_type='afib'):
        """Generate ECG with specific arrhythmia"""
        if arrhythmia_type == 'afib':
            # Atrial fibrillation: irregular RR, no P waves
            t_total = 0
            ecg_segments = []
            
            while t_total < duration:
                # Random RR interval (completely irregular)
                heart_rate = np.random.uniform(60, 180)
                segment_duration = min(60/heart_rate, duration - t_total)
                
                # Generate segment with no P wave
                params = self.standard_params.copy()
                params['amplitudes'][0] = 0  # Remove P wave
                # Add fibrillatory baseline
                params['z0'] = 0.05 * np.sin(2*np.pi*350*t_total)
                
                t_seg, ecg_seg = self.generate_ecg(segment_duration, heart_rate)
                ecg_segments.append(ecg_seg)
                t_total += segment_duration
            
            return np.concatenate(ecg_segments)
        
        elif arrhythmia_type == 'vt':
            # Ventricular tachycardia: wide QRS, fast rate
            params = self.standard_params.copy()
            params['widths'][2] *= 2  # Widen R wave
            params['widths'][3] *= 2  # Widen S wave
            return self.generate_ecg(duration, heart_rate=180)
```

### Performance Optimization

- Pre-compute waveform templates
- Vectorized operations for real-time generation
- GPU acceleration for GAN-based methods
- Efficient memory management for long recordings

### API Design

```python
# Example API structure
class ECGGenerator:
    def generate_normal(self, duration, heart_rate, lead='II'):
        # Generate normal ECG
        
    def generate_pathological(self, condition, duration, severity):
        # Generate ECG with specific pathology
        
    def add_noise(self, signal, noise_type, amplitude):
        # Add realistic artifacts
        
    def convert_to_12_lead(self, single_lead_signal):
        # Transform to full 12-lead ECG
```

## Conclusion

Creating indistinguishable synthetic ECGs without existing data is best achieved through mathematical modeling, specifically the ECGSYN/McSharry model. This approach:

1. **Requires no training data** - purely mathematical generation
2. **Provides complete control** over all ECG parameters
3. **Generates in real-time** - no model loading or inference needed
4. **Simulates pathologies** through parameter modification
5. **Proven effectiveness** - widely used in research since 2003

The mathematical approach provides everything needed for an educational ECG generation system without the data requirements of machine learning methods. Implementation using Python with NumPy and SciPy provides a straightforward path to creating realistic ECGs for medical education.
