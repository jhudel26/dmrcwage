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
  Filter,
  Download,
  Upload,
  RefreshCw,
  X,
  ExternalLink,
  ChevronRight,
  ArrowRight,
  CheckCircle2,
  Layers,
  FileSpreadsheet,
  FileText,
  LogOut,
  Edit,
  AlertCircle
} from 'lucide-react';
import { Region, WageDataResponse, RateMovementsResponse } from './types';
import { fetchWageData, fetchRateMovements, checkUpdates, adminLogin, triggerNwpcSync, saveWageData } from './api';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

export default function App() {
  // Preloader State
  const [loading, setLoading] = useState(true);
  const [loadStep, setLoadStep] = useState(0);
  const [loadProgress, setLoadProgress] = useState(15);

  // Core Data States
  const [wageData, setWageData] = useState<WageDataResponse | null>(null);
  const [movementsData, setMovementsData] = useState<RateMovementsResponse | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'wages' | 'compare' | 'movements' | 'admin'>('dashboard');

  // Search & Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState<'az' | 'za' | 'highest' | 'lowest'>('az');
  const [sectorFilter, setSectorFilter] = useState<'all' | 'Non-Agriculture' | 'Agriculture'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Modal & Selection States
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateDetails, setUpdateDetails] = useState<any[]>([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Compare Tool States
  const [compareRegion1, setCompareRegion1] = useState<string>('ncr');
  const [compareRegion2, setCompareRegion2] = useState<string>('region4a');

  // Admin States
  const [adminToken, setAdminToken] = useState<string | null>(localStorage.getItem('dmrc-admin-token'));
  const [adminUser, setAdminUser] = useState<string | null>(localStorage.getItem('dmrc-admin-user'));
  const [loginUsername, setLoginUsername] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [editingRegion, setEditingRegion] = useState<Region | null>(null);

  // Preloader Simulation & Initial Load
  useEffect(() => {
    const runLoader = async () => {
      setLoadStep(1); setLoadProgress(30);
      try {
        const data = await fetchWageData();
        setWageData(data);
        setLoadStep(2); setLoadProgress(70);

        const movements = await fetchRateMovements();
        setMovementsData(movements);
        setLoadStep(3); setLoadProgress(90);

        // Check for updates
        const updateCheck = await checkUpdates();
        const lastSeen = localStorage.getItem('lastSeenRateUpdate');
        if (updateCheck.has_changes && updateCheck.last_updated !== lastSeen) {
          setUpdateDetails(updateCheck.recent_changes || []);
          setShowUpdateModal(true);
        }

        setLoadStep(4); setLoadProgress(100);
        setTimeout(() => setLoading(false), 400);
      } catch (err) {
        console.error('Initialization error:', err);
        setLoading(false);
      }
    };

    runLoader();
  }, []);

  const acknowledgeUpdates = () => {
    if (wageData) {
      localStorage.setItem('lastSeenRateUpdate', wageData.lastUpdated);
    }
    setShowUpdateModal(false);
  };

  // Filtered & Sorted Regions
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
      const getNonAgriWage = (reg: Region) => {
        const rate = reg.rates.find(rt => rt.type === 'Non-Agriculture');
        return rate ? (rate.amount || (rate.tranches[0]?.amount) || 0) : 0;
      };

      if (sortOption === 'az') return a.name.localeCompare(b.name);
      if (sortOption === 'za') return b.name.localeCompare(a.name);
      if (sortOption === 'highest') return getNonAgriWage(b) - getNonAgriWage(a);
      if (sortOption === 'lowest') return getNonAgriWage(a) - getNonAgriWage(b);
      return 0;
    });

    return list;
  }, [wageData, searchTerm, sortOption, sectorFilter]);

  // Chart Data: Top 10 Regions by Wage
  const chartData = useMemo(() => {
    if (!wageData) return { labels: [], datasets: [] };
    const sorted = [...wageData.regions]
      .map(r => {
        const rate = r.rates.find(rt => rt.type === 'Non-Agriculture');
        const wage = rate ? (rate.amount || rate.tranches[0]?.amount || 0) : 0;
        return { name: r.name.replace(/\(.*\)/, '').trim(), wage };
      })
      .sort((a, b) => b.wage - a.wage)
      .slice(0, 10);

    return {
      labels: sorted.map(s => s.name),
      datasets: [
        {
          label: 'Daily Minimum Wage (₱)',
          data: sorted.map(s => s.wage),
          backgroundColor: 'rgba(37, 99, 235, 0.85)',
          borderColor: '#1d4ed8',
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  }, [wageData]);

  // Comparison Calculations
  const comparisonResults = useMemo(() => {
    if (!wageData) return null;
    const r1 = wageData.regions.find(r => r.id === compareRegion1);
    const r2 = wageData.regions.find(r => r.id === compareRegion2);
    if (!r1 || !r2) return null;

    const getWage = (r: Region) => {
      const rt = r.rates.find(rate => rate.type === 'Non-Agriculture');
      return rt ? (rt.amount || rt.tranches[0]?.amount || 0) : 0;
    };

    const w1 = getWage(r1);
    const w2 = getWage(r2);
    const diff = Math.abs(w1 - w2);
    const minW = Math.min(w1, w2) || 1;
    const variance = ((diff / minW) * 100).toFixed(1);

    return { r1, r2, w1, w2, diff, variance };
  }, [wageData, compareRegion1, compareRegion2]);

  // Admin Handlers
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
        setLoginError(res.message || 'Invalid username or password');
      }
    } catch (err: any) {
      setLoginError(err.message || 'Login failed');
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
    setSyncMessage('Fetching and synchronizing latest wage orders from NWPC DOLE...');
    try {
      const res = await triggerNwpcSync(adminToken);
      if (res.success) {
        setSyncMessage('NWPC Synchronization completed successfully!');
        const fresh = await fetchWageData();
        setWageData(fresh);
        const freshMov = await fetchRateMovements();
        setMovementsData(freshMov);
      } else {
        setSyncMessage(`Sync failed: ${res.error}`);
      }
    } catch (err: any) {
      setSyncMessage(`Error: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Export Handlers
  const handleExportJSON = () => {
    if (!wageData) return;
    const blob = new Blob([JSON.stringify(wageData.regions, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dmrc-wage-rates-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  const handleExportExcel = () => {
    if (!wageData) return;
    const rows = wageData.regions.map(r => {
      const nonAgri = r.rates.find(rt => rt.type === 'Non-Agriculture');
      const agri = r.rates.find(rt => rt.type === 'Agriculture');
      return {
        'Region ID': r.id,
        'Region Name': r.name,
        'Wage Order': r.wageOrder,
        'Date Effective': r.dateEffective,
        'Non-Agriculture Rate (₱)': nonAgri?.amount || nonAgri?.tranches[0]?.amount || '',
        'Non-Agriculture Coverage': nonAgri?.coverage || '',
        'Agriculture Rate (₱)': agri?.amount || agri?.tranches[0]?.amount || '',
        'Agriculture Coverage': agri?.coverage || '',
        'Notes': r.notes
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Wage Rates');
    XLSX.writeFile(workbook, `dmrc-wage-rates-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportCSV = () => {
    if (!wageData) return;
    const rows = wageData.regions.map(r => {
      const nonAgri = r.rates.find(rt => rt.type === 'Non-Agriculture');
      const agri = r.rates.find(rt => rt.type === 'Agriculture');
      return {
        id: r.id,
        name: `"${r.name.replace(/"/g, '""')}"`,
        wageOrder: r.wageOrder,
        dateEffective: r.dateEffective,
        nonAgri: nonAgri?.amount || nonAgri?.tranches[0]?.amount || '',
        agri: agri?.amount || agri?.tranches[0]?.amount || '',
        notes: `"${r.notes.replace(/"/g, '""')}"`
      };
    });

    let csv = 'Region ID,Region Name,Wage Order,Date Effective,Non-Agriculture Rate,Agriculture Rate,Notes\n';
    rows.forEach(r => {
      csv += `${r.id},${r.name},${r.wageOrder},${r.dateEffective},${r.nonAgri},${r.agri},${r.notes}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dmrc-wage-rates-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  // Preloader Screen
  if (loading) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center text-white z-50 p-6">
        <div className="w-20 h-20 mb-6 relative">
          <div className="absolute inset-0 border-4 border-blue-500/30 rounded-full animate-ping"></div>
          <div className="w-full h-full bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/50">
            <Building2 className="w-10 h-10 text-white" />
          </div>
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">DMRC Wage Monitoring</h1>
        <p className="text-sm text-slate-400 mb-8">Connecting to Alwaysdata & Synchronizing NWPC Rates</p>

        <div className="w-full max-w-md bg-slate-800 rounded-full h-2.5 mb-6 overflow-hidden border border-slate-700">
          <div
            className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
            style={{ width: `${loadProgress}%` }}
          ></div>
        </div>

        <div className="space-y-2 text-sm text-slate-400 max-w-sm w-full">
          <div className="flex items-center justify-between">
            <span>Loading system configuration</span>
            {loadStep >= 1 && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          </div>
          <div className="flex items-center justify-between">
            <span>Fetching wage database from Alwaysdata</span>
            {loadStep >= 2 && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          </div>
          <div className="flex items-center justify-between">
            <span>Validating regional wage orders & tranches</span>
            {loadStep >= 3 && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          </div>
          <div className="flex items-center justify-between">
            <span>Finalizing dashboard setup</span>
            {loadStep >= 4 && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
      {/* Rate Change Notification Modal */}
      {showUpdateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in duration-200">
            <div className="bg-blue-600 p-5 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/40 rounded-xl">
                  <TrendingUp className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-lg leading-snug">New Wage Rate Updates</h3>
                  <p className="text-xs text-blue-100">Automatically synced from NWPC - DOLE</p>
                </div>
              </div>
              <button onClick={acknowledgeUpdates} className="text-blue-100 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              <p className="text-sm text-slate-600">
                The system has detected new or updated minimum wage orders issued by Regional Boards:
              </p>
              <div className="space-y-3">
                {updateDetails.map((item, idx) => (
                  <div key={idx} className="p-3 bg-blue-50/70 rounded-xl border border-blue-100 flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-sm text-blue-950">{item.region_name}</div>
                      <div className="text-xs text-slate-500">Order: <span className="font-mono font-medium text-slate-700">{item.wage_order}</span></div>
                      <div className="text-xs text-slate-500">Effective: {item.effective_date}</div>
                    </div>
                    {item.amount && (
                      <div className="text-right">
                        <div className="text-base font-bold text-blue-700">₱{item.amount}</div>
                        <div className="text-[10px] text-slate-500 uppercase">Non-Agri</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                onClick={acknowledgeUpdates}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-sm transition"
              >
                Acknowledge & Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3D Flip / Detail Card Modal */}
      {selectedRegion && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden border border-slate-200">
            <div className="bg-slate-900 p-6 text-white flex items-start justify-between">
              <div>
                <span className="inline-block px-2.5 py-1 bg-blue-600/30 text-blue-400 text-xs font-semibold rounded-lg mb-2">
                  {selectedRegion.wageOrder}
                </span>
                <h3 className="font-bold text-xl leading-snug">{selectedRegion.name}</h3>
                <p className="text-xs text-slate-400 mt-1">Effective Date: {selectedRegion.dateEffective || 'Published'}</p>
              </div>
              <button onClick={() => setSelectedRegion(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
              {/* Sector Rates Breakdown */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {selectedRegion.rates.map((rate, rIdx) => (
                  <div key={rIdx} className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">{rate.type}</div>
                    <div className="text-2xl font-black text-slate-900">
                      ₱{rate.amount || rate.tranches[0]?.amount || 'TBA'}
                    </div>
                    <div className="text-xs text-slate-600 mt-2 line-clamp-2">{rate.coverage}</div>

                    {/* Tranche schedule if multi-tranche */}
                    {rate.tranches && rate.tranches.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-200 space-y-1.5">
                        <div className="text-[11px] font-semibold text-slate-700">Tranche Schedule:</div>
                        {rate.tranches.map((tr, tIdx) => (
                          <div key={tIdx} className="flex justify-between text-xs">
                            <span className="text-slate-500">Tranche {tr.order} ({tr.effectiveDate}):</span>
                            <span className="font-bold text-slate-800">₱{tr.amount}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Coverage Area Notes */}
              {selectedRegion.notes && (
                <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-100 text-xs text-slate-700">
                  <div className="font-bold text-blue-900 mb-1">Coverage & Jurisdictions:</div>
                  <p className="leading-relaxed">{selectedRegion.notes}</p>
                </div>
              )}

              {/* NWPC Official PDF Download */}
              {selectedRegion.pdfUrl && (
                <div className="flex justify-between items-center p-3.5 bg-slate-100 rounded-xl">
                  <div className="text-xs font-medium text-slate-700 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-600" />
                    Official NWPC Wage Order PDF
                  </div>
                  <a
                    href={selectedRegion.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
                  >
                    Download <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setSelectedRegion(null)}
                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold rounded-xl transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                DMRC Regional Minimum Wage Monitoring
              </h1>
              <p className="text-[11px] text-slate-500 flex items-center gap-2">
                <span>Based on NWPC - DOLE Wage Orders</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                <span className="text-emerald-600 font-medium">Live Alwaysdata DB</span>
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setCurrentView('dashboard')}
              className={`px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition flex items-center gap-1.5 ${
                currentView === 'dashboard'
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </button>
            <button
              onClick={() => setCurrentView('wages')}
              className={`px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition flex items-center gap-1.5 ${
                currentView === 'wages'
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Wage Rates</span>
            </button>
            <button
              onClick={() => setCurrentView('compare')}
              className={`px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition flex items-center gap-1.5 ${
                currentView === 'compare'
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Scale className="w-4 h-4" />
              <span className="hidden sm:inline">Compare</span>
            </button>
            <button
              onClick={() => setCurrentView('movements')}
              className={`px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition flex items-center gap-1.5 ${
                currentView === 'movements'
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">Rate Movements</span>
            </button>
            <button
              onClick={() => setCurrentView('admin')}
              className={`px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition flex items-center gap-1.5 ${
                currentView === 'admin'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Admin</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Dismissible Banner */}
        {!bannerDismissed && (
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-4 text-white shadow-md flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                <AlertCircle className="w-5 h-5 text-white" />
              </div>
              <div className="text-xs sm:text-sm">
                <span className="font-bold">Automated Synchronization Active: </span>
                <span>Regional statutory minimum wage orders are continuously pulled directly from NWPC DOLE into Alwaysdata.</span>
              </div>
            </div>
            <button onClick={() => setBannerDismissed(true)} className="text-white/80 hover:text-white p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* -------------------------------------------------------------------------------- */}
        {/* VIEW 1: DASHBOARD */}
        {/* -------------------------------------------------------------------------------- */}
        {currentView === 'dashboard' && wageData && (
          <div className="space-y-6">
            {/* 4 Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Regions</div>
                <div className="text-3xl font-black text-slate-900 mt-2">{wageData.metrics.totalRegions}</div>
                <div className="text-xs text-slate-500 mt-1">Philippine Administrative Zones</div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Highest Wage</div>
                <div className="text-3xl font-black text-blue-600 mt-2">₱{wageData.metrics.highestWage}</div>
                <div className="text-xs text-slate-500 mt-1">NCR (Non-Agriculture)</div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Average Wage</div>
                <div className="text-3xl font-black text-indigo-600 mt-2">₱{wageData.metrics.averageWage}</div>
                <div className="text-xs text-slate-500 mt-1">National Non-Agri Mean</div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Updated This Year</div>
                <div className="text-3xl font-black text-emerald-600 mt-2">{wageData.metrics.updatedThisYear}</div>
                <div className="text-xs text-slate-500 mt-1">Active Wage Orders</div>
              </div>
            </div>

            {/* Chart + Recent Updates */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Bar Chart */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-900 mb-4 text-base">Top 10 Regions by Minimum Wage</h3>
                <div className="h-72">
                  <Bar
                    data={chartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        y: { beginAtZero: false, min: 400, max: 800 }
                      }
                    }}
                  />
                </div>
              </div>

              {/* Recent Updates Table */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 mb-4 text-base">Recent Wage Order Updates</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase">
                          <th className="py-2.5">Region</th>
                          <th className="py-2.5">Wage Order</th>
                          <th className="py-2.5">Effective</th>
                          <th className="py-2.5 text-right">Non-Agri</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {wageData.regions.slice(0, 7).map((r, idx) => {
                          const nonAgri = r.rates.find(rt => rt.type === 'Non-Agriculture');
                          return (
                            <tr
                              key={idx}
                              onClick={() => setSelectedRegion(r)}
                              className="hover:bg-blue-50/50 cursor-pointer transition"
                            >
                              <td className="py-2.5 font-medium text-slate-800 pr-2">{r.name.replace(/\(.*\)/, '')}</td>
                              <td className="py-2.5 font-mono text-slate-600">{r.wageOrder}</td>
                              <td className="py-2.5 text-slate-500">{r.dateEffective || 'Published'}</td>
                              <td className="py-2.5 font-bold text-right text-blue-600">
                                ₱{nonAgri?.amount || nonAgri?.tranches[0]?.amount || 'TBA'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="pt-4 border-t border-slate-100 text-right">
                  <button
                    onClick={() => setCurrentView('wages')}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                  >
                    View all 23 regions <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------------------------- */}
        {/* VIEW 2: WAGE RATES (GRID & LIST) */}
        {/* -------------------------------------------------------------------------------- */}
        {currentView === 'wages' && (
          <div className="space-y-6">
            {/* Filter Bar */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search regions, cities, orders..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
                {/* Sector Filter */}
                <select
                  value={sectorFilter}
                  onChange={(e: any) => setSectorFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none"
                >
                  <option value="all">All Sectors</option>
                  <option value="Non-Agriculture">Non-Agriculture</option>
                  <option value="Agriculture">Agriculture</option>
                </select>

                {/* Sort Option */}
                <select
                  value={sortOption}
                  onChange={(e: any) => setSortOption(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none"
                >
                  <option value="az">Region A - Z</option>
                  <option value="za">Region Z - A</option>
                  <option value="highest">Highest Wage First</option>
                  <option value="lowest">Lowest Wage First</option>
                </select>

                {/* View Mode Toggle */}
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      viewMode === 'grid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Grid
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    List
                  </button>
                </div>
              </div>
            </div>

            {/* Grid View */}
            {viewMode === 'grid' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredRegions.map((region) => {
                  const nonAgri = region.rates.find(rt => rt.type === 'Non-Agriculture');
                  const agri = region.rates.find(rt => rt.type === 'Agriculture');

                  return (
                    <div
                      key={region.id}
                      onClick={() => setSelectedRegion(region)}
                      className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-blue-300 transition cursor-pointer flex flex-col justify-between group"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-[11px] font-bold rounded-lg font-mono">
                            {region.wageOrder}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {region.dateEffective ? `Eff: ${region.dateEffective}` : 'Published'}
                          </span>
                        </div>
                        <h4 className="font-bold text-slate-900 text-base group-hover:text-blue-600 transition">
                          {region.name}
                        </h4>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{region.notes || 'No area restrictions.'}</p>
                      </div>

                      <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 gap-2">
                        <div className="p-2.5 bg-slate-50 rounded-xl">
                          <div className="text-[10px] font-bold text-slate-500 uppercase">Non-Agriculture</div>
                          <div className="text-lg font-extrabold text-blue-600 mt-0.5">
                            ₱{nonAgri?.amount || nonAgri?.tranches[0]?.amount || 'TBA'}
                          </div>
                        </div>
                        <div className="p-2.5 bg-slate-50 rounded-xl">
                          <div className="text-[10px] font-bold text-slate-500 uppercase">Agriculture</div>
                          <div className="text-lg font-extrabold text-slate-800 mt-0.5">
                            ₱{agri?.amount || agri?.tranches[0]?.amount || 'TBA'}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* List View */}
            {viewMode === 'list' && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-bold">
                      <tr>
                        <th className="py-3 px-4">Region</th>
                        <th className="py-3 px-3">Wage Order</th>
                        <th className="py-3 px-3">Effective Date</th>
                        <th className="py-3 px-3 text-right">Non-Agri (₱)</th>
                        <th className="py-3 px-3 text-right">Agri (₱)</th>
                        <th className="py-3 px-4">Jurisdictions</th>
                        <th className="py-3 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredRegions.map((region) => {
                        const nonAgri = region.rates.find(rt => rt.type === 'Non-Agriculture');
                        const agri = region.rates.find(rt => rt.type === 'Agriculture');

                        return (
                          <tr key={region.id} className="hover:bg-blue-50/40 transition">
                            <td className="py-3 px-4 font-semibold text-slate-900">{region.name}</td>
                            <td className="py-3 px-3 font-mono text-slate-700">{region.wageOrder}</td>
                            <td className="py-3 px-3 text-slate-500">{region.dateEffective || 'Published'}</td>
                            <td className="py-3 px-3 text-right font-bold text-blue-600">
                              ₱{nonAgri?.amount || nonAgri?.tranches[0]?.amount || 'TBA'}
                            </td>
                            <td className="py-3 px-3 text-right font-bold text-slate-800">
                              ₱{agri?.amount || agri?.tranches[0]?.amount || 'TBA'}
                            </td>
                            <td className="py-3 px-4 text-slate-500 max-w-xs truncate">{region.notes}</td>
                            <td className="py-3 px-3 text-center">
                              <button
                                onClick={() => setSelectedRegion(region)}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-lg text-xs font-semibold transition"
                              >
                                View
                              </button>
                            </td>
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

        {/* -------------------------------------------------------------------------------- */}
        {/* VIEW 3: COMPARE REGIONS */}
        {/* -------------------------------------------------------------------------------- */}
        {currentView === 'compare' && wageData && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm max-w-3xl mx-auto">
              <h3 className="font-bold text-slate-900 text-lg mb-2">Wage Comparison Tool</h3>
              <p className="text-xs text-slate-500 mb-6">Compare statutory minimum wages between any two Philippine administrative regions.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Region 1</label>
                  <select
                    value={compareRegion1}
                    onChange={(e) => setCompareRegion1(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800"
                  >
                    {wageData.regions.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Region 2</label>
                  <select
                    value={compareRegion2}
                    onChange={(e) => setCompareRegion2(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800"
                  >
                    {wageData.regions.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {comparisonResults && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-100 text-center">
                      <div className="text-xs font-bold text-blue-900 mb-1">{comparisonResults.r1.name}</div>
                      <div className="text-3xl font-black text-blue-700">₱{comparisonResults.w1}</div>
                      <div className="text-xs text-slate-500 mt-1">{comparisonResults.r1.wageOrder}</div>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center">
                      <div className="text-xs font-bold text-slate-900 mb-1">{comparisonResults.r2.name}</div>
                      <div className="text-3xl font-black text-slate-800">₱{comparisonResults.w2}</div>
                      <div className="text-xs text-slate-500 mt-1">{comparisonResults.r2.wageOrder}</div>
                    </div>
                  </div>

                  {/* Variance Card */}
                  <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-emerald-900">Absolute Wage Difference</div>
                      <div className="text-2xl font-black text-emerald-700">₱{comparisonResults.diff} / day</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-emerald-900">Variance Percentage</div>
                      <div className="text-2xl font-black text-emerald-700">{comparisonResults.variance}%</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------------------------- */}
        {/* VIEW 4: RATE MOVEMENTS */}
        {/* -------------------------------------------------------------------------------- */}
        {currentView === 'movements' && movementsData && (
          <div className="space-y-6">
            {/* 4 Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-500 uppercase">Total Increases</div>
                <div className="text-3xl font-black text-emerald-600 mt-2">{movementsData.summary.totalIncreases}</div>
                <div className="text-xs text-slate-500 mt-1">Recorded Wage Movements</div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-500 uppercase">Avg. Increase</div>
                <div className="text-3xl font-black text-blue-600 mt-2">{movementsData.summary.avgIncrease}%</div>
                <div className="text-xs text-slate-500 mt-1">Average Growth Rate</div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-500 uppercase">Regions Changed</div>
                <div className="text-3xl font-black text-indigo-600 mt-2">{movementsData.summary.regionsChanged}</div>
                <div className="text-xs text-slate-500 mt-1">Active Adjustments</div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold text-slate-500 uppercase">Last Movement</div>
                <div className="text-3xl font-black text-slate-800 mt-2">{movementsData.summary.lastMovementDays}d ago</div>
                <div className="text-xs text-slate-500 mt-1">Days since effectivity</div>
              </div>
            </div>

            {/* Movements Audit Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-200 font-bold text-sm text-slate-800">
                Rate Movements & Baseline Comparisons
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-bold">
                    <tr>
                      <th className="py-3 px-4">Region</th>
                      <th className="py-3 px-3">Sector</th>
                      <th className="py-3 px-3 text-right">Previous (₱)</th>
                      <th className="py-3 px-3 text-right">Current (₱)</th>
                      <th className="py-3 px-3 text-right">Change (₱)</th>
                      <th className="py-3 px-3 text-right">Change (%)</th>
                      <th className="py-3 px-3">Effective Date</th>
                      <th className="py-3 px-3">Wage Order</th>
                      <th className="py-3 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {movementsData.movements.map((m, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition">
                        <td className="py-3 px-4 font-semibold text-slate-900">{m.regionName}</td>
                        <td className="py-3 px-3 text-slate-600">{m.sector}</td>
                        <td className="py-3 px-3 text-right text-slate-500">₱{m.previousAmount}</td>
                        <td className="py-3 px-3 text-right font-bold text-blue-700">₱{m.currentAmount}</td>
                        <td className="py-3 px-3 text-right font-bold text-emerald-600">+₱{m.change}</td>
                        <td className="py-3 px-3 text-right font-bold text-emerald-600">+{m.changePercent}%</td>
                        <td className="py-3 px-3 text-slate-500">{m.currentEffectiveDate}</td>
                        <td className="py-3 px-3 font-mono text-slate-700">{m.currentWageOrder}</td>
                        <td className="py-3 px-3 text-center">
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold">
                            {m.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------------------------- */}
        {/* VIEW 5: ADMIN CMS */}
        {/* -------------------------------------------------------------------------------- */}
        {currentView === 'admin' && (
          <div className="space-y-6">
            {!adminToken ? (
              /* Admin Login Form */
              <div className="max-w-md mx-auto bg-white p-8 rounded-2xl border border-slate-200 shadow-md">
                <div className="text-center mb-6">
                  <div className="w-12 h-12 bg-slate-900 text-white rounded-2xl mx-auto flex items-center justify-center mb-3 shadow">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-lg text-slate-900">Admin Authentication</h3>
                  <p className="text-xs text-slate-500 mt-1">Log in to manage Alwaysdata wage records and triggers</p>
                </div>

                {loginError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl mb-4">
                    {loginError}
                  </div>
                )}

                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Username</label>
                    <input
                      type="text"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Enter password (e.g. jayjayjhudel)"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm rounded-xl shadow transition"
                  >
                    Log In as Admin
                  </button>
                </form>
              </div>
            ) : (
              /* Authenticated Admin Dashboard */
              <div className="space-y-6">
                <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono">
                        Logged in as {adminUser}
                      </span>
                    </div>
                    <h3 className="text-xl font-bold mt-1">DMRC Administrative Control Panel</h3>
                    <p className="text-xs text-slate-400 mt-1">Database: erucare_dmrcwagerate @ mysql-erucare.alwaysdata.net</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleManualSync}
                      disabled={isSyncing}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow flex items-center gap-2 transition"
                    >
                      <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                      {isSyncing ? 'Syncing...' : 'Sync NWPC Rates Now'}
                    </button>
                    <button
                      onClick={handleLogout}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl flex items-center gap-1.5 transition"
                    >
                      <LogOut className="w-4 h-4" /> Logout
                    </button>
                  </div>
                </div>

                {syncMessage && (
                  <div className="p-4 bg-blue-50 border border-blue-200 text-blue-900 text-xs rounded-xl flex items-center justify-between">
                    <span>{syncMessage}</span>
                    <button onClick={() => setSyncMessage('')}><X className="w-4 h-4" /></button>
                  </div>
                )}

                {/* Import / Export Controls */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <h4 className="font-bold text-slate-900 text-sm mb-4">Data Import & Export (Parity with DMRC PHP)</h4>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={handleExportExcel}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-sm transition"
                    >
                      <FileSpreadsheet className="w-4 h-4" /> Download Excel (.xlsx)
                    </button>
                    <button
                      onClick={handleExportCSV}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-sm transition"
                    >
                      <FileText className="w-4 h-4" /> Download CSV (.csv)
                    </button>
                    <button
                      onClick={handleExportJSON}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-sm transition"
                    >
                      <Download className="w-4 h-4" /> Download JSON (.json)
                    </button>
                  </div>
                </div>

                {/* Regions CMS Table */}
                {wageData && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-200 font-bold text-sm text-slate-800 flex justify-between items-center">
                      <span>Regional Wage Records ({wageData.regions.length} entries)</span>
                      <span className="text-xs font-normal text-slate-500">Last Synced: {new Date(wageData.lastUpdated).toLocaleString()}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-bold">
                          <tr>
                            <th className="py-3 px-4">ID</th>
                            <th className="py-3 px-4">Region Name</th>
                            <th className="py-3 px-3">Wage Order</th>
                            <th className="py-3 px-3">Effective Date</th>
                            <th className="py-3 px-3 text-right">Non-Agri (₱)</th>
                            <th className="py-3 px-3 text-right">Agri (₱)</th>
                            <th className="py-3 px-3 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {wageData.regions.map((reg) => {
                            const nonAgri = reg.rates.find(rt => rt.type === 'Non-Agriculture');
                            const agri = reg.rates.find(rt => rt.type === 'Agriculture');
                            return (
                              <tr key={reg.id} className="hover:bg-slate-50 transition">
                                <td className="py-3 px-4 font-mono font-medium text-slate-500">{reg.id}</td>
                                <td className="py-3 px-4 font-semibold text-slate-900">{reg.name}</td>
                                <td className="py-3 px-3 font-mono text-blue-700">{reg.wageOrder}</td>
                                <td className="py-3 px-3 text-slate-500">{reg.dateEffective || 'Published'}</td>
                                <td className="py-3 px-3 text-right font-bold text-slate-900">
                                  ₱{nonAgri?.amount || nonAgri?.tranches[0]?.amount || 'TBA'}
                                </td>
                                <td className="py-3 px-3 text-right font-bold text-slate-800">
                                  ₱{agri?.amount || agri?.tranches[0]?.amount || 'TBA'}
                                </td>
                                <td className="py-3 px-3 text-center">
                                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-bold">
                                    Active
                                  </span>
                                </td>
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

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-12 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 space-y-1">
          <p className="font-semibold text-slate-700">DMRC Regional Minimum Wage Monitoring System 2.0</p>
          <p>Autonomous Node.js & React Platform • Connected to Alwaysdata MySQL • Automated NWPC DOLE Synchronization</p>
        </div>
      </footer>
    </div>
  );
}
