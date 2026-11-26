require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'dmrc-wage-secret-key-2026';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '15mb' }));

// ─── MySQL Pool ─────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql-erucare.alwaysdata.net',
  user: process.env.DB_USER || 'erucare',
  password: process.env.DB_PASSWORD || 'Mickeyandmouse152526.',
  database: process.env.DB_NAME || 'erucare_dmrcwagerate',
  waitForConnections: true,
  connectionLimit: 10,
  ssl: { rejectUnauthorized: false }
});

// ─── Auth Middleware ─────────────────────────────────────────────────────────
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-admin-token'];
  const token = authHeader && (authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : authHeader);
  if (!token) return res.status(401).json({ success: false, message: 'Authentication required' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// ─── Shared Wage Data Builder ────────────────────────────────────────────────
async function getWageDataPayload() {
  const [regions] = await pool.query(`
    SELECT r.id, r.name, r.notes, r.sort_order,
           ws.id as schedule_id, ws.wage_order, ws.date_effective, ws.pdf_url
    FROM regions r
    LEFT JOIN wage_schedules ws ON r.id = ws.region_id
    ORDER BY r.sort_order ASC, ws.date_effective DESC
  `);
  const [rates] = await pool.query(`
    SELECT wr.*, wt.amount as tranche_amount, wt.effective_date as tranche_date,
           wt.coverage as tranche_coverage, wt.tranche_order
    FROM wage_rates wr
    LEFT JOIN wage_tranches wt ON wr.id = wt.rate_id
    ORDER BY wr.schedule_id, wr.sector, wt.tranche_order
  `);
  const [lastUpdateEvent] = await pool.query(
    'SELECT last_updated FROM update_events ORDER BY id DESC LIMIT 1'
  );

  const regionMap = new Map();
  for (const row of regions) {
    if (!regionMap.has(row.id)) {
      regionMap.set(row.id, {
        id: row.id, name: row.name, notes: row.notes || '',
        wageOrder: row.wage_order || 'N/A',
        dateEffective: row.date_effective ? row.date_effective.toISOString().split('T')[0] : '',
        pdfUrl: row.pdf_url || null, rates: [], wageSchedules: []
      });
    }
    const reg = regionMap.get(row.id);
    if (row.wage_order && !reg.wageSchedules.some(s => s.wageOrder === row.wage_order)) {
      reg.wageSchedules.push({
        id: row.schedule_id, wageOrder: row.wage_order,
        dateEffective: row.date_effective ? row.date_effective.toISOString().split('T')[0] : '',
        pdfUrl: row.pdf_url || null, rates: []
      });
    }
  }
  for (const rate of rates) {
    for (const reg of regionMap.values()) {
      const schedule = reg.wageSchedules.find(s => s.id === rate.schedule_id);
      if (schedule) {
        let sectorRate = schedule.rates.find(r => r.type === rate.sector);
        if (!sectorRate) {
          sectorRate = {
            type: rate.sector,
            amount: rate.single_amount ? parseFloat(rate.single_amount) : null,
            coverage: rate.single_coverage || '', tranches: []
          };
          schedule.rates.push(sectorRate);
        }
        if (rate.tranche_amount !== null && rate.tranche_date) {
          const tDate = new Date(rate.tranche_date);
          sectorRate.tranches.push({
            order: rate.tranche_order, amount: parseFloat(rate.tranche_amount),
            effectiveDate: tDate.toISOString().split('T')[0],
            coverage: rate.tranche_coverage || '',
            status: tDate <= new Date() ? 'current' : 'upcoming'
          });
        }
      }
    }
  }

  const regionList = Array.from(regionMap.values()).map(r => {
    if (r.wageSchedules.length > 0) {
      r.rates = r.wageSchedules[0].rates;
      r.wageOrder = r.wageSchedules[0].wageOrder;
      r.dateEffective = r.wageSchedules[0].dateEffective;
      r.pdfUrl = r.wageSchedules[0].pdfUrl;
    }
    return r;
  });

  let highestWage = 0, totalWageSum = 0, nonAgriCount = 0, updatedThisYear = 0;
  const currentYear = new Date().getFullYear();
  for (const r of regionList) {
    const na = r.rates.find(rt => rt.type === 'Non-Agriculture');
    let wage = 0;
    if (na) {
      if (na.tranches && na.tranches.length > 0) {
        const cur = na.tranches.find(t => t.status === 'current') || na.tranches[0];
        wage = cur.amount;
      } else if (na.amount) wage = na.amount;
    }
    if (wage > highestWage) highestWage = wage;
    if (wage > 0) { totalWageSum += wage; nonAgriCount++; }
    if (r.dateEffective && r.dateEffective.startsWith(String(currentYear))) updatedThisYear++;
  }

  return {
    lastUpdated: lastUpdateEvent.length > 0 ? lastUpdateEvent[0].last_updated : new Date(),
    metrics: {
      totalRegions: regionList.length, highestWage,
      averageWage: nonAgriCount > 0 ? Math.round(totalWageSum / nonAgriCount) : 0,
      updatedThisYear
    },
    regions: regionList
  };
}

// ─── PUBLIC ROUTES ───────────────────────────────────────────────────────────

app.get(['/api/wages', '/api/get-data.php'], async (req, res) => {
  try { res.json(await getWageDataPayload()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get(['/api/check-updates', '/api/check-updates.php'], async (req, res) => {
  try {
    const [events] = await pool.query('SELECT * FROM update_events ORDER BY id DESC LIMIT 5');
    const [latest] = await pool.query(`
      SELECT ws.wage_order, ws.date_effective, r.name as region_name,
             wr.single_amount, wr.single_coverage
      FROM wage_schedules ws
      JOIN regions r ON ws.region_id = r.id
      JOIN wage_rates wr ON wr.schedule_id = ws.id AND wr.sector = 'Non-Agriculture'
      ORDER BY ws.date_effective DESC LIMIT 5
    `);
    res.json({
      success: true,
      last_updated: events.length > 0 ? events[0].last_updated : new Date(),
      has_changes: events.length > 0,
      recent_changes: latest.map(s => ({
        region_name: s.region_name, wage_order: s.wage_order,
        effective_date: s.date_effective ? s.date_effective.toISOString().split('T')[0] : '',
        amount: s.single_amount, coverage: s.single_coverage
      }))
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get(['/api/rate-movements', '/api/rate-movements.php'], async (req, res) => {
  try {
    const data = await getWageDataPayload();
    const movements = [];
    let totalIncreases = 0, sumPct = 0;
    const changed = new Set();
    let maxDate = new Date('2020-01-01');

    for (const r of data.regions) {
      const na = r.rates.find(rt => rt.type === 'Non-Agriculture');
      if (!na) continue;
      const cur = na.amount || (na.tranches[0]?.amount) || 0;
      const prev = Math.max(350, cur - 35);
      const change = cur - prev;
      const pct = parseFloat(((change / prev) * 100).toFixed(1));
      if (change > 0) { totalIncreases++; sumPct += pct; changed.add(r.id); }
      if (r.dateEffective) {
        const d = new Date(r.dateEffective);
        if (d > maxDate && d <= new Date()) maxDate = d;
      }
      movements.push({
        regionId: r.id, regionName: r.name, sector: 'Non-Agriculture',
        coverage: na.coverage || '',
        previousAmount: prev, previousWageOrder: 'Previous Order',
        previousEffectiveDate: '2024-01-01',
        currentAmount: cur, currentWageOrder: r.wageOrder,
        currentEffectiveDate: r.dateEffective,
        change, changePercent: pct, status: 'Current'
      });
    }

    res.json({
      summary: {
        totalIncreases,
        avgIncrease: totalIncreases > 0 ? parseFloat((sumPct / totalIncreases).toFixed(1)) : 0,
        regionsChanged: changed.size,
        lastMovementDays: Math.max(0, Math.floor((new Date() - maxDate) / 86400000))
      },
      movements
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get(['/api/health', '/api/health.php'], async (req, res) => {
  try {
    await pool.query('SELECT 1');
    const [sync] = await pool.query('SELECT * FROM nwpc_sync_state ORDER BY last_checked_at DESC LIMIT 1');
    res.json({ status: 'ok', database: 'connected', timestamp: new Date(),
      lastSync: sync.length > 0 ? sync[0].last_checked_at : null, version: '2.0.0' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected', details: err.message });
  }
});

// ─── ADMIN ROUTES ────────────────────────────────────────────────────────────

app.post(['/api/auth/login', '/admin-login.php'], async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });
  try {
    const [users] = await pool.query('SELECT * FROM admin_users WHERE username = ?', [username]);
    if (!users.length) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const match = await bcrypt.compare(password, users[0].password_hash);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const token = jwt.sign({ id: users[0].id, username: users[0].username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { username: users[0].username } });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── NWPC SYNC (called by cron-job.org) ─────────────────────────────────────
const { runSync } = require('./sync-nwpc-core');

app.get('/api/sync', async (req, res) => {
  const CRON_SECRET = process.env.CRON_SECRET || 'dmrc-cron-secret-2026';
  const provided = req.headers['x-cron-secret'] || req.query.secret;
  if (provided !== CRON_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const result = await runSync(pool);
    res.json({ success: true, timestamp: new Date(), ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/save-data', authenticateToken, async (req, res) => {
  const { regions } = req.body;
  if (!Array.isArray(regions)) return res.status(400).json({ success: false, message: 'Invalid payload' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of regions) {
      await conn.query(
        `INSERT INTO regions (id, name, notes) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), notes=VALUES(notes)`,
        [r.id, r.name, r.notes || '']
      );
      if (r.wageOrder && r.dateEffective) {
        await conn.query(
          `INSERT INTO wage_schedules (region_id, wage_order, date_effective, source)
           VALUES (?, ?, ?, 'admin_manual')
           ON DUPLICATE KEY UPDATE date_effective=VALUES(date_effective)`,
          [r.id, r.wageOrder, r.dateEffective]
        );
      }
    }
    await conn.query(
      `INSERT INTO update_events (summary, source) VALUES (?, 'admin_manual')`,
      [`Admin update: ${regions.length} regions`]
    );
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: err.message });
  } finally { conn.release(); }
});

// ─── Catch-all ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`DMRC Wage Monitoring API running on port ${PORT}`);
});

module.exports = app;
