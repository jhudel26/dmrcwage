import React, { useState, useEffect, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import * as XLSX from 'xlsx';
import {
  Building2,
  TrendingUp,
  Scale,
  History,
  ShieldCheck,
  Search,
  Download,
  RefreshCw,
  X,
  ExternalLink,
  ArrowRight,
  CheckCircle2,
  Layers,
  FileSpreadsheet,
  FileText,
  LogOut,
  AlertCircle,
  MapPin,
  ArrowUpRight,
  ChevronDown,
  BarChart2,
  Clock,
  Banknote
} from 'lucide-react';
import { Region, WageDataResponse, RateMovementsResponse } from './types';
import { fetchWageData, fetchRateMovements, checkUpdates, adminLogin, triggerNwpcSync, saveWageData } from './api';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// Admin route is accessible via URL hash #/admin — not shown in the nav
const isAdminRoute = () => window.location.hash === '#/admin';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [loadStep, setLoadStep] = useState(0);
  const [loadProgress, setLoadProgress] = useState(10);

  const [wageData, setWageData] = useState<WageDataResponse | null>(null);
  const [movementsData, setMovementsData] = useState<RateMovementsResponse | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'wages' | 'compare' | 'movements' | 'admin'>(
    isAdminRoute() ? 'admin' : 'dashboard'
  );

  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState<'az' | 'za' | 'highest' | 'lowest'>('az');
  const [sectorFilter, setSectorFilter] = useState<'all' | 'Non-Agriculture' | 'Agriculture'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateDetails, setUpdateDetails] = useState<any[]>([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const [compareRegion1, setCompareRegion1] = useState<string>('ncr');
  const [compareRegion2, setCompareRegion2] = useState<string>('region4a');

  const [adminToken, setAdminToken] = useState<string | null>(localStorage.getItem('dmrc-admin-token'));
  const [adminUser, setAdminUser] = useState<string | null>(localStorage.getItem('dmrc-admin-user'));
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  // Live clock
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Listen for hash changes to navigate to admin
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === '#/admin') setCurrentView('admin');
      else if (currentView === 'admin') setCurrentView('dashboard');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [currentView]);

  useEffect(() => {
    const run = async () => {
      setLoadStep(1); setLoadProgress(25);
      try {
        const data = await fetchWageData();
        setWageData(data);
        setLoadStep(2); setLoadProgress(60);

        const movements = await fetchRateMovements();
        setMovementsData(movements);
        setLoadStep(3); setLoadProgress(85);

        const updateCheck = await checkUpdates();
        const lastSeen = localStorage.getItem('lastSeenRateUpdate');
        if (updateCheck.has_changes && updateCheck.last_updated !== lastSeen) {
          setUpdateDetails(updateCheck.recent_changes || []);
          setShowUpdateModal(true);
        }

        setLoadStep(4); setLoadProgress(100);
        setTimeout(() => setLoading(false), 350);
      } catch {
        setLoading(false);
      }
    };
    run();
  }, []);

  const acknowledgeUpdates = () => {
    if (wageData) localStorage.setItem('lastSeenRateUpdate', wageData.lastUpdated);
    setShowUpdateModal(false);
  };

  const navigate = (view: typeof currentView) => {
    setCurrentView(view);
    if (view === 'admin') window.location.hash = '#/admin';
    else window.location.hash = '';
  };

  const filteredRegions = useMemo(() => {
    if (!wageData) return [];
    let list = [...wageData.regions];
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.notes.toLowerCase().includes(q) ||
        r.wageOrder.toLowerCase().includes(q)
      );
    }
    if (sectorFilter !== 'all') {
      list = list.filter(r => r.rates.some(rt => rt.type === sectorFilter));
    }
    list.sort((a, b) => {
      const w = (reg: Region) => {
        const rt = reg.rates.find(r => r.type === 'Non-Agriculture');
        return rt ? (rt.amount || rt.tranches[0]?.amount || 0) : 0;
      };
      if (sortOption === 'az') return a.name.localeCompare(b.name);
      if (sortOption === 'za') return b.name.localeCompare(a.name);
      if (sortOption === 'highest') return w(b) - w(a);
      if (sortOption === 'lowest') return w(a) - w(b);
      return 0;
    });
    return list;
  }, [wageData, searchTerm, sortOption, sectorFilter]);

  const chartData = useMemo(() => {
    if (!wageData) return { labels: [], datasets: [] };
    const sorted = [...wageData.regions]
      .map(r => {
        const rt = r.rates.find(x => x.type === 'Non-Agriculture');
        const wage = rt ? (rt.amount || rt.tranches[0]?.amount || 0) : 0;
        return { name: r.name.replace(/\s*\(.*?\)\s*/g, '').trim() || r.name, wage };
      })
      .sort((a, b) => b.wage - a.wage)
      .slice(0, 10);
    return {
      labels: sorted.map(s => s.name),
      datasets: [{
        label: 'Daily Minimum Wage (₱)',
        data: sorted.map(s => s.wage),
        backgroundColor: [
          '#3b82f6','#6366f1','#8b5cf6','#ec4899','#f59e0b',
          '#10b981','#06b6d4','#f97316','#84cc16','#14b8a6'
        ],
        borderRadius: 6,
        borderSkipped: false,
      }]
    };
  }, [wageData]);

  const comparisonResults = useMemo(() => {
    if (!wageData) return null;
    const r1 = wageData.regions.find(r => r.id === compareRegion1);
    const r2 = wageData.regions.find(r => r.id === compareRegion2);
    if (!r1 || !r2) return null;
    const getW = (r: Region) => {
      const rt = r.rates.find(x => x.type === 'Non-Agriculture');
      return rt ? (rt.amount || rt.tranches[0]?.amount || 0) : 0;
    };
    const w1 = getW(r1), w2 = getW(r2);
    const diff = Math.abs(w1 - w2);
    const variance = ((diff / (Math.min(w1, w2) || 1)) * 100).toFixed(1);
    return { r1, r2, w1, w2, diff, variance };
  }, [wageData, compareRegion1, compareRegion2]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await adminLogin(loginUsername, loginPassword);
      if (res.success) {
        setAdminToken(res.token);
        setAdminUser(res.user.username);
        localStorage.setItem('dmrc-admin-token', res.token);
        localStorage.setItem('dmrc-admin-user', res.user.username);
      } else {
        setLoginError(res.message || 'Invalid credentials.');
      }
    } catch (err: any) {
      setLoginError(err.message || 'Login failed.');
    }
  };

  const handleLogout = () => {
    setAdminToken(null);
    setAdminUser(null);
    localStorage.removeItem('dmrc-admin-token');
    localStorage.removeItem('dmrc-admin-user');
  };

  const handleManualSync = async () => {
    if (!adminToken) return;
    setIsSyncing(true);
    setSyncMessage('Fetching latest wage orders from NWPC DOLE...');
    try {
      const res = await triggerNwpcSync(adminToken);
      if (res.success) {
        setSyncMessage('Sync completed. Data refreshed.');
        setWageData(await fetchWageData());
        setMovementsData(await fetchRateMovements());
      } else {
        setSyncMessage(`Sync failed: ${res.error}`);
      }
    } catch (err: any) {
      setSyncMessage(`Error: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleExportJSON = () => {
    if (!wageData) return;
    const blob = new Blob([JSON.stringify(wageData.regions, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `wage-rates-${new Date().toISOString().slice(0,10)}.json` });
    a.click();
  };

  const handleExportExcel = () => {
    if (!wageData) return;
    const rows = wageData.regions.map(r => {
      const na = r.rates.find(rt => rt.type === 'Non-Agriculture');
      const ag = r.rates.find(rt => rt.type === 'Agriculture');
      return { 'Region': r.name, 'Wage Order': r.wageOrder, 'Date Effective': r.dateEffective, 'Non-Agriculture (₱)': na?.amount || na?.tranches[0]?.amount || '', 'Agriculture (₱)': ag?.amount || ag?.tranches[0]?.amount || '', 'Notes': r.notes };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Wage Rates');
    XLSX.writeFile(wb, `wage-rates-${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const handleExportCSV = () => {
    if (!wageData) return;
    let csv = 'Region,Wage Order,Date Effective,Non-Agriculture,Agriculture,Notes\n';
    wageData.regions.forEach(r => {
      const na = r.rates.find(rt => rt.type === 'Non-Agriculture');
      const ag = r.rates.find(rt => rt.type === 'Agriculture');
      csv += `"${r.name}","${r.wageOrder}","${r.dateEffective}","${na?.amount || na?.tranches[0]?.amount || ''}","${ag?.amount || ag?.tranches[0]?.amount || ''}","${r.notes}"\n`;
    });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `wage-rates-${new Date().toISOString().slice(0,10)}.csv` });
    a.click();
  };

  // ── LOADING SCREEN ────────────────────────────────────────────────────
  if (loading) {
    const steps = ['Connecting to database', 'Loading wage orders', 'Verifying tranche data', 'Preparing dashboard'];
    return (
      <div className="fixed inset-0 bg-gray-950 flex flex-col items-center justify-center text-white z-50 p-6">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 shadow-xl shadow-blue-900/50 mb-5">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">DMRC Wage Monitoring</h1>
          <p className="text-sm text-gray-400 mt-1">Philippine Regional Minimum Wage System</p>
        </div>

        <div className="w-full max-w-xs mb-6">
          <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-1 bg-blue-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${loadProgress}%` }}
            />
          </div>
        </div>

        <div className="space-y-2.5 w-full max-w-xs">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                loadStep > i ? 'bg-blue-600' : loadStep === i ? 'bg-blue-600/40 animate-pulse' : 'bg-gray-800'
              }`}>
                {loadStep > i && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
              </div>
              <span className={`text-sm transition-colors ${loadStep > i ? 'text-gray-300' : loadStep === i ? 'text-white' : 'text-gray-600'}`}>{s}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const navLinks = [
    { view: 'dashboard', label: 'Dashboard', icon: BarChart2 },
    { view: 'wages',     label: 'Wage Rates', icon: Layers },
    { view: 'compare',   label: 'Compare', icon: Scale },
    { view: 'movements', label: 'Movements', icon: TrendingUp },
  ] as const;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-800">

      {/* ── UPDATE TOAST (top-right, non-blocking) ──────────── */}
      {showUpdateModal && (
        <div className="fixed top-16 right-4 z-50 w-80 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <TrendingUp className="w-4 h-4" />
              Wage Rate Updates
            </div>
            <button onClick={acknowledgeUpdates} className="text-blue-200 hover:text-white p-0.5">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
            {updateDetails.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <div className="text-xs font-medium text-gray-900">{item.region_name}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{item.wage_order} · Eff. {item.effective_date}</div>
                </div>
                {item.amount && <div className="text-sm font-bold text-blue-600 ml-2">₱{item.amount}</div>}
              </div>
            ))}
          </div>
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
            <button onClick={acknowledgeUpdates} className="w-full py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 transition">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ── REGION DETAIL MODAL ───────────────────────────────── */}
      {selectedRegion && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setSelectedRegion(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-5 sm:p-6 border-b border-gray-100 flex items-start justify-between gap-4">
              <div>
                <span className="inline-block px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded-lg font-mono mb-2">
                  {selectedRegion.wageOrder}
                </span>
                <h3 className="font-bold text-lg text-gray-900 leading-snug">{selectedRegion.name}</h3>
                {selectedRegion.dateEffective && (
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Effective {selectedRegion.dateEffective}
                  </p>
                )}
              </div>
              <button onClick={() => setSelectedRegion(null)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-4 max-h-[65vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                {selectedRegion.rates.map((rate, i) => (
                  <div key={i} className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                    <div className="text-xs font-medium text-gray-500 mb-2">{rate.type}</div>
                    <div className="text-2xl font-bold text-gray-900">
                      ₱{rate.amount || rate.tranches[0]?.amount || '—'}
                    </div>
                    {rate.tranches.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200 space-y-1.5">
                        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Tranche Schedule</div>
                        {rate.tranches.map((tr, ti) => (
                          <div key={ti} className="flex items-center justify-between text-xs">
                            <span className="text-gray-400">
                              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${tr.status === 'upcoming' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                              {tr.effectiveDate}
                            </span>
                            <span className="font-semibold text-gray-700">₱{tr.amount}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {selectedRegion.notes && (
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    <MapPin className="w-3.5 h-3.5" /> Coverage Area
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{selectedRegion.notes}</p>
                </div>
              )}

              {selectedRegion.pdfUrl && (
                <a
                  href={selectedRegion.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3.5 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-xl transition group"
                >
                  <div className="flex items-center gap-2.5 text-sm text-gray-700 group-hover:text-blue-700">
                    <FileText className="w-4 h-4 text-gray-400 group-hover:text-blue-500" />
                    Official NWPC Wage Order
                  </div>
                  <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-blue-500" />
                </a>
              )}
            </div>

            <div className="px-5 sm:px-6 pb-5 sm:pb-6 pt-3">
              <button onClick={() => setSelectedRegion(null)} className="w-full py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-xl transition">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── HEADER ───────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <div className="hidden sm:block">
              <span className="text-sm font-bold text-gray-900">DMRC Wage Monitor</span>
              <span className="ml-2 text-xs text-gray-400 hidden md:inline">Philippine Minimum Wage Rates</span>
            </div>
          </div>

          <nav className="flex items-center gap-0.5">
            {navLinks.map(({ view, label, icon: Icon }) => (
              <button
                key={view}
                onClick={() => navigate(view)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                  currentView === view
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="hidden lg:flex items-center gap-2 text-xs text-gray-500 font-mono bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-lg">
              <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <span>
                {now.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                {' '}
                <span className="text-gray-700 font-semibold">
                  {now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ── MAIN ─────────────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

        {/* Info Banner */}
        {!bannerDismissed && currentView !== 'admin' && (
          <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">
            <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <span className="flex-1">Wage data is automatically synchronized every 6 hours from <strong>NWPC – DOLE</strong>. All rates reflect the latest issued wage orders per region.</span>
            <button onClick={() => setBannerDismissed(true)} className="text-blue-400 hover:text-blue-600 flex-shrink-0 p-0.5">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── VIEW: DASHBOARD ───────────────────────────────── */}
        {currentView === 'dashboard' && wageData && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Overview</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Last updated {new Date(wageData.lastUpdated).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Regions Covered', value: wageData.metrics.totalRegions, sub: 'Administrative zones', color: 'text-gray-900', icon: MapPin },
                { label: 'Highest Wage', value: `₱${wageData.metrics.highestWage}`, sub: 'NCR Non-Agriculture', color: 'text-blue-700', icon: ArrowUpRight },
                { label: 'National Average', value: `₱${wageData.metrics.averageWage}`, sub: 'Non-Agriculture mean', color: 'text-indigo-700', icon: BarChart2 },
                { label: 'Updated This Year', value: wageData.metrics.updatedThisYear, sub: 'Active wage orders', color: 'text-emerald-700', icon: CheckCircle2 },
              ].map((card, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-gray-500">{card.label}</span>
                    <card.icon className={`w-4 h-4 ${card.color} opacity-60`} />
                  </div>
                  <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
                  <div className="text-xs text-gray-400 mt-1">{card.sub}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Bar Chart */}
              <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Top 10 Regions by Minimum Wage</h3>
                <p className="text-xs text-gray-400 mb-5">Non-agriculture daily rate (₱)</p>
                <div className="h-64">
                  <Bar
                    data={chartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          callbacks: {
                            label: ctx => ` ₱${ctx.parsed.y.toLocaleString()}/day`
                          }
                        }
                      },
                      scales: {
                        x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 35 } },
                        y: { beginAtZero: false, min: 380, grid: { color: '#f3f4f6' }, ticks: { callback: v => `₱${v}`, font: { size: 11 } } }
                      }
                    }}
                  />
                </div>
              </div>

              {/* Recent Updates */}
              <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Recent Wage Updates</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Sorted by effectivity date</p>
                  </div>
                  <button onClick={() => navigate('wages')} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                    See all <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex-1 divide-y divide-gray-50">
                  {[...wageData.regions]
                    .filter(r => r.dateEffective)
                    .sort((a, b) => new Date(b.dateEffective).getTime() - new Date(a.dateEffective).getTime())
                    .slice(0, 8)
                    .map((r, i) => {
                      const na = r.rates.find(rt => rt.type === 'Non-Agriculture');
                      const isRecent = new Date(r.dateEffective) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
                      return (
                        <div
                          key={i}
                          onClick={() => setSelectedRegion(r)}
                          className="flex items-center justify-between py-2.5 cursor-pointer group"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-gray-800 group-hover:text-blue-700 truncate transition">
                                {r.name.replace(/\s*\(.*?\)\s*/g, '').trim() || r.name}
                              </span>
                              {isRecent && (
                                <span className="flex-shrink-0 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">NEW</span>
                              )}
                            </div>
                            <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {r.dateEffective}
                              <span className="mx-1 text-gray-200">·</span>
                              <span className="font-mono">{r.wageOrder}</span>
                            </div>
                          </div>
                          <div className="text-sm font-bold text-blue-700 flex-shrink-0 ml-2">
                            ₱{na?.amount || na?.tranches[na.tranches.length - 1]?.amount || '—'}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── VIEW: WAGE RATES ──────────────────────────────── */}
        {currentView === 'wages' && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Wage Rates</h2>
                <p className="text-sm text-gray-500 mt-0.5">{filteredRegions.length} regions · current statutory minimum daily rates</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={handleExportExcel} className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900 transition">
                  <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                </button>
                <button onClick={handleExportCSV} className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900 transition">
                  <Download className="w-3.5 h-3.5" /> CSV
                </button>
              </div>
            </div>

            {/* Filter Row */}
            <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search region, city, wage order..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select value={sectorFilter} onChange={(e: any) => setSectorFilter(e.target.value)} className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium text-gray-700 focus:outline-none cursor-pointer">
                  <option value="all">All Sectors</option>
                  <option value="Non-Agriculture">Non-Agriculture</option>
                  <option value="Agriculture">Agriculture</option>
                </select>
                <select value={sortOption} onChange={(e: any) => setSortOption(e.target.value)} className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium text-gray-700 focus:outline-none cursor-pointer">
                  <option value="az">Name A–Z</option>
                  <option value="za">Name Z–A</option>
                  <option value="highest">Highest First</option>
                  <option value="lowest">Lowest First</option>
                </select>
                <div className="flex bg-gray-100 p-0.5 rounded-lg">
                  {(['grid', 'list'] as const).map(m => (
                    <button key={m} onClick={() => setViewMode(m)} className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition ${viewMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                      {m === 'grid' ? '⊞' : '☰'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Grid */}
            {viewMode === 'grid' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredRegions.map(region => {
                  const na = region.rates.find(rt => rt.type === 'Non-Agriculture');
                  const ag = region.rates.find(rt => rt.type === 'Agriculture');
                  const hasTransches = region.rates.some(r => r.tranches.length > 0);

                  return (
                    <div
                      key={region.id}
                      onClick={() => setSelectedRegion(region)}
                      className="bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition cursor-pointer group overflow-hidden"
                    >
                      <div className="p-4 pb-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="text-[11px] font-mono font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                            {region.wageOrder}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {hasTransches && (
                              <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">Tranches</span>
                            )}
                          </div>
                        </div>
                        <h4 className="font-semibold text-sm text-gray-900 group-hover:text-blue-700 leading-snug transition">
                          {region.name}
                        </h4>
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">{region.notes}</p>
                      </div>
                      <div className="px-4 pb-4 border-t border-gray-50 pt-3 grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-[10px] font-medium text-gray-400 mb-0.5">Non-Agri</div>
                          <div className="text-lg font-bold text-blue-700">₱{na?.amount || na?.tranches[0]?.amount || '—'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-medium text-gray-400 mb-0.5">Agriculture</div>
                          <div className="text-lg font-bold text-gray-700">₱{ag?.amount || ag?.tranches[0]?.amount || '—'}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* List */}
            {viewMode === 'list' && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wide">
                      <th className="text-left py-3 px-4">Region</th>
                      <th className="text-left py-3 px-3">Wage Order</th>
                      <th className="text-left py-3 px-3">Effective</th>
                      <th className="text-right py-3 px-3">Non-Agri</th>
                      <th className="text-right py-3 px-3">Agri</th>
                      <th className="py-3 px-4" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredRegions.map(region => {
                      const na = region.rates.find(rt => rt.type === 'Non-Agriculture');
                      const ag = region.rates.find(rt => rt.type === 'Agriculture');
                      return (
                        <tr key={region.id} onClick={() => setSelectedRegion(region)} className="hover:bg-gray-50 cursor-pointer transition">
                          <td className="py-3 px-4 font-medium text-gray-900 max-w-xs">{region.name}</td>
                          <td className="py-3 px-3 font-mono text-xs text-gray-500">{region.wageOrder}</td>
                          <td className="py-3 px-3 text-xs text-gray-400">{region.dateEffective || '—'}</td>
                          <td className="py-3 px-3 text-right font-semibold text-blue-700">₱{na?.amount || na?.tranches[0]?.amount || '—'}</td>
                          <td className="py-3 px-3 text-right font-semibold text-gray-700">₱{ag?.amount || ag?.tranches[0]?.amount || '—'}</td>
                          <td className="py-3 px-4 text-right">
                            <span className="text-xs text-gray-400 hover:text-blue-600 transition">Details →</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── VIEW: COMPARE ─────────────────────────────────── */}
        {currentView === 'compare' && wageData && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Compare Regions</h2>
              <p className="text-sm text-gray-500 mt-0.5">Side-by-side wage comparison between any two regions</p>
            </div>

            <div className="max-w-2xl">
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { label: 'Region A', value: compareRegion1, onChange: setCompareRegion1, accent: 'blue' },
                    { label: 'Region B', value: compareRegion2, onChange: setCompareRegion2, accent: 'indigo' },
                  ].map(({ label, value, onChange, accent }) => (
                    <div key={label}>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
                      <div className="relative">
                        <select
                          value={value}
                          onChange={e => onChange(e.target.value)}
                          className="w-full appearance-none py-2.5 pl-3 pr-8 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                        >
                          {wageData.regions.map(r => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                        <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>
                  ))}
                </div>

                {comparisonResults && (
                  <div className="space-y-4 pt-2 border-t border-gray-100">
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { r: comparisonResults.r1, w: comparisonResults.w1, color: 'blue' },
                        { r: comparisonResults.r2, w: comparisonResults.w2, color: 'indigo' },
                      ].map(({ r, w, color }, i) => (
                        <div key={i} className={`p-4 rounded-xl border ${color === 'blue' ? 'bg-blue-50 border-blue-100' : 'bg-indigo-50 border-indigo-100'}`}>
                          <div className={`text-xs font-medium mb-2 ${color === 'blue' ? 'text-blue-700' : 'text-indigo-700'}`}>{r.name}</div>
                          <div className={`text-3xl font-bold ${color === 'blue' ? 'text-blue-800' : 'text-indigo-800'}`}>₱{w}</div>
                          <div className="text-xs text-gray-400 mt-1 font-mono">{r.wageOrder}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                      <div>
                        <div className="text-xs text-gray-500 font-medium">Daily Difference</div>
                        <div className="text-2xl font-bold text-gray-900">₱{comparisonResults.diff}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500 font-medium">Gap</div>
                        <div className="text-2xl font-bold text-gray-900">{comparisonResults.variance}%</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── VIEW: MOVEMENTS ──────────────────────────────── */}
        {currentView === 'movements' && movementsData && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Rate Movements</h2>
              <p className="text-sm text-gray-500 mt-0.5">Historical wage adjustments and baseline comparisons</p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Total Increases', value: movementsData.summary.totalIncreases, sub: 'Recorded adjustments', color: 'text-emerald-700' },
                { label: 'Average Increase', value: `${movementsData.summary.avgIncrease}%`, sub: 'Growth rate', color: 'text-blue-700' },
                { label: 'Regions Changed', value: movementsData.summary.regionsChanged, sub: 'Active adjustments', color: 'text-indigo-700' },
                { label: 'Last Movement', value: `${movementsData.summary.lastMovementDays}d ago`, sub: 'Days since effectivity', color: 'text-gray-700' },
              ].map((c, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="text-xs font-medium text-gray-500 mb-2">{c.label}</div>
                  <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
                  <div className="text-xs text-gray-400 mt-1">{c.sub}</div>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Wage Movement History</h3>
                <span className="text-xs text-gray-400">{movementsData.movements.length} region comparisons</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wide">
                      <th className="text-left py-3 px-5">Region</th>
                      <th className="text-left py-3 px-3">Previous Order</th>
                      <th className="text-right py-3 px-3">Prev. Rate</th>
                      <th className="text-right py-3 px-3">Current Rate</th>
                      <th className="text-right py-3 px-3">Change</th>
                      <th className="text-left py-3 px-3">Effective</th>
                      <th className="text-left py-3 px-5">Current Order</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {movementsData.movements.map((m, i) => {
                      const isPos = m.change > 0;
                      const isNeg = m.change < 0;
                      return (
                        <tr key={i} className="hover:bg-gray-50 transition">
                          <td className="py-3 px-5 font-medium text-gray-900 max-w-[180px]">{m.regionName}</td>
                          <td className="py-3 px-3 font-mono text-xs text-gray-400">{m.previousWageOrder}</td>
                          <td className="py-3 px-3 text-right text-gray-400">₱{m.previousAmount.toLocaleString()}</td>
                          <td className="py-3 px-3 text-right font-semibold text-gray-900">₱{m.currentAmount.toLocaleString()}</td>
                          <td className="py-3 px-3 text-right">
                            <span className={`font-semibold text-xs px-2 py-0.5 rounded ${
                              isPos ? 'text-emerald-700 bg-emerald-50' :
                              isNeg ? 'text-red-600 bg-red-50' :
                              'text-gray-500 bg-gray-100'
                            }`}>
                              {isPos ? '+' : ''}{isNeg ? '' : ''}₱{Math.abs(m.change)} ({isPos ? '+' : ''}{m.changePercent}%)
                            </span>
                          </td>
                          <td className="py-3 px-3 text-xs text-gray-400">{m.currentEffectiveDate}</td>
                          <td className="py-3 px-5 font-mono text-xs text-gray-500">{m.currentWageOrder}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── VIEW: ADMIN (hidden route) ────────────────────── */}
        {currentView === 'admin' && (
          <div className="space-y-5">
            {!adminToken ? (
              <div className="max-w-sm mx-auto pt-8">
                <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
                  <div className="text-center mb-6">
                    <div className="inline-flex items-center justify-center w-12 h-12 bg-gray-900 rounded-xl mb-4">
                      <ShieldCheck className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900">Admin Access</h3>
                    <p className="text-sm text-gray-400 mt-1">Restricted. Authorized personnel only.</p>
                  </div>

                  {loginError && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-700 text-sm rounded-lg">
                      {loginError}
                    </div>
                  )}

                  <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Username</label>
                      <input
                        type="text"
                        value={loginUsername}
                        onChange={e => setLoginUsername(e.target.value)}
                        className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                        autoComplete="username"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Password</label>
                      <input
                        type="password"
                        value={loginPassword}
                        onChange={e => setLoginPassword(e.target.value)}
                        className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                        autoComplete="current-password"
                      />
                    </div>
                    <button type="submit" className="w-full py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition">
                      Sign in
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Admin Panel</h2>
                    <p className="text-sm text-gray-400 mt-0.5">Signed in as <span className="font-medium text-gray-700">{adminUser}</span></p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleManualSync}
                      disabled={isSyncing}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition"
                    >
                      <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                      {isSyncing ? 'Syncing…' : 'Sync NWPC Now'}
                    </button>
                    <button onClick={handleLogout} className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-600 hover:text-gray-900 text-sm font-medium rounded-lg transition">
                      <LogOut className="w-4 h-4" /> Logout
                    </button>
                  </div>
                </div>

                {syncMessage && (
                  <div className="flex items-center justify-between p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">
                    <span>{syncMessage}</span>
                    <button onClick={() => setSyncMessage('')}><X className="w-4 h-4 text-blue-400" /></button>
                  </div>
                )}

                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Export Data</h4>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={handleExportExcel} className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition">
                      <FileSpreadsheet className="w-4 h-4" /> Excel (.xlsx)
                    </button>
                    <button onClick={handleExportCSV} className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 text-xs font-medium rounded-lg transition">
                      <FileText className="w-4 h-4" /> CSV
                    </button>
                    <button onClick={handleExportJSON} className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 text-xs font-medium rounded-lg transition">
                      <Download className="w-4 h-4" /> JSON
                    </button>
                  </div>
                </div>

                {wageData && (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-gray-900">Regional Records</h4>
                      <span className="text-xs text-gray-400">Last sync: {new Date(wageData.lastUpdated).toLocaleString()}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wide">
                            <th className="text-left py-3 px-5">Region</th>
                            <th className="text-left py-3 px-3">Wage Order</th>
                            <th className="text-left py-3 px-3">Effective</th>
                            <th className="text-right py-3 px-3">Non-Agri</th>
                            <th className="text-right py-3 px-5">Agriculture</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {wageData.regions.map(reg => {
                            const na = reg.rates.find(rt => rt.type === 'Non-Agriculture');
                            const ag = reg.rates.find(rt => rt.type === 'Agriculture');
                            return (
                              <tr key={reg.id} className="hover:bg-gray-50 transition">
                                <td className="py-3 px-5 font-medium text-gray-900">{reg.name}</td>
                                <td className="py-3 px-3 font-mono text-xs text-blue-600">{reg.wageOrder}</td>
                                <td className="py-3 px-3 text-xs text-gray-400">{reg.dateEffective || '—'}</td>
                                <td className="py-3 px-3 text-right font-semibold text-gray-900">₱{na?.amount || na?.tranches[0]?.amount || '—'}</td>
                                <td className="py-3 px-5 text-right font-semibold text-gray-700">₱{ag?.amount || ag?.tranches[0]?.amount || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5" />
            <span>DMRC Regional Minimum Wage Monitoring · Data from NWPC DOLE</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span>Developed by</span>
            <a href="https://jhudel.vercel.app/" target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:text-blue-700 transition">
              Jhudel
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
