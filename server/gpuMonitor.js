const { exec } = require('child_process');

/**
 * getNvidiaSmiData
 * Uses NVIDIA Management Library CLI (nvidia-smi) for detailed GPU telemetry 
 */
const getNvidiaSmiData = () => {
  return new Promise((resolve) => {
    // Query exact CSV fields for speed
    const cmd = [
      'nvidia-smi',
      '--query-gpu=',
      'name,',
      'temperature.gpu,',
      'utilization.gpu,',
      'utilization.memory,',
      'memory.total,',
      'memory.used,',
      'memory.free,',
      'power.draw,',
      'power.limit,',
      'clocks.current.graphics,',
      'clocks.max.graphics,',
      'fan.speed', 
      '--format=csv,noheader,nounits'
    ].join('');
    
    // Note: Since individual elements above conclude with or without spaces, 
    // and we need precise command construction, I'll ensure spaces here:
    const cmdFixed = [
      'nvidia-smi',
      '--query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,memory.total,memory.used,memory.free,power.draw,power.limit,clocks.current.graphics,clocks.max.graphics,fan.speed',
      '--format=csv,noheader,nounits'
    ].join(' ');

    exec(cmdFixed, { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) {
        resolve({ present: false, reason: 'NVIDIA GPU not detected' });
        return;
      }
      
      const lines = stdout.trim().split('\n');
      const parts = lines[0].split(/,\s*/).map(p => p.trim());
      
      if (parts.length < 8) {
        resolve({ present: false, reason: 'Invalid nvidia-smi output' });
        return;
      }

      const parseVal = (v) => v === '[N/A]' ? null : parseFloat(v);
      
      const data = {
        present: true,
        vendor: 'NVIDIA',
        name: parts[0],
        tempC: parseVal(parts[1]),
        gpuUtilPct: parseVal(parts[2]),
        memUtilPct: parseVal(parts[3]),
        memTotalMB: parseVal(parts[4]) || 0,
        memUsedMB: parseVal(parts[5]) || 0,
        memFreeMB: parseVal(parts[6]) || 0,
        powerDrawW: parseVal(parts[7]),
        powerLimitW: parseVal(parts[8]),
        clockMHz: parseVal(parts[9]),
        clockMaxMHz: parseVal(parts[10]),
        fanSpeedPct: parseVal(parts[11]),
        source: 'nvidia-smi'
      };

      // Derived:
      if (data.memTotalMB > 0) {
        data.memUsedPct = Math.round((data.memUsedMB / data.memTotalMB) * 100);
      }
      if (data.powerDrawW && data.powerLimitW) {
        data.powerEfficiency = Math.round((data.powerDrawW / data.powerLimitW) * 100);
      }

      resolve(data);
    });
  });
};

/**
 * getGenericGpuData (AMD/Intel)
 * Generic fallback via wmic as last resort
 */
const getGenericGpuData = () => {
  return new Promise((resolve) => {
    exec(
      'wmic path Win32_VideoController get Name,AdapterRAM,CurrentRefreshRate /format:csv',
      { timeout: 3000 },
      (err, stdout) => {
        if (err) { resolve({ present: false }); return; }
        const lines = stdout.trim().split('\n').filter(l => l.includes(','));
        if (lines.length < 2) { resolve({ present: false }); return; }
        const parts = lines[1].split(',');
        resolve({
          present: true,
          vendor: 'Generic',
          name: parts[3]?.trim(),
          ramMB: Math.round(parseInt(parts[1]) / (1024 * 1024)),
          source: 'wmic'
        });
      }
    );
  });
};

/**
 * getGpuData
 * Hub for deep GPU monitoring integration
 */
const getGpuData = async () => {
  const nvidia = await getNvidiaSmiData();
  if (nvidia.present) return nvidia;
  
  const generic = await getGenericGpuData();
  if (generic.present) return generic;
  
  return { present: false, reason: 'No discrete GPU detected' };
};

module.exports = { getGpuData, getNvidiaSmiData, getGenericGpuData };
