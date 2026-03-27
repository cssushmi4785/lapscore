const { exec } = require('child_process');

/**
 * sampleCounter
 * Executes typeperf for one sample and one counter
 */
const sampleCounter = (counterPath) => {
  return new Promise((resolve, reject) => {
    // typeperf -sc 1 takes exactly 1 sample
    const cmd = `typeperf "${counterPath}" -sc 1`;
    
    exec(cmd, { timeout: 5000 }, (err, stdout) => {
      if (err) { reject(err); return; }
      
      const lines = stdout.trim().split('\n');
      const dataLine = lines.find(l => l.match(/^\"\d{2}\/\d{2}\/\d{4}/));
      
      if (!dataLine) { reject(new Error('No data detected in typeperf output')); return; }
      
      const parts = dataLine.split(',');
      const valStr = parts[1]?.replace(/"/g, '');
      const value = parseFloat(valStr);
      
      resolve(isNaN(value) ? null : value);
    });
  });
};

/**
 * getThrottleData
 * Main entry point for real-time CPU performance monitoring
 */
const getThrottleData = async () => {
  try {
    const [perfPct, freqPct, coreTemp] = await Promise.all([
      // % Processor Performance = current speed relative to max
      sampleCounter('\\Processor Information(_Total)\\% Processor Performance'),
      
      // % of Maximum Frequency = current frequency relative to rated
      sampleCounter('\\Processor Information(_Total)\\% of Maximum Frequency'),
      
      // Attempt to get thermal zone temperature (if available)
      sampleCounter('\\Thermal Zone Information(_Total)\\Temperature').catch(() => null)
    ]);
    
    // Performance Pct < 95 means Windows is actively pulling back
    const isThrottled = perfPct !== null && perfPct < 95;
    const throttleDepth = isThrottled ? Math.round(100 - perfPct) : 0;
    
    return {
      processorPerformancePct: Math.round(perfPct),
      processorFrequencyPct: Math.round(freqPct),
      isThrottled,
      throttleDepth, 
      thermalTemp: coreTemp ? Math.round(coreTemp - 273.15) : null,
      source: 'typeperf',
      ts: Date.now()
    };
    
  } catch (err) {
    console.warn('[Throttle] typeperf collection failed:', err.message);
    return { source: 'fallback', error: err.message };
  }
};

module.exports = { getThrottleData };
