const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');

const db = require('./db');
const { ingest } = require('./ingest');
const { runScan } = require('./collector');
const sampler = require('./sampler');
const cpuSampler = require('./cpuSampler');
const habits = require('./habitsAggregator');
const sohModel = require('./sohModel');
const cycleCounter = require('./cycleCounter');
const throttleEngine = require('./throttleEngine');
const smartCollector = require('./smartCollector');
const fleet = require('./fleetDiscovery');
const settingsManager = require('./settingsManager');
const reportGenerator = require('./reportGenerator');
const si = require('systeminformation');
const liveStream = require('./liveStream');
const aiReadiness = require('./aiReadiness');
const alertEngine = require('./alertEngine');
const aiMonitor = require('./aiSessionMonitor');
const powerTracker = require('./powerTracker');

// ── Helpers ──────────────────────────────────────────────────
const getLocalIP = () => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
};

// ── Scheduler state ──────────────────────────────────────────
let schedulerEnabled = false;
let schedulerTimer = null;
let schedulerIntervalMs = 60 * 60 * 1000; // 1 hour default
let lastAutoScanTs = null;

const scanRoutes = require('./routes/scan');
const batteryRoutes = require('./routes/battery');
const exportRoutes = require('./routes/export');
const fleetRoutes = require('./routes/fleet');

const app = express();
const PORT = process.env.PORT || 7821;
const DATA_DIR = process.env.LAPSCORE_DATA_DIR || path.join(__dirname, '..', 'data');
const DIST_DIR = process.env.CLIENT_DIST_PATH || path.join(__dirname, '..', 'client', 'dist');
const SCANS_DIR = path.join(DATA_DIR, 'scans');

// ── Middleware ────────────────────────────────────────────────
app.use(cors());                     // Allow all origins (local network)
app.use(express.json());

// ── API Routes ───────────────────────────────────────────────

// Health check endpoint (used by Electron to know server is ready)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: require('../package.json').version, 
    uptime: process.uptime(), 
    ts: Date.now() 
  });
});

app.use('/api/scan', scanRoutes);
app.use('/api/battery', batteryRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/fleet', fleetRoutes);

app.get('/api/ai/readiness', async (req, res) => {
  try {
    const data = await aiReadiness.getAIReadiness();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to access AI readiness' });
  }
});

// AI ERA FEATURES
app.get('/api/ai/sessions', (req, res) => {
  res.json({
    active: aiMonitor.getActiveSession(),
    history: aiMonitor.getSessions()
  });
});

app.get('/api/ai/ram-calculator', async (req, res) => {
  try {
    const mem = await si.mem();
    const totalRAM = mem.total / (1024 * 1024 * 1024);
    const usedRAM = mem.used / (1024 * 1024 * 1024);
    const freeRAM = mem.free / (1024 * 1024 * 1024);
    const aiHeadroom = freeRAM;

    const models = [
      { name: "Phi-3 Mini (3.8B)", ramNeeded: 3.5 },
      { name: "Llama 3.2 3B", ramNeeded: 3.0 },
      { name: "Mistral 7B Q4", ramNeeded: 5.0 },
      { name: "Llama 3.1 8B Q4", ramNeeded: 6.5 }
    ];

    const recommendations = models.map(m => {
      let fitType = "impossible";
      let performance = "cannot run";
      let fits = false;

      if (aiHeadroom >= m.ramNeeded * 1.3) {
        fitType = "comfortable"; fits = true; performance = "fast";
      } else if (aiHeadroom >= m.ramNeeded) {
        fitType = "tight"; fits = true; performance = "fast";
      } else if (aiHeadroom >= m.ramNeeded * 0.7) {
        fitType = "needs_close_apps"; fits = false; performance = "slow — would swap to disk";
      }

      return { ...m, fits, fitType, performance };
    });

    res.json({ totalRAM, usedRAM, freeRAM, aiHeadroom, recommendations });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DEEP SYSTEM INTEGRATION
app.get('/api/battery/deep', async (req, res) => {
  const { getBatteryDeepCached } = require('./batteryDeep');
  res.json(await getBatteryDeepCached());
});

app.get('/api/throttle/realtime', async (req, res) => {
  const { getThrottleData } = require('./typeperfSampler');
  res.json(await getThrottleData());
});

app.get('/api/gpu', async (req, res) => {
  const { getGpuData } = require('./gpuMonitor');
  res.json(await getGpuData());
});

// POWER TRACKING
app.get('/api/power/stats', (req, res) => {
  res.json(powerTracker.getStats());
});

app.post('/api/power/set-tariff', (req, res) => {
  const { ratePerKwh, currency } = req.body;
  powerTracker.setTariff(ratePerKwh, currency);
  res.json({ success: true, stats: powerTracker.getStats() });
});

// Battery Intelligence v2 routes
app.get('/api/battery/intelligence', async (req, res) => {
  try {
    const latest = await require('systeminformation').battery();
    const intel = sohModel.computeIntelligence(latest);
    const userHabits = habits.aggregateHabits();
    const cycles = db.getCycleCount();

    res.json({
      ...intel,
      habits: userHabits,
      cycleStats: {
        estimatedFullCycles: Math.round(cycles * 10) / 10,
        last7DaysCycles: 0.5 // TODO: implement daily cycle aggregation
      },
      sampler: {
        isRunning: sampler.isRunning(),
        sampleCount: db.getBatterySamples(1).length > 0 ? 'Data Available' : 'Starting...'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/battery/samples', async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 60;
  const samples = db.getBatterySamples(limit);
  res.json(samples.reverse()); // Chronological for Recharts
});

// QR code endpoint — returns the network URL as a data-URI PNG
app.get('/api/network-qr', async (req, res) => {
  try {
    const QRCode = require('qrcode');
    const ip = getLocalIP();
    if (!ip) return res.status(404).json({ error: 'No network IP found' });
    const url = `http://${ip}:${PORT}`;
    const dataUri = await QRCode.toDataURL(url, { width: 256, margin: 1, color: { dark: '#ffffff', light: '#00000000' } });
    res.json({ url, qr: dataUri });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CPU Throttle Radar routes ────────────────────────────────
app.get('/api/cpu/throttle/status', async (req, res) => {
  try {
    const status = throttleEngine.getCurrentThrottleStatus();

    // Get top 5 CPU-hogging processes
    let topProcesses = [];
    try {
      const procs = await si.processes();
      if (procs && procs.list) {
        topProcesses = procs.list
          .filter(p => p.cpu > 0.5 && p.name.toLowerCase() !== 'system idle process')
          .sort((a, b) => b.cpu - a.cpu)
          .slice(0, 5)
          .map(p => ({
            name: p.name,
            pid: p.pid,
            cpuPct: Math.round(p.cpu * 10) / 10,
            memPct: Math.round(p.mem * 10) / 10,
            isBackground: !['explorer.exe', 'chrome.exe', 'firefox.exe', 'msedge.exe',
              'code.exe', 'devenv.exe', 'slack.exe', 'discord.exe', 'spotify.exe',
              'teams.exe', 'brave.exe', 'opera.exe', 'notepad.exe', 'winword.exe',
              'excel.exe', 'powerpnt.exe'].includes(p.name.toLowerCase()),
          }));
      }
    } catch (e) { /* ignore process fetch errors */ }

    res.json({ ...status, topProcesses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cpu/throttle/history', (req, res) => {
  const minutes = Math.min(parseInt(req.query.minutes, 10) || 60, 1440);
  res.json(throttleEngine.getThrottleHistory(minutes));
});

app.get('/api/cpu/throttle/events', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 10;
  res.json(throttleEngine.getThrottleEvents(limit));
});

app.get('/api/cpu/throttle/summary', (req, res) => {
  res.json(throttleEngine.getThrottleSummary());
});

// ── Process Kill endpoint ────────────────────────────────────
const PROTECTED_PROCESSES = [
  'system', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe',
  'services.exe', 'lsass.exe', 'svchost.exe', 'explorer.exe',
  'node.exe', 'npm.exe', 'cmd.exe', 'powershell.exe', 'conhost.exe',
  'dwm.exe', 'taskmgr.exe', 'wudfhost.exe', 'fontdrvhost.exe',
];

app.post('/api/process/kill', (req, res) => {
  const { pid, name } = req.body;
  if (!pid || !name) {
    return res.status(400).json({ error: 'pid and name are required' });
  }

  if (PROTECTED_PROCESSES.includes(name.toLowerCase())) {
    return res.status(403).json({ error: 'Protected system process — cannot kill' });
  }

  try {
    process.kill(pid);
    res.json({ success: true, killed: name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Disk SMART route ──────────────────────────────────────
app.get('/api/disk/smart', async (req, res) => {
  try {
    const result = await smartCollector.getAllDisksSmart();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Settings routes ───────────────────────────────────────
app.get('/api/settings', (req, res) => {
  res.json(settingsManager.getSettings());
});

app.post('/api/settings', (req, res) => {
  const success = settingsManager.saveSettings(req.body);
  res.json({ success });
});

app.post('/api/settings/:section', (req, res) => {
  const success = settingsManager.updateSection(req.params.section, req.body);
  res.json({ success });
});

// ── Fleet routes (Discovery Engine) ────────────────────────
app.get('/api/fleet/peers', (req, res) => {
  res.json({
    peers: fleet.getPeers(),
    count: fleet.getPeers().length,
    onlineCount: fleet.getPeers().filter(p => p.online).length
  });
});

app.get('/api/fleet/peers/:ip', async (req, res) => {
  const ip = req.params.ip;
  const peer = fleet.getPeer(ip);
  if (!peer) return res.status(404).json({ error: 'Peer not found' });
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`http://${peer.ip}:${peer.port}/api/scan/latest`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error('Peer scan failed');
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch peer data' });
  }
});

// Original database-backed device routes (kept for compatibility)
app.get('/api/devices', (req, res) => {
  try {
    const devices = db.getAllDevices();
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/devices/:id/summary', async (req, res) => {
  const { id } = req.params;
  try {
    const myId = fleet.getDeviceId();
    if (id === myId) {
      // Local device - return info directly from local DB
      const latest = db.getScanHistory(1)[0];
      if (!latest) return res.status(404).json({ error: 'No scan yet' });
      return res.json(JSON.parse(latest.raw_json));
    } else {
      // Other device - proxy the request
      const devices = db.getAllDevices();
      const target = devices.find(d => d.device_id === id);
      if (!target || !target.ip_address) return res.status(404).json({ error: 'Device not found' });

      // Proxy request to the peer's /api/scan/latest
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`http://${target.ip_address}:${PORT}/api/scan/latest`, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error('Peer responded with error');
      const data = await response.json();
      res.json(data);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  try {
    const latest = db.getScanHistory(1)[0];
    const score = latest ? latest.score_total : null;
    res.json({
      deviceId: fleet.getDeviceId(),
      hostname: require('os').hostname(),
      score,
      status: 'online'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Alert endpoints ──────────────────────────────────────────
app.get('/api/alerts/active', (req, res) => {
  res.json({ alerts: alertEngine.getActiveAlerts() });
});

app.post('/api/alerts/:id/dismiss', (req, res) => {
  alertEngine.dismissAlert(req.params.id);
  res.json({ success: true });
});

// ── RAM Processes endpoint ───────────────────────────────────
app.get('/api/ram/processes', async (req, res) => {
  try {
    const procs = await si.processes();
    const SYSTEM_PROCS = ['system','smss.exe','csrss.exe','wininit.exe','winlogon.exe','services.exe','lsass.exe','svchost.exe','explorer.exe','dwm.exe'];
    const top = procs.list
      .filter(p => p.memRss > 20 * 1024 * 1024)
      .sort((a, b) => b.memRss - a.memRss)
      .slice(0, 10)
      .map(p => ({
        pid: p.pid,
        name: p.name,
        memMB: Math.round(p.memRss / 1024 / 1024),
        memPct: Number(p.mem.toFixed(1)),
        cpuPct: Number(p.cpu.toFixed(1)),
        isSystem: SYSTEM_PROCS.includes(p.name.toLowerCase())
      }));
    res.json(top);
  } catch (err) {
    res.json([]);
  }
});

// ── Scheduler endpoints ──────────────────────────────────────
app.get('/api/scheduler/status', (req, res) => {
  const now = Date.now();
  let nextScanIn = null;
  if (schedulerEnabled && lastAutoScanTs) {
    nextScanIn = Math.max(0, schedulerIntervalMs - (now - lastAutoScanTs));
  }
  res.json({ enabled: schedulerEnabled, intervalMs: schedulerIntervalMs, nextScanIn });
});

app.post('/api/scheduler/enable', (req, res) => {
  const mins = req.body.intervalMinutes || 60;
  schedulerIntervalMs = mins * 60 * 1000;
  if (schedulerTimer) clearInterval(schedulerTimer);
  lastAutoScanTs = Date.now();
  schedulerTimer = setInterval(async () => {
    console.log('[Scheduler] Auto-scan triggered');
    try {
      const scanData = await runScan();
      const result = ingest(scanData);
      alertEngine.checkAlerts(scanData);
      lastAutoScanTs = Date.now();
    } catch (e) { console.error('[Scheduler] Scan failed:', e.message); }
  }, schedulerIntervalMs);
  schedulerEnabled = true;
  console.log(`[Scheduler] Enabled — every ${mins} minutes`);
  res.json({ enabled: true, intervalMs: schedulerIntervalMs });
});

app.post('/api/scheduler/disable', (req, res) => {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerEnabled = false;
  console.log('[Scheduler] Disabled');
  res.json({ enabled: false });
});

app.get('/api/score/history', (req, res) => {
  try {
    const historyPath = path.join(__dirname, '..', 'data', 'score_history.json');
    if (fs.existsSync(historyPath)) {
      const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      res.json({ history });
    } else {
      res.json({ history: [] });
    }
  } catch (e) {
    res.json({ history: [] });
  }
});

app.get('/api/startup/items', (req, res) => {
  const { execSync } = require('child_process');
  try {
    const raw = execSync(`powershell -Command "Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location | ConvertTo-Json"`, { timeout: 5000 }).toString();
    const parsed = raw ? JSON.parse(raw) : [];
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const classifyImpact = (path) => {
      const p = (path || '').toLowerCase();
      if (['teams', 'spotify', 'discord', 'onedrive', 'adobe', 'zoom', 'slack', 'steam'].some(x => p.includes(x))) return 'high';
      if (['helper', 'update', 'manager'].some(x => p.includes(x))) return 'medium';
      return 'low';
    };
    const isSystemProcess = (name) => ['Windows Security', 'ctfmon', 'SecurityHealth'].includes(name);

    const result = items.filter(x => x && x.Name).map(item => ({
      name: item.Name,
      path: item.Command || '',
      location: item.Location || '',
      impact: classifyImpact(item.Command),
      canDisable: !isSystemProcess(item.Name)
    }));
    res.json(result);
  } catch (e) {
    res.json([]);
  }
});

app.get('/api/export/report', (req, res) => {
  try {
    const latest = db.getLatestScan();
    const scanData = latest ? JSON.parse(latest.raw_json) : {};
    
    const historyPath = path.join(__dirname, '..', 'data', 'score_history.json');
    let history = [];
    if (fs.existsSync(historyPath)) {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    }
    
    let startup = [];
    try {
      const { execSync } = require('child_process');
      const raw = execSync(`powershell -Command "Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location | ConvertTo-Json"`, { timeout: 5000 }).toString();
      const parsed = raw ? JSON.parse(raw) : [];
      const items = Array.isArray(parsed) ? parsed : [parsed];
      startup = items.filter(x => x && x.Name);
    } catch(e) {}

    const reportData = {
      timestamp: new Date().toISOString(),
      deviceModel: scanData.metadata?.Model,
      osVersion: scanData.metadata?.OSVersion,
      scanLatest: scanData,
      scoreHistory: history.slice(-7),
      startupItems: startup
    };

    res.setHeader('Content-Disposition', `attachment; filename="lapscore-${Date.now()}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(reportData, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Report routes ──────────────────────────────────────────
app.post('/api/report/generate', async (req, res) => {
  try {
    const filename = `LapScore-Report-${new Date().toISOString().split('T')[0]}_${Date.now()}.pdf`;
    const deviceId = fleet.getDeviceId();
    
    const result = await reportGenerator.generateReport({
      deviceId,
      filename,
      includeHistory: true
    });

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      success: true,
      filename: result.filename,
      downloadUrl: `/api/report/download/${result.filename}`,
      sizeBytes: result.sizeBytes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/report/download/:filename', (req, res) => {
  const { filename } = req.params;
  
  // Prevent directory traversal attacks
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const reportsDir = path.join(__dirname, '..', 'data', 'reports');
  const filepath = path.join(reportsDir, filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Report not found' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const fileStream = fs.createReadStream(filepath);
  fileStream.pipe(res);
});

app.get('/api/report/list', (req, res) => {
  try {
    const reportsDir = path.join(__dirname, '..', 'data', 'reports');
    if (!fs.existsSync(reportsDir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.pdf'));
    const reports = files.map(filename => {
      const stats = fs.statSync(path.join(reportsDir, filename));
      return {
        filename,
        timestamp: stats.mtimeMs,
        sizeBytes: stats.size
      };
    });

    // Sort by newest first, return top 10
    reports.sort((a, b) => b.timestamp - a.timestamp);
    res.json(reports.slice(0, 10));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Static file serving ──────────────────────────────────────
app.use(express.static(DIST_DIR));
app.use((req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// ── Startup ──────────────────────────────────────────────────
async function startServer() {
  db.initDb();

  if (!fs.existsSync(SCANS_DIR)) {
    fs.mkdirSync(SCANS_DIR, { recursive: true });
  }

  let scanData = null;
  console.log("Running initial scan...");
  try {
    scanData = await runScan();
    ingest(scanData);
    alertEngine.checkAlerts(scanData);
    console.log("Scan complete.");
  } catch (err) {
    console.error("Initial scan failed:", err.message);
  }

  // Start background samplers
  sampler.start();
  cpuSampler.start();

  // Run initial disk SMART scan
  try {
    const smartResult = await smartCollector.getAllDisksSmart();
    const now = Date.now();
    for (const d of smartResult.drives) {
      db.insertDiskSnapshot({
        timestamp: now,
        device_name: d.model || d.name || 'Unknown',
        serial_number: d.serial || null,
        lifespan_pct: d.lifespanPct,
        pct_used: d.pctUsed,
        available_spare: d.availableSpare,
        media_errors: d.mediaErrors || 0,
        reallocated: d.reallocatedSectors || 0,
        temp_c: d.tempC,
        risk_level: d.riskLevel,
        smart_passed: d.smartPassed ? 1 : 0,
        raw_json: JSON.stringify(d),
      });
    }
    console.log(`[SMART] Scanned ${smartResult.drives.length} drive(s) via ${smartResult.source}`);
  } catch (err) {
    console.warn('[SMART] Startup scan failed:', err.message);
  }

  // Daily cleanup cron (runs every 24h)
  setInterval(() => {
    console.log('[Cron] Running daily cleanup...');
    db.pruneBatterySamples(30);
    db.pruneCpuSamples(7);
    db.pruneThrottleEvents(30);
    db.pruneDiskSnapshots(90);
  }, 24 * 60 * 60 * 1000);

  // Start Fleet local discovery engine
  fleet.startListener();
  if (scanData) {
    fleet.startBroadcast(scanData);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    const pkg = require('../package.json');
    const localIP = getLocalIP();
    console.log('');
    console.log('  ██╗      █████╗ ██████╗ ███████╗');
    console.log('  ██║     ██╔══██╗██╔══██╗██╔════╝');
    console.log('  ██║     ███████║██████╔╝███████╗');
    console.log('  ██║     ██╔══██║██╔═══╝ ╚════██║');
    console.log('  ███████╗██║  ██║██║     ███████║');
    console.log('  ╚══════╝╚═╝  ╚═╝╚═╝     ╚══════╝');
    console.log('');
    console.log(`  PC Health Monitor v${pkg.version}`);
    console.log('  ─────────────────────────────────');
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  Network: http://${localIP}:${PORT}`);
    console.log('');
    console.log('  Press Ctrl+C to stop');
    console.log('');

    const isElectron = !!process.versions['electron'];
    if (!isElectron && process.env.AUTO_OPEN !== 'false') {
      console.log('  ✓ LapScore is running');
      console.log(`  → Open in browser: http://localhost:${PORT}\n`);
    }
  });

  liveStream.start(server);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server] Port ${PORT} already in use. Shutting down...`);
      process.exit(1);
    }
  });
}

if (require.main === module) {
  startServer();
}

process.on('SIGINT', () => {
  console.log('\n  Shutting down LapScore...');
  
  sampler.stop();
  cpuSampler.stop();
  liveStream.stop();
  if (typeof fleet !== 'undefined' && fleet.stopListener) {
    fleet.stopListener();
  }

  // Close SQLite database cleanly
  try {
    const { getDb } = require('./db');
    const db = getDb();
    if (db) {
      db.close();
      console.log('  ✓ Database closed');
    }
  } catch (e) {
    // Already closed or not initialized
  }

  console.log('  ✓ Goodbye\n');
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.emit('SIGINT');
});

module.exports = { app };
