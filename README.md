# Open ECG Generator

Professional ECG generation and visualization platform for medical education.

## Features

- Generate realistic 12-lead electrocardiograms
- Multiple pathology simulations (MI, AFib, VT, bradycardia, tachycardia)
- Interactive wave parameter editing
- Real-time visualization with medical-grade ECG grid
- Adaptive RK45 ODE solver for high accuracy
- Biological variation - generate unique examples
- Export to PNG

## Quick Start

```bash
# Install dependencies
npm install

# Build core library
npm run build:core

# Start development server
npm run dev
```

Open http://localhost:5173

## Project Structure

```
packages/
├── core/     ECG generation library (ECGSYN algorithm)
└── app/      React web application
docs/         Technical documentation
```

## Usage

1. Select pathology from dropdown
2. Adjust heart rate, gain, and paper speed
3. Click "New" button to generate variations
4. Expand "Show Wave Parameters" for advanced control
5. Export as PNG when ready

## Technical Details

- **Algorithm**: ECGSYN mathematical model
- **Solver**: Dormand-Prince RK45 adaptive method
- **Grid**: Standard ECG paper (1mm/5mm squares)
- **Scaling**: 25 mm/s paper speed, 10 mm/mV gain (adjustable)
- **Leads**: Standard 12-lead configuration

## License

MIT - Educational use only, not for clinical diagnosis.

