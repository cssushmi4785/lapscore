# Changelog
All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-03-27

### Added
- `server/batteryDeep.js` — powercfg battery firmware reader
- `server/typeperfSampler.js` — Windows Performance Counter reader
- `server/gpuMonitor.js` — nvidia-smi + wmic GPU monitor
- `client/src/components/GpuPanel.jsx` — GPU dashboard card
- `/api/battery/deep` endpoint
- `/api/throttle/realtime` endpoint
- `/api/gpu` endpoint

### Fixed
- Battery cycle count showing 0 on most Windows laptops
- Throttle detection now reads real Performance Counters
- AI Readiness VRAM calculation uses real GPU data

### Changed
- App icon: new 3D glassmorphism design
- Battery health % now calculated from capacity loss, not BIOS

## [1.0.1] - 2026-03-27
### Fixed
- Critical: Resolved "Black Screen" on launch in production builds
- Improved backend persistence using bundled Electron execution environment
- Fixed path resolution for client assets within the ASAR archive

## [1.0.0] - 2026-03-27
### Added
- Initial production-ready release
- Real-time health score (0-100) with graded categorization (A-F)
- Battery cycle intelligence with aging forecast and health snapshots
- CPU Throttle Radar: Real-time clock speed monitoring and thermal event detection
- AI Workload Monitor: Detects active Ollama, LM Studio sessions and calculates energy impact
- RAM Context Analysis: Automated calculator for LLM model fit based on free memory
- Power Cost Tracker: Translates energy footprint into user-defined currency (₹/$/€)
- Fleet Dashboard: Zero-config UDP discovery for monitoring multiple LAN devices
- Secure AppData Persistence: Writable file storage in `app.getPath('userData')` for standard compliance
- Windows Installer: Single-file `.exe` build with optimized native module delivery (`asarUnpack`)
- System Tray Integration: Background persistence with dynamic health-color tray icons
- Taskbar Overlays: Real-time score badges on the application icon for ambient monitoring
