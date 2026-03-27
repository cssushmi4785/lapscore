const si = require('systeminformation');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getBatteryDeepCached } = require('./batteryDeep');
const { getGpuData } = require('./gpuMonitor');

async function safeFetch(promiseFn, fallback = null) {
  try {
    return await promiseFn();
  } catch (err) {
    console.warn(`Collection warning: ${err.message}`);
    return fallback;
  }
}

async function collect() {
  const scanData = {
    scanId: crypto.randomUUID(),
    timestamp: new Date().toISOString()
  };

  // BATTERY
  const batteryInfo = await safeFetch(() => si.battery(), {});
  const deepBattery = await getBatteryDeepCached();
  
  // Calculate Cycle Count via CycleCounter if available
  let estimatedCycles = 0;
  try {
    const cycleCounter = require('./cycleCounter');
    estimatedCycles = cycleCounter.getCycleCount();
  } catch (e) { /* ignore */ }

  // Use powercfg/wmic if available, else fallback to si/cycleCounter
  const finalCycles = deepBattery.cycleCount ?? (estimatedCycles > 0 ? estimatedCycles : (batteryInfo.cycleCount || 0));
  const cycleMethod = deepBattery.source || (estimatedCycles > 0 ? 'sampled' : 'reported');

  const deriveBatteryCycleIntel = (battery) => {
    const cycles    = battery?.cycleCount ?? 0;
    const chemistry = (battery?.chemistry || battery?.type || 'Li-ion').trim() || 'Li-ion';

    // Design life varies by chemistry
    const designLife = (() => {
      const lowerChem = chemistry?.toLowerCase();
      if (lowerChem?.includes('nimh')) return 500;
      if (lowerChem?.includes('lifepo')) return 2000;
      return 1000; // Li-Ion default
    })();

    const pctUsed = Math.round((cycles / designLife) * 100);
    const remaining = Math.max(0, designLife - cycles);

    // Zone classification
    const zone = (() => {
      const r = remaining / designLife;
      if (r > 0.80) return { label: 'PRIME', color: '#22c55e', status: 'good', desc: 'Battery is like new. No action needed.' };
      if (r > 0.60) return { label: 'HEALTHY', color: '#22c55e', status: 'good', desc: 'Excellent condition. Normal usage pattern.' };
      if (r > 0.40) return { label: 'MODERATE', color: '#f59e0b', status: 'warning', desc: 'Normal wear. Consider calibrating annually.' };
      if (r > 0.20) return { label: 'AGING', color: '#f97316', status: 'warning', desc: 'Significant wear. Start planning replacement.' };
      if (r > 0.05) return { label: 'DEGRADED', color: '#ef4444', status: 'critical', desc: 'Battery near end of rated life. Replace soon.' };
      return { label: 'CRITICAL', color: '#ef4444', status: 'critical', desc: 'Battery exceeds rated design life. Replace now.' };
    })();

    const avgDailyCycles = 0.8;
    const daysRemaining  = Math.round(remaining / avgDailyCycles);
    const yearsRemaining = (daysRemaining / 365).toFixed(1);

    return {
      cycleCount: cycles,
      designLife: designLife,
      cyclesRemaining: remaining,
      cyclesUsedPct: pctUsed,
      chemistry: chemistry,
      zone: zone,
      estimatedLifeRemainingDays: daysRemaining,
      estimatedLifeRemainingYears: yearsRemaining,
      ranges: [
        { label: 'Prime', from: 0, to: Math.round(designLife * 0.20), color: '#22c55e' },
        { label: 'Healthy', from: Math.round(designLife * 0.20), to: Math.round(designLife * 0.40), color: '#22c55e' },
        { label: 'Moderate', from: Math.round(designLife * 0.40), to: Math.round(designLife * 0.60), color: '#f59e0b' },
        { label: 'Aging', from: Math.round(designLife * 0.60), to: Math.round(designLife * 0.80), color: '#f97316' },
        { label: 'Degraded', from: Math.round(designLife * 0.80), to: Math.round(designLife * 0.95), color: '#ef4444' },
        { label: 'Critical', from: Math.round(designLife * 0.95), to: designLife, color: '#dc2626' }
      ]
    };
  };

  scanData.battery = {
    FullChargeCapacity: batteryInfo.maxCapacity || null,
    DesignCapacity: batteryInfo.designedCapacity || null,
    CycleCount: finalCycles,
    CycleCountMethod: cycleMethod,
    EstimatedRunTime: batteryInfo.timeRemaining || null,
    hasBattery: batteryInfo.hasBattery,
    percent: batteryInfo.percent,
    isCharging: batteryInfo.isCharging,
    manufacturer: deepBattery.manufacturer || batteryInfo.manufacturer,
    model: batteryInfo.model,
    chemistry: deepBattery.chemistry || batteryInfo.type || 'Li-ion',
    serialNumber: deepBattery.serialNumber || batteryInfo.serial,
    dataSource: deepBattery.source || 'si',
    // WMIC real-time status
    chargePercent: deepBattery.chargePercent ?? batteryInfo.percent,
    estimatedRunMin: deepBattery.estimatedRunMin ?? batteryInfo.timeRemaining,
    chargingStatus: deepBattery.chargingStatus || (batteryInfo.isCharging ? 'Charging' : 'Discharging'),
    cycleIntel: deriveBatteryCycleIntel({ 
      ...batteryInfo, 
      chemistry: deepBattery.chemistry || batteryInfo.type, 
      cycleCount: finalCycles,
      designLife: deepBattery.designLife
    })
  };
  if (batteryInfo.designedCapacity && batteryInfo.maxCapacity) {
    scanData.battery.wearPercent = ((batteryInfo.designedCapacity - batteryInfo.maxCapacity) / batteryInfo.designedCapacity) * 100;
  }

  // CPU — enriched with live speed + temperature
  const cpuInfo = await safeFetch(() => si.cpu(), {});
  const cpuSpeed = await safeFetch(() => si.cpuCurrentSpeed(), {});
  const currentLoad = await safeFetch(() => si.currentLoad(), {});
  const cpuTemp = await safeFetch(() => si.cpuTemperature(), {});
  scanData.cpu = {
    // Legacy keys (used by scorer/recommendations)
    LoadPercentage: currentLoad.currentLoad || 0,
    Name: cpuInfo.brand || cpuInfo.manufacturer || "Unknown CPU",
    NumberOfCores: cpuInfo.physicalCores || cpuInfo.cores || 1,
    NumberOfLogicalProcessors: cpuInfo.cores || 1,
    MaxClockSpeed: cpuInfo.speedMax ? Math.round(cpuInfo.speedMax * 1000) : (cpuInfo.speed ? Math.round(cpuInfo.speed * 1000) : null),
    CurrentClockSpeed: cpuSpeed.avg ? Math.round(cpuSpeed.avg * 1000) : (cpuInfo.speed ? Math.round(cpuInfo.speed * 1000) : null),
    // New enriched keys
    manufacturer: cpuInfo.manufacturer || null,
    brand: cpuInfo.brand || cpuInfo.manufacturer || "Unknown CPU",
    speed: cpuInfo.speed || null,
    speedMax: cpuInfo.speedMax || null,
    cores: cpuInfo.cores || 1,
    physicalCores: cpuInfo.physicalCores || cpuInfo.cores || 1,
    currentSpeedGHz: cpuSpeed.avg || cpuInfo.speed || null,
    perCoreSpeedGHz: cpuSpeed.cores || [],
    currentLoadPct: currentLoad.currentLoad || null,
    perCoreLoadPct: currentLoad.cpus ? currentLoad.cpus.map(c => c.load) : [],
    tempMain: cpuTemp.main || null,
    tempCores: cpuTemp.cores || [],
    tempMax: cpuTemp.max || null
  };

  // RAM
  const memInfo = await safeFetch(() => si.mem(), {});
  scanData.ram = {
    // Convert to KB to match legacy WMI metric
    TotalVisibleMemorySize: memInfo.total ? Math.round(memInfo.total / 1024) : null,
    FreePhysicalMemory: memInfo.free ? Math.round(memInfo.free / 1024) : null,
    // Add raw for UI
    totalBytes: memInfo.total,
    freeBytes: memInfo.free,
    usedBytes: memInfo.used,
    activeBytes: memInfo.active
  };

  // DISKS
  const diskLayout = await safeFetch(() => si.diskLayout(), []);
  const fsSize = await safeFetch(() => si.fsSize(), []);
  const deriveHealthScore = (disk) => {
    if (disk.smartStatus === 'Ok') return 100;
    if (disk.smartStatus === 'Caution') return 65;
    if (disk.smartStatus === 'Bad') return 20;
    return null;
  };

  scanData.disks = {
    Physical: diskLayout.map(d => ({
      FriendlyName: d.name,
      HealthStatus: String(d.smartStatus).toLowerCase() === 'ok' ? 'Healthy' : 'Unknown',
      OperationalStatus: 'OK',
      Size: d.size,
      vendor: d.vendor,
      type: d.type,
      temperature: d.temperature ?? null,
      smartStatus: d.smartStatus ?? 'unknown',
      healthScore: deriveHealthScore(d)
    })),
    Logical: fsSize.map(d => ({
      DeviceID: d.use ? d.fs : d.mount, // use mount point if preferred
      Size: d.size,
      FreeSpace: d.available || d.size - d.used,
      Type: d.type
    }))
  };

  const diskIO = await safeFetch(() => si.disksIO(), null);
  if (diskIO && diskIO.rIO_sec >= 0) {
    scanData.disks.readMBs = (diskIO.rIO_sec * 512 / 1e6).toFixed(1);
    scanData.disks.writeMBs = (diskIO.wIO_sec * 512 / 1e6).toFixed(1);
  } else {
    scanData.disks.readMBs = null;
    scanData.disks.writeMBs = null;
  }

  // NETWORK
  const netStats = await safeFetch(() => si.networkStats(), []);
  const primaryNet = netStats.find(n => n.operstate === 'up' && n.rx_sec > 0) || netStats[0];
  let ssid = null;
  if (primaryNet && primaryNet.type === 'wireless') {
    const wifiData = await safeFetch(() => si.wifiNetworks(), []);
    ssid = wifiData.length > 0 ? wifiData[0].ssid : null;
  }
  
  if (primaryNet) {
    scanData.network = {
      rxMBs: typeof primaryNet?.rx_sec === 'number'
        ? Math.round(primaryNet.rx_sec / 1e6 * 100) / 100
        : null,
      txMBs: typeof primaryNet?.tx_sec === 'number'
        ? Math.round(primaryNet.tx_sec / 1e6 * 100) / 100
        : null,
      interface: primaryNet.iface,
      type: primaryNet.type,
      ssid: ssid,
      speedMbps: primaryNet.speed
    };
  } else {
    scanData.network = null;
  }

  // GPU — enriched via nvidia-smi if available
  const gpuDeep = await getGpuData();
  const graphics = await safeFetch(() => si.graphics(), { controllers: [] });
  
  if (gpuDeep.present) {
    scanData.gpu = [{
      ...gpuDeep,
      // Keep legacy structure for compatibility if needed elsewhere
      Name: gpuDeep.name,
      AdapterRAM: gpuDeep.memTotalMB,
      Status: "OK"
    }];
  } else {
    const controllers = graphics.controllers.map(g => ({
      Name: g.model,
      ConfigManagerErrorCode: 0,
      Status: "OK",
      AdapterRAM: g.vram,
      driverVersion: g.driverVersion,
      vendor: g.vendor,
      present: false,
      reason: 'Standard detection'
    }));
    scanData.gpu = controllers.length > 0 ? controllers : [];
  }

  // SYSTEM / OS METADATA
  const osInfo = await safeFetch(() => si.osInfo(), {});
  const sysInfo = await safeFetch(() => si.system(), {});
  scanData.metadata = {
    Model: sysInfo.model || "Unknown computer",
    OSVersion: `${osInfo.distro} ${osInfo.release}` || "Unknown OS"
  };

  // PROCESSES (Power Blockers Alternative)
  const processes = await safeFetch(() => si.processes(), { list: [] });
  const heavyProcesses = processes.list
    .filter(p => p.cpu > 5 && p.name.toLowerCase() !== 'system idle process')
    .map(p => p.name);
  scanData.powerRequests = {
    EXECUTION: heavyProcesses
  };

  // BROKEN DRIVERS (Hard to get without WMI, passing empty to avoid errors)
  scanData.brokenDrivers = [];
  
  // THERMALS
  const thermals = await safeFetch(() => si.cpuTemperature(), {});
  scanData.thermals = thermals.main ? thermals.main : null;
  scanData.fans = thermals.socket || [];

  return scanData;
}

async function runScan() {
  const dataDir = process.env.LAPSCORE_DATA_DIR || path.join(__dirname, '..', 'data');
  const scansDir = path.join(dataDir, 'scans');
  
  if (!fs.existsSync(scansDir)) {
    fs.mkdirSync(scansDir, { recursive: true });
  }

  const scanData = await collect();
  const latestPath = path.join(scansDir, 'scan_latest.json');
  const historyPath = path.join(scansDir, `scan_${Date.now()}.json`);

  const jsonStr = JSON.stringify(scanData, null, 2);
  fs.writeFileSync(latestPath, jsonStr, 'utf-8');
  fs.writeFileSync(historyPath, jsonStr, 'utf-8');

  return scanData;
}

module.exports = { collect, runScan };
