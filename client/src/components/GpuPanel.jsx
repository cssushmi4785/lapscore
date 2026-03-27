import React from 'react';

const GpuPanel = ({ gpuData }) => {
  if (!gpuData || !gpuData.present) {
    return (
      <div className="bg-[#0f111a] border border-white/5 rounded-2xl p-6 h-full flex flex-col justify-center items-center text-center">
        <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        </div>
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-1">GPU Health</h3>
        <p className="text-xs text-slate-500">No discrete GPU detected</p>
      </div>
    );
  }

  const {
    name,
    vendor,
    tempC,
    gpuUtilPct,
    memUtilPct,
    memTotalMB,
    memUsedMB,
    memFreeMB,
    powerDrawW,
    powerLimitW,
    clockMHz,
    clockMaxMHz,
    fanSpeedPct,
    memUsedPct,
    powerEfficiency
  } = gpuData;

  const isNvidia = vendor === 'NVIDIA';
  const utilColor = gpuUtilPct >= 80 ? 'text-rose-500' : gpuUtilPct >= 50 ? 'text-amber-500' : 'text-emerald-500';
  const tempColor = tempC >= 80 ? 'text-rose-500' : tempC >= 70 ? 'text-amber-500' : 'text-slate-200';

  return (
    <div className="bg-[#0f111a] border border-white/5 rounded-2xl p-6 h-full flex flex-col">
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">GPU HEALTH</h3>
            {isNvidia && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-500 font-bold border border-emerald-500/20">
                NVIDIA
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 truncate max-w-[200px]">{name}</p>
        </div>
        <div className={`text-2xl font-black ${utilColor}`}>
          {gpuUtilPct}%
        </div>
      </div>

      <div className="flex-grow space-y-5">
        {/* VRAM Progress */}
        <div>
          <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            <span>VRAM Usage</span>
            <span>{Math.round(memUsedMB / 1024 * 10) / 10} / {Math.round(memTotalMB / 1024)} GB</span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-violet-500/50 to-emerald-500/50 rounded-full transition-all duration-1000"
              style={{ width: `${memUsedPct}%` }}
            />
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Temperature</div>
            <div className={`text-lg font-black ${tempColor}`}>{tempC}°C</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Core Clock</div>
            <div className="text-lg font-black text-slate-200">{clockMHz} <span className="text-[10px] font-medium text-slate-500">MHz</span></div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Power Draw</div>
            <div className="text-lg font-black text-slate-200">{Math.round(powerDrawW)}W <span className="text-[10px] font-medium text-slate-500">/ {Math.round(powerLimitW)}W</span></div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Fan Speed</div>
            <div className="text-lg font-black text-slate-200">{fanSpeedPct !== null ? `${fanSpeedPct}%` : 'N/A'}</div>
          </div>
        </div>

        {/* AI Insight */}
        {memFreeMB > 2000 && (
          <div className="mt-4 p-3 bg-violet-500/5 border border-violet-500/10 rounded-xl">
            <div className="flex items-center gap-2 mb-1">
              <svg className="w-3 h-3 text-violet-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
              </svg>
              <span className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">AI READINESS</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Available VRAM: <span className="text-slate-200 font-bold">{Math.round(memFreeMB / 1024 * 10) / 10} GB</span>.
              {memFreeMB > 4000 ? ' Ideal for 8B models (Llama 3, Mistral).' : ' Good for 3B and smaller models.'}
            </p>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between opacity-40 hover:opacity-100 transition-opacity">
        <span className="text-[9px] font-medium text-slate-500 uppercase tracking-tighter">Engine: nvidia-smi v1.1.0</span>
        <div className="flex gap-1">
           <div className="w-1 h-1 rounded-full bg-emerald-500"></div>
           <div className="w-1 h-1 rounded-full bg-emerald-500"></div>
           <div className="w-1 h-1 rounded-full bg-emerald-500"></div>
        </div>
      </div>
    </div>
  );
};

export default GpuPanel;
