import { WageDataResponse, RateMovementsResponse } from './types';

const API_BASE = '/api';

export async function fetchWageData(): Promise<WageDataResponse> {
  const res = await fetch(`${API_BASE}/wages`);
  if (!res.ok) throw new Error('Failed to fetch wage data');
  return res.json();
}

export async function fetchRateMovements(): Promise<RateMovementsResponse> {
  const res = await fetch(`${API_BASE}/rate-movements`);
  if (!res.ok) throw new Error('Failed to fetch rate movements');
  return res.json();
}

export async function checkUpdates() {
  const res = await fetch(`${API_BASE}/check-updates`);
  if (!res.ok) throw new Error('Failed to check updates');
  return res.json();
}

export async function triggerNwpcSync(token: string) {
  const res = await fetch(`${API_BASE}/sync?force=1`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return res.json();
}

export async function adminLogin(username: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return res.json();
}
