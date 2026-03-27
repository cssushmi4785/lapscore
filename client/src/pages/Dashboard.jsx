import { useEffect, useState } from 'react';
import { fetchLatestScan, triggerExport } from '../api';
import { TopNav } from '../components/TopNav';
import { ScoreCard } from '../components/ScoreCard';
import BatteryPanel from '../components/BatteryPanel';
import CpuPanel from '../components/CpuPanel';
import RamPanel from '../components/RamPanel';
import DiskPanel from '../components/DiskPanel';
import ThermalPanel from '../components/ThermalPanel';
import BatteryStress from '../components/BatteryStress';
import ChargingHabits from '../components/ChargingHabits';
import ThrottleRadar from '../components/ThrottleRadar';
import PowerBlockers from '../components/PowerBlockers';
import QuickStats from '../components/QuickStats';
import FixRecommendations from '../components/FixRecommendations';
import LiveGraph from '../components/LiveGraph';
import NetworkPanel from '../components/NetworkPanel';
import AIReadinessCard from '../components/AIReadinessCard';
import StartupPanel from '../components/StartupPanel';
import AlertBanner from '../components/AlertBanner';
import AISessionPanel from '../components/AISessionPanel';
import GpuPanel from '../components/GpuPanel';
import { useLiveStream } from '../hooks/useLiveStream';
import { DataProvider } from '../context/DataContext';
import { DashboardSkeleton } from '../components/DashboardSkeleton';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const { liveData, connected } = useLiveStream();

  const calculateGrade = (score) => {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  };

  const fetchScan = async () => {
    setScanning(true);
    try {
      const result = await fetchLatestScan();
      if (result) {
        setData(result);
      }
    } catch (e) {
      console.error("Scan fetch failed", e);
    } finally {
      setLoading(false);
      setScanning(false);
    }
  };

  useEffect(() => {
    fetchScan();
  }, []);

  if (loading) {
    return (
      <div className="bg-[#080810] min-h-screen">
        <TopNav scanning={true} startScan={null} />
        <DashboardSkeleton />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#080810] text-gray-500 font-black p-12 text-center">
        <div className="w-16 h-16 rounded-3xl bg-red-500/10 flex items-center justify-center text-red-500 mb-6">
           <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
        </div>
        <h1 className="text-3xl uppercase tracking-tighter text-white mb-2">Service Discovery Failed</h1>
        <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-gray-500 max-w-xs leading-relaxed">The LapScore background agent is not communicating. Ensure the server is running on port 7821.</p>
        <button 
          onClick={() => window.location.reload()}
          className="mt-8 px-8 py-3 bg-[#16162a] border border-[#1e1e38] rounded-xl hover:border-purple-500/50 hover:text-white transition-all uppercase font-black tracking-widest text-[10px]"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const totalScore = data.scores?.total ?? data.scores ?? 0;
  const safeScores = {
    grade: calculateGrade(totalScore),
    total: totalScore
  };

  return (
    <DataProvider value={{ 
      scan: data.scan || data, 
      raw: data.raw, 
      recommendations: data.recommendations,
      scores: safeScores 
    }}>
      <div className="bg-[#080810] min-h-screen text-white font-sans selection:bg-purple-500/30 selection:text-white pb-24">
        <div className="fixed inset-0 pointer-events-none overflow-hidden opacity-20">
           <div className="absolute -top-[10%] left-[20%] w-[60%] h-[40%] bg-purple-600/20 blur-[120px] rounded-full" />
           <div className="absolute -bottom-[10%] right-[10%] w-[40%] h-[30%] bg-blue-600/10 blur-[120px] rounded-full" />
        </div>

        <TopNav 
          lastScanTimestamp={data.timestamp || Date.now()} 
          startScan={fetchScan} 
          scanning={scanning} 
        />
        
        <div className="relative z-10 pt-24 px-4 sm:px-6 lg:px-12 max-w-[1600px] mx-auto space-y-8">
          <AlertBanner />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-8 space-y-8 animate-fadeInUp">
              <ScoreCard 
                scores={{...safeScores, breakdown: data.scores?.breakdown || []}}
                deviceModel={
                  data?.raw?.metadata?.Model         ||
                  data?.raw?.metadata?.SystemFamily  ||
                  data?.raw?.system?.model           ||
                  data?.metadata?.Model             ||
                  'This PC'
                }
                lastScanTime={data.timestamp}
                issueCount={data.recommendations?.length || 0}
                raw={data.raw}
                isScanning={scanning}
              />
              
              <QuickStats scanData={data} />

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                 <LiveGraph data={liveData} metric="cpu.loadPct" label="CPU Load" unit="%" color="#3b82f6" />
                 <LiveGraph data={liveData} metric="ram.usedPct" label="RAM Usage" unit="%" color="#7c3aed" />
                 <LiveGraph 
                   data={liveData} 
                   metric="battery.percent" 
                   label="Charge" 
                   color="#10b981" 
                   customValue={
                     liveData[liveData.length - 1]?.battery?.isCharging 
                      ? <><span className="text-emerald-500">⚡</span> AC</> 
                      : `${liveData[liveData.length - 1]?.battery?.percent || 0}%`
                   } 
                 />
                 <LiveGraph 
                   data={liveData} 
                   metric="battery.powerConsumption" 
                   label="Power" 
                   color="#f59e0b" 
                   maxValue={60} 
                   customValue={
                     liveData[liveData.length - 1]?.battery?.isCharging && !liveData[liveData.length - 1]?.battery?.powerConsumption
                      ? "AC Power"
                      : `${Math.round(liveData[liveData.length - 1]?.battery?.powerConsumption || 0)}W`
                   }
                 />
              </div>
            </div>

            <div className="lg:col-span-4 space-y-6 animate-fadeInUp" style={{ animationDelay: '100ms' }}>
              <AIReadinessCard />
              <AISessionPanel />
              <FixRecommendations
                issues={data?.recommendations ?? []}
                isScanning={scanning}
              />
            </div>
          </div>

          <div className="dashboard-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pt-4">
            <div className="animate-fadeInUp" style={{ animationDelay: '200ms' }}>
              <BatteryPanel battery={data.raw?.battery} health={data.scan?.batteryAnalytics?.health} isScanning={scanning} />
            </div>
            <div className="animate-fadeInUp" style={{ animationDelay: '300ms' }}>
              <CpuPanel isScanning={scanning} />
            </div>
            <div className="animate-fadeInUp" style={{ animationDelay: '400ms' }}>
              <RamPanel ram={data.raw?.ram} isScanning={scanning} />
            </div>
            <div className="animate-fadeInUp" style={{ animationDelay: '450ms' }}>
              <GpuPanel gpuData={data.raw?.gpu?.[0]} />
            </div>
            <div className="animate-fadeInUp" style={{ animationDelay: '500ms' }}>
              <DiskPanel disks={data.raw?.disks?.Physical || []} />
            </div>
            <div className="animate-fadeInUp" style={{ animationDelay: '600ms' }}>
              <ThermalPanel sensors={data.raw?.thermals || []} />
            </div>
          </div>

          <div className="dashboard-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8 pt-4">
            <div className="animate-fadeInUp" style={{ animationDelay: '650ms' }}>
              <StartupPanel />
            </div>
            <div className="animate-fadeInUp" style={{ animationDelay: '700ms' }}>
              <NetworkPanel network={data.raw?.network} liveData={liveData[liveData.length-1]} />
            </div>
          </div>

          <div className="dashboard-grid grid grid-cols-1 lg:grid-cols-2 gap-8 pt-4">
            <div className="animate-fadeInUp" style={{ animationDelay: '800ms' }}>
               <BatteryStress samples={data.scan?.batteryAnalytics?.voltageSamples} />
            </div>
            <div className="animate-fadeInUp" style={{ animationDelay: '900ms' }}>
               <ChargingHabits />
            </div>
          </div>

          <div id="throttle-radar" className="animate-fadeInUp" style={{ animationDelay: '1000ms' }}>
             <ThrottleRadar />
          </div>

          <div className="animate-fadeInUp" style={{ animationDelay: '1100ms' }}>
             <PowerBlockers />
          </div>
        </div>
      </div>
    </DataProvider>
  );
}
