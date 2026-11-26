import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  ShieldCheck,
  Search,
  Download,
  RefreshCw,
  X,
  ExternalLink,
  ArrowRight,
  ArrowLeftRight,
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
  Megaphone
} from 'lucide-react';
import { Region, SectorRate, Tranche, WageDataResponse, RateMovementsResponse } from './types';
import { fetchWageData, fetchRateMovements, checkUpdates, adminLogin, triggerNwpcSync } from './api';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const isAdminRoute = () => window.location.hash === '#/admin';

/**
 * Resolve the currently effective rate and any upcoming tranche for a sector.
 */
function getEffectiveRate(rate?: SectorRate): { current: number | null; nextTranche: Tranche | null } {
  if (!rate) return { current: null, nextTranche: null };
  if (rate.tranches && rate.tranches.length > 0) {
    const currentTranches = rate.tranches.filter(t => t.status === 'current');
    const upcomingTranches = rate.tranches.filter(t => t.status === 'upcoming');
    const current = currentTranches.length > 0
      ? Math.max(...currentTranches.map(t => t.amount))
      : rate.tranches[0].amount;
    const nextTranche = upcomingTranches.length > 0 ? upcomingTranches[0] : null;
    return { current, nextTranche };
  }
  return { current: rate.amount, nextTranche: null };
}

function getSectorRate(region: Region, type: 'Non-Agriculture' | 'Agriculture') {
  return getEffectiveRate(region.rates.find(r => r.type === type));
}

function csvCell(val: unknown): string {
  const s = String(val ?? '').replace(/"/g, '""');
  return `"${s}"`;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStep, setLoadStep] = useState(0);
  const [loadProgress, setLoadProgress] = useState(10);

  const [wageData, setWageData] = useState<WageDataResponse | null>(null);
  const [movementsData, setMovementsData] = useState<RateMovementsResponse | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'wages' | 'compare' | 'movements' | 'admin'>(
    isAdminRoute() ? 'admin' : 'dashboard'
  );

  const [searchTerm, setSearchTerm] = useState('');
  const [movementSearch, setMovementSearch] = useState('');
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

  // Listen for hash changes to navigate to/from admin
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === '#/admin') setCurrentView('admin');
      else if (currentView === 'admin') setCurrentView('dashboard');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [currentView]);

  // Close modal on Escape key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedRegion(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadStep(1);
    setLoadProgress(25);
    try {
      const data = await fetchWageData();
      setWageData(data);
      setLoadStep(2);
      setLoadProgress(60);

      const movements = await fetchRateMovements();
      setMovementsData(movements);
      setLoadStep(3);
      setLoadProgress(85);

      try {
        const updateCheck = await checkUpdates();
        const lastSeen = localStorage.getItem('lastSeenRateUpdate');
        if (updateCheck.has_changes && updateCheck.last_updated !== lastSeen) {
          setUpdateDetails(updateCheck.recent_changes || []);
          setShowUpdateModal(true);
        }
      } catch {
        // Non-fatal if update check fails
      }

      setLoadStep(4);
      setLoadProgress(100);
      setTimeout(() => setLoading(false), 300);
    } catch (err: any) {
      setLoadError(err?.message || 'Unable to connect to the wage database.');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const acknowledgeUpdates = () => {
    if (wageData) localStorage.setItem('lastSeenRateUpdate', wageData.lastUpdated);
    setShowUpdateModal(false);
  };

  const navigate = (view: typeof currentView) => {
    setCurrentView(view);
    if (view === 'admin') window.location.hash = '#/admin';
    else if (window.location.hash) window.location.hash = '';
  };

  // Most recent effective region for announcement banner
  const latestEffectiveRegion = useMemo(() => {
    if (!wageData?.regions.length) return null;
    const withDate = wageData.regions.filter(r => r.dateEffective);
    if (!withDate.length) return null;
    return [...withDate].sort(
      (a, b) => new Date(b.dateEffective).getTime() - new Date(a.dateEffective).getTime()
    )[0];
  }, [wageData]);

  const recentUpdatesList = useMemo(() => {
    if (!wageData) return [];
    return [...wageData.regions]
      .filter(r => r.dateEffective)
      .sort((a, b) => new Date(b.dateEffective).getTime() - new Date(a.dateEffective).getTime())
      .slice(0, 8);
  }, [wageData]);

  const filteredRegions = useMemo(() => {
    if (!wageData) return [];
    let list = [...wageData.regions];
    if (searchTerm.trim()) {
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
      const wA = getSectorRate(a, 'Non-Agriculture').current || 0;
      const wB = getSectorRate(b, 'Non-Agriculture').current || 0;
      if (sortOption === 'az') return a.name.localeCompare(b.name);
      if (sortOption === 'za') return b.name.localeCompare(a.name);
      if (sortOption === 'highest') return wB - wA;
      if (sortOption === 'lowest') return wA - wB;
      return 0;
    });
    return list;
  }, [wageData, searchTerm, sortOption, sectorFilter]);

  const filteredMovements = useMemo(() => {
    if (!movementsData) return [];
    if (!movementSearch.trim()) return movementsData.movements;
    const q = movementSearch.toLowerCase();
    return movementsData.movements.filter(
      m =>
        m.regionName.toLowerCase().includes(q) ||
        m.currentWageOrder.toLowerCase().includes(q) ||
        m.previousWageOrder.toLowerCase().includes(q)
    );
  }, [movementsData, movementSearch]);

  const chartData = useMemo(() => {
    if (!wageData) return { labels: [], datasets: [] };
    const sorted = [...wageData.regions]
      .map(r => ({
        name: r.name.replace(/\s*\(.*?\)\s*/g, '').trim() || r.name,
        wage: getSectorRate(r, 'Non-Agriculture').current || 0
      }))
      .sort((a, b) => b.wage - a.wage)
      .slice(0, 10);

    return {
      labels: sorted.map(s => s.name),
      datasets: [{
        label: 'Daily Minimum Wage (₱)',
        data: sorted.map(s => s.wage),
        backgroundColor: [
          '#2563eb', '#4f46e5', '#7c3aed', '#0ea5e9', '#06b6d4',
          '#10b981', '#14b8a6', '#f59e0b', '#f97316', '#64748b'
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

    const w1 = getSectorRate(r1, 'Non-Agriculture').current || 0;
    const w2 = getSectorRate(r2, 'Non-Agriculture').current || 0;
    const a1 = getSectorRate(r1, 'Agriculture').current || 0;
    const a2 = getSectorRate(r2, 'Agriculture').current || 0;

    const diff = Math.abs(w1 - w2);
    const variance = ((diff / (Math.min(w1, w2) || 1)) * 100).toFixed(1);
    const agriDiff = Math.abs(a1 - a2);
    const agriVariance = ((agriDiff / (Math.min(a1, a2) || 1)) * 100).toFixed(1);
    const maxWage = Math.max(w1, w2, a1, a2, 1);

    return { r1, r2, w1, w2, a1, a2, diff, variance, agriDiff, agriVariance, maxWage };
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
        setLoginPassword('');
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
        setSyncMessage(`Sync completed (${res.synced ?? 0} updated, ${res.skipped ?? 0} unchanged). Data refreshed.`);
        setWageData(await fetchWageData());
        setMovementsData(await fetchRateMovements());
      } else {
        setSyncMessage(`Sync failed: ${res.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      setSyncMessage(`Error: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExportJSON = () => {
    if (!wageData) return;
    const blob = new Blob([JSON.stringify(wageData.regions, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `wage-rates-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const handleExportExcel = () => {
    if (!wageData) return;
    const rows = wageData.regions.map(r => ({
      'Region': r.name,
      'Wage Order': r.wageOrder,
      'Date Effective': r.dateEffective,
      'Non-Agriculture (₱)': getSectorRate(r, 'Non-Agriculture').current ?? '',
      'Agriculture (₱)': getSectorRate(r, 'Agriculture').current ?? '',
      'Notes': r.notes
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Wage Rates');
    XLSX.writeFile(wb, `wage-rates-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleExportCSV = () => {
    if (!wageData) return;
    const header = ['Region', 'Wage Order', 'Date Effective', 'Non-Agriculture (PHP)', 'Agriculture (PHP)', 'Notes'].join(',');
    const lines = wageData.regions.map(r => [
      csvCell(r.name),
      csvCell(r.wageOrder),
      csvCell(r.dateEffective),
      csvCell(getSectorRate(r, 'Non-Agriculture').current ?? ''),
      csvCell(getSectorRate(r, 'Agriculture').current ?? ''),
      csvCell(r.notes)
    ].join(','));
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, `wage-rates-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // ── LOADING SCREEN ────────────────────────────────────────────────────
  if (loading) {
    const steps = ['Connecting to database', 'Loading wage orders', 'Verifying tranche data', 'Preparing dashboard'];
    return (
      <div className="fixed inset-0 bg-gray-950 flex flex-col items-center justify-center text-white z-50 p-6">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 shadow-xl shadow-blue-900/50 mb-4">
            <Building2 className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-lg font-bold tracking-tight text-white">DMRC Wage Monitoring</h1>
          <p className="text-xs text-gray-400 mt-1">Philippine Regional Minimum Wage System</p>
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

  // ── ERROR SCREEN ──────────────────────────────────────────────────────
  if (loadError && !wageData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border border-gray-200 rounded-2xl p-8 max-w-sm w-full text-center shadow-sm">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-red-50 text-red-600 mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-gray-900">Unable to load wage data</h2>
          <p className="text-sm text-gray-500 mt-1 mb-5">{loadError}</p>
          <button
            onClick={loadInitialData}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      </div>
    );
  }

  const navLinks = [
    { view: 'dashboard', label: 'Dashboard', icon: BarChart2 },
    { view: 'wages', label: 'Wage Rates', icon: Layers },
    { view: 'compare', label: 'Compare', icon: Scale },
    { view: 'movements', label: 'Movements', icon: TrendingUp },
  ] as const;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-800">

      {/* ── UPDATE TOAST (top-right, non-blocking) ──────────── */}
      {showUpdateModal && (
        <div className="fixed top-16 right-4 z-50 w-80 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <TrendingUp className="w-4 h-4" />
              Wage Rate Updates
            </div>
            <button onClick={acknowledgeUpdates} aria-label="Dismiss updates" className="text-blue-200 hover:text-white p-0.5">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
            {updateDetails.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between px-4 py-2.5">
                <div className="min-w-0 pr-2">
                  <div className="text-xs font-medium text-gray-900 truncate">{item.region_name}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{item.wage_order} · Eff. {item.effective_date}</div>
                </div>
                {item.amount && <div className="text-sm font-bold text-blue-600 flex-shrink-0">₱{item.amount}</div>}
              </div>
            ))}
          </div>
          <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100">
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
              <button onClick={() => setSelectedRegion(null)} aria-label="Close modal" className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-4 max-h-[65vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {selectedRegion.rates.map((rate, i) => {
                  const { current, nextTranche } = getEffectiveRate(rate);
                  return (
                    <div key={i} className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                      <div className="text-xs font-medium text-gray-500 mb-1.5">{rate.type}</div>
                      <div className="text-2xl font-bold text-gray-900">
                        ₱{current ?? '—'}
                      </div>
                      {nextTranche && (
                        <div className="text-[11px] font-medium text-amber-700 mt-1">
                          Next: ₱{nextTranche.amount} on {nextTranche.effectiveDate}
                        </div>
                      )}
                      {rate.tranches.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-200 space-y-1.5">
                          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Tranche Schedule</div>
                          {rate.tranches.map((tr, ti) => (
                            <div key={ti} className="flex items-center justify-between text-xs">
                              <span className="text-gray-500 flex items-center gap-1.5">
                                <span className={`inline-block w-1.5 h-1.5 rounded-full ${tr.status === 'upcoming' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                                T{tr.order} · {tr.effectiveDate}
                              </span>
                              <span className="font-semibold text-gray-800">
                                ₱{tr.amount}
                                {tr.status === 'upcoming' && <span className="ml-1 text-[10px] text-amber-600 font-normal">(Soon)</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
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
          <button
            onClick={() => navigate('dashboard')}
            className="flex items-center gap-2.5 flex-shrink-0 text-left focus:outline-none"
          >
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <div className="hidden sm:block">
              <span className="text-sm font-bold text-gray-900">DMRC Wage Monitor</span>
              <span className="ml-2 text-xs text-gray-400 hidden md:inline">Philippine Minimum Wage Rates</span>
            </div>
          </button>

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

        {/* Dynamic Recent Wage Update Announcement Banner */}
        {!bannerDismissed && currentView !== 'admin' && latestEffectiveRegion && (
          <div className="flex items-center gap-3 px-4 py-3 bg-cyan-50 border border-cyan-200/80 rounded-xl text-xs sm:text-sm text-cyan-950">
            <Megaphone className="w-4 h-4 text-cyan-600 flex-shrink-0" />
            <button
              onClick={() => setSelectedRegion(latestEffectiveRegion)}
              className="flex-1 text-left hover:underline"
            >
              <span className="font-semibold">Recent Wage Update: </span>
              <span>
                {latestEffectiveRegion.name} — Wage Order {latestEffectiveRegion.wageOrder} effective {latestEffectiveRegion.dateEffective}
              </span>
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              aria-label="Dismiss announcement"
              className="text-cyan-500 hover:text-cyan-800 flex-shrink-0 p-0.5"
            >
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
                            label: ctx => ` ₱${ctx.parsed.y?.toLocaleString()}/day`
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
                  {recentUpdatesList.map((r, i) => {
                    const { current } = getSectorRate(r, 'Non-Agriculture');
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
                          ₱{current ?? '—'}
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
                      {m === 'grid' ? 'Grid' : 'List'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredRegions.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-sm font-medium text-gray-700">No regions match "{searchTerm}"</p>
                <p className="text-xs text-gray-400 mt-1">Try a different keyword or reset your filters.</p>
                <button
                  onClick={() => { setSearchTerm(''); setSectorFilter('all'); }}
                  className="mt-4 px-4 py-2 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              <>
                {/* Grid */}
                {viewMode === 'grid' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredRegions.map(region => {
                      const na = getSectorRate(region, 'Non-Agriculture');
                      const ag = getSectorRate(region, 'Agriculture');
                      const hasTranches = region.rates.some(r => r.tranches.length > 0);

                      return (
                        <div
                          key={region.id}
                          onClick={() => setSelectedRegion(region)}
                          className="bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition cursor-pointer group overflow-hidden flex flex-col justify-between"
                        >
                          <div className="p-4 pb-3">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <span className="text-[11px] font-mono font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                                {region.wageOrder}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {na.nextTranche && (
                                  <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded">
                                    Next: ₱{na.nextTranche.amount}
                                  </span>
                                )}
                                {hasTranches && (
                                  <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">
                                    Tranches
                                  </span>
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
                              <div className="text-lg font-bold text-blue-700">₱{na.current ?? '—'}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-medium text-gray-400 mb-0.5">Agriculture</div>
                              <div className="text-lg font-bold text-gray-700">₱{ag.current ?? '—'}</div>
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
                    <div className="overflow-x-auto">
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
                            const na = getSectorRate(region, 'Non-Agriculture');
                            const ag = getSectorRate(region, 'Agriculture');
                            return (
                              <tr key={region.id} onClick={() => setSelectedRegion(region)} className="hover:bg-gray-50 cursor-pointer transition">
                                <td className="py-3 px-4 font-medium text-gray-900 max-w-xs">{region.name}</td>
                                <td className="py-3 px-3 font-mono text-xs text-gray-500">{region.wageOrder}</td>
                                <td className="py-3 px-3 text-xs text-gray-400">{region.dateEffective || '—'}</td>
                                <td className="py-3 px-3 text-right font-semibold text-blue-700">₱{na.current ?? '—'}</td>
                                <td className="py-3 px-3 text-right font-semibold text-gray-700">₱{ag.current ?? '—'}</td>
                                <td className="py-3 px-4 text-right">
                                  <span className="text-xs text-gray-400 hover:text-blue-600 transition">Details →</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
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

            <div className="max-w-3xl">
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Region A</label>
                    <div className="relative">
                      <select
                        value={compareRegion1}
                        onChange={e => setCompareRegion1(e.target.value)}
                        className="w-full appearance-none py-2.5 pl-3 pr-8 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                      >
                        {wageData.regions.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      const tmp = compareRegion1;
                      setCompareRegion1(compareRegion2);
                      setCompareRegion2(tmp);
                    }}
                    title="Swap regions"
                    className="p-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition self-center sm:self-auto"
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                  </button>

                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Region B</label>
                    <div className="relative">
                      <select
                        value={compareRegion2}
                        onChange={e => setCompareRegion2(e.target.value)}
                        className="w-full appearance-none py-2.5 pl-3 pr-8 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                      >
                        {wageData.regions.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {comparisonResults && (
                  <div className="space-y-4 pt-3 border-t border-gray-100">
                    {/* Non-Agriculture Cards */}
                    <div>
                      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Non-Agriculture</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {[
                          { r: comparisonResults.r1, w: comparisonResults.w1, barColor: 'bg-blue-600', boxClass: 'bg-blue-50 border-blue-100 text-blue-800' },
                          { r: comparisonResults.r2, w: comparisonResults.w2, barColor: 'bg-indigo-600', boxClass: 'bg-indigo-50 border-indigo-100 text-indigo-800' },
                        ].map(({ r, w, barColor, boxClass }, i) => (
                          <div key={i} className={`p-4 rounded-xl border ${boxClass}`}>
                            <div className="text-xs font-medium opacity-80 mb-1.5 truncate">{r.name}</div>
                            <div className="text-3xl font-bold">₱{w}</div>
                            <div className="w-full h-1.5 bg-white/70 rounded-full mt-3 overflow-hidden">
                              <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${Math.round((w / comparisonResults.maxWage) * 100)}%` }} />
                            </div>
                            <div className="text-[11px] text-gray-500 mt-2 font-mono">{r.wageOrder} · Eff. {r.dateEffective || '—'}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Agriculture + Diff summary */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="text-xs text-gray-500 font-medium">Agriculture Gap</div>
                        <div className="text-lg font-bold text-gray-900 mt-1">
                          ₱{comparisonResults.a1} vs ₱{comparisonResults.a2}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">Diff: ₱{comparisonResults.agriDiff} ({comparisonResults.agriVariance}%)</div>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="text-xs text-gray-500 font-medium">Non-Agri Difference</div>
                        <div className="text-2xl font-bold text-gray-900 mt-1">₱{comparisonResults.diff}</div>
                        <div className="text-xs text-gray-400 mt-0.5">per day</div>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="text-xs text-gray-500 font-medium">Percentage Gap</div>
                        <div className="text-2xl font-bold text-gray-900 mt-1">{comparisonResults.variance}%</div>
                        <div className="text-xs text-gray-400 mt-0.5">relative variance</div>
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Rate Movements</h2>
                <p className="text-sm text-gray-500 mt-0.5">Historical wage adjustments and tranche progressions</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filter movements..."
                  value={movementSearch}
                  onChange={e => setMovementSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
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
                <span className="text-xs text-gray-400">{filteredMovements.length} movements</span>
              </div>
              {filteredMovements.length === 0 ? (
                <div className="p-10 text-center text-sm text-gray-500">No wage movements found.</div>
              ) : (
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
                      {filteredMovements.map((m, i) => {
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
                                {isPos ? '+' : isNeg ? '-' : ''}₱{Math.abs(m.change)} ({isPos ? '+' : ''}{m.changePercent}%)
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
              )}
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
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
                            const na = getSectorRate(reg, 'Non-Agriculture');
                            const ag = getSectorRate(reg, 'Agriculture');
                            return (
                              <tr key={reg.id} className="hover:bg-gray-50 transition">
                                <td className="py-3 px-5 font-medium text-gray-900">{reg.name}</td>
                                <td className="py-3 px-3 font-mono text-xs text-blue-600">{reg.wageOrder}</td>
                                <td className="py-3 px-3 text-xs text-gray-400">{reg.dateEffective || '—'}</td>
                                <td className="py-3 px-3 text-right font-semibold text-gray-900">₱{na.current ?? '—'}</td>
                                <td className="py-3 px-5 text-right font-semibold text-gray-700">₱{ag.current ?? '—'}</td>
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
