const si = require('systeminformation');

const models = [
  {
    name: 'Phi-3 Mini (3.8B)',
    minRamGB: 4, minVramGB: 0, needsGPU: false,
    quality: 'Basic chat, good for simple tasks',
    size: '2.3 GB download'
  },
  {
    name: 'Llama 3.2 3B',
    minRamGB: 4, minVramGB: 0, needsGPU: false,
    quality: 'Fast, lightweight, runs on CPU',
    size: '2.0 GB download'
  },
  {
    name: 'Mistral 7B',
    minRamGB: 8, minVramGB: 4, needsGPU: false,
    quality: 'Strong reasoning, good for coding',
    size: '4.1 GB download'
  },
  {
    name: 'Llama 3.1 8B',
    minRamGB: 8, minVramGB: 0, needsGPU: false,
    quality: "Meta's flagship small model",
    size: '4.7 GB download'
  },
  {
    name: 'Gemma 2 9B',
    minRamGB: 10, minVramGB: 0, needsGPU: false,
    quality: "Google's best small model",
    size: '5.5 GB download'
  },
  {
    name: 'Llama 3.1 70B (Q4)',
    minRamGB: 40, minVramGB: 0, needsGPU: false,
    quality: 'Near GPT-4 quality, very slow on CPU',
    size: '40 GB download'
  },
  {
    name: 'Llama 3.1 70B (GPU)',
    minRamGB: 16, minVramGB: 48, needsGPU: true,
    quality: 'Near GPT-4 quality with GPU acceleration',
    size: '40 GB download'
  }
];

async function getAIReadiness() {
  const mem = await si.mem();
  const cpu = await si.cpu();
  const { getGpuData } = require('./gpuMonitor');
  const gpuData = await getGpuData();
  
  const ramGB = mem.total / 1e9;
  const cpuBrand = cpu.brand || '';
  const cpuCores = cpu.cores || 0;
  
  const gpuName = gpuData.present ? (gpuData.name || 'Dedicated GPU') : 'Integrated';
  const gpuVramMB = gpuData.present ? (gpuData.memTotalMB || gpuData.ramMB || 0) : 0;
  const gpuVramGB = gpuVramMB / 1024;
  
  let hasNPU = false;
  const brandLower = cpuBrand.toLowerCase();
  if (brandLower.includes('core ultra') || brandLower.includes('ryzen ai') || brandLower.includes('npu')) {
    hasNPU = true;
  }

  const evaluatedModels = models.map(model => {
    const canRun = (ramGB >= model.minRamGB && gpuVramGB >= model.minVramGB) ||
                   (!model.needsGPU && ramGB >= model.minRamGB);
                   
    let speed = 'CPU (slow)';
    if (gpuVramGB >= model.minVramGB && model.minVramGB > 0) {
      speed = 'GPU-accelerated';
    } else if (hasNPU && !model.needsGPU) {
      speed = 'NPU-assisted';
    } else if (cpuCores >= 8 && !model.needsGPU) {
      speed = 'CPU (moderate)';
    }

    return {
      name: model.name,
      canRun,
      speed,
      quality: model.quality,
      size: model.size
    };
  });

  const runnable = evaluatedModels.filter(m => m.canRun);
  let overallRating = 'Not Recommended';
  if (runnable.length >= 4) {
    overallRating = 'AI-Ready';
  } else if (runnable.length > 0) {
    overallRating = 'Basic AI';
  }
  
  let topModel = null;
  if (runnable.length > 0) {
    // just pick the last runnable in the array as "best" since they are ordered by tier generally, except 70B needs to be handled
    const runnableNoHuge = runnable.filter(m => !m.name.includes('70B'));
    if (runnableNoHuge.length > 0) {
      topModel = runnableNoHuge[runnableNoHuge.length - 1].name;
    } else {
      topModel = runnable[0].name;
    }
  }

  return {
    hardware: { 
      ramGB: Math.round(ramGB), 
      gpuName: gpuName, 
      gpuVramGB: Math.round(gpuVramGB),
      hasNPU: hasNPU, 
      cpuBrand: cpuBrand 
    },
    models: evaluatedModels,
    overallRating: overallRating,
    topModel: topModel
  };
}

module.exports = { getAIReadiness };
