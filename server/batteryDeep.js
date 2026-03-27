const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * getBatteryDeepData
 * Uses powercfg /batteryreport to get the real cycle count and capacity 
 * directly from battery firmware.
 */
const getBatteryDeepData = async () => {
  try {
    const reportPath = path.join(os.tmpdir(), `lapscore-battery-${Date.now()}.xml`);
    
    // Generate battery report in XML format
    execSync(`powercfg /batteryreport /xml /output "${reportPath}"`, { 
      stdio: 'ignore', 
      timeout: 10000 
    });
    
    // Read the XML report
    const xml = fs.readFileSync(reportPath, 'utf8');
    
    // Extract info using regex (cleaner than full XML parser for simple fields)
    const cycleMatch = xml.match(/<CycleCount>(\d+)<\/CycleCount>/);
    const designMatch = xml.match(/<DesignCapacity>(\d+)<\/DesignCapacity>/);
    const fullMatch = xml.match(/<FullChargeCapacity>(\d+)<\/FullChargeCapacity>/);
    const chemMatch = xml.match(/<Chemistry>([^<]+)<\/Chemistry>/);
    const mfgMatch = xml.match(/<Manufacturer>([^<]+)<\/Manufacturer>/);
    const serialMatch = xml.match(/<SerialNumber>([^<]+)<\/SerialNumber>/);

    const cycleCount = cycleMatch ? parseInt(cycleMatch[1]) : null;
    const designCapacity = designMatch ? parseInt(designMatch[1]) : null;
    const fullCapacity = fullMatch ? parseInt(fullMatch[1]) : null;
    const chemistry = chemMatch ? chemMatch[1].trim() : 'LiI';
    const manufacturer = mfgMatch ? mfgMatch[1].trim() : null;
    const serialNumber = serialMatch ? serialMatch[1].trim() : null;

    // Calculate real wear level: wear = (design - full) / design * 100
    const wearPercent = (designCapacity && fullCapacity)
      ? Math.round(((designCapacity - fullCapacity) / designCapacity) * 100)
      : null;

    const chemMap = {
      'LiP': 'Li-Polymer',
      'LiI': 'Li-Ion',
      'NiMH': 'NiMH',
      'NiCd': 'NiCd',
      'LION': 'Li-Ion',
      'PbAc': 'Lead Acid'
    };

    const designLifeMap = {
      'LiP': 1000,
      'LiI': 1000,
      'LION': 1000,
      'NiMH': 500,
      'LiFePO4': 2000
    };

    const designLife = designLifeMap[chemistry] || 1000;

    // Cleanup temp file
    try { fs.unlinkSync(reportPath); } catch(e) {}

    // Get real-time status via WMIC as well
    const wmicData = await getBatteryWmic();

    return {
      cycleCount,
      designCapacity,
      fullCapacity,
      wearPercent,
      healthPercent: wearPercent !== null ? 100 - wearPercent : null,
      chemistry: chemMap[chemistry] || chemistry,
      chemistryCode: chemistry,
      designLife,
      manufacturer,
      serialNumber,
      ...wmicData,
      source: 'powercfg'
    };
    
  } catch (err) {
    console.warn('[Battery] Deep data collection failed:', err.message);
    const wmicFallback = await getBatteryWmic();
    return { 
      source: 'fallback', 
      error: err.message,
      ...wmicFallback
    };
  }
};

/**
 * getBatteryWmic
 * WMIC fallback for real-time charge and status
 */
const getBatteryWmic = () => {
  return new Promise((resolve) => {
    exec(
      'wmic path Win32_Battery get EstimatedChargeRemaining,EstimatedRunTime,BatteryStatus /format:csv',
      { timeout: 5000 },
      (err, stdout) => {
        if (err) { resolve({}); return; }
        
        const lines = stdout.trim().split('\n').filter(l => l.includes(','));
        if (lines.length < 2) { resolve({}); return; }
        
        const headers = lines[0].split(',').map(h => h.trim());
        const values = lines[1].split(',').map(v => v.trim());
        const row = {};
        headers.forEach((h, i) => row[h] = values[i]);

        const statusMap = {
          '1': 'Other', '2': 'Unknown', '3': 'Fully Charged', 
          '4': 'Low', '5': 'Critical', '6': 'Charging', 
          '7': 'Charging', '8': 'Charging', '9': 'Charging', 
          '10': 'Undefined', '11': 'Partially Charged'
        };
        
        resolve({
          chargePercent: parseInt(row['EstimatedChargeRemaining']),
          estimatedRunMin: parseInt(row['EstimatedRunTime']),
          chargingStatus: statusMap[row['BatteryStatus']] || 'Discharging'
        });
      }
    );
  });
};

// Simple caching logic to avoid heavy file ops on every pulse
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const getBatteryDeepCached = async () => {
  if (cache && (Date.now() - cacheTime < CACHE_TTL)) {
    return cache;
  }
  cache = await getBatteryDeepData();
  cacheTime = Date.now();
  return cache;
};

module.exports = { getBatteryDeepCached };
