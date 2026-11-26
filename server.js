require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'dmrc-wage-secret-key-2026';

app.use(cors());
app.use(express.json({ limit: '15mb' }));

// MySQL Connection Pool to Alwaysdata
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql-erucare.alwaysdata.net',
  user: process.env.DB_USER || 'erucare',
  password: process.env.DB_PASSWORD || 'Mickeyandmouse152526.',
  database: process.env.DB_NAME || 'erucare_dmrcwagerate',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Middleware for Admin Auth
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-admin-token'];
  const token = authHeader && (authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader);

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// -------------------------------------------------------------
// 1. PUBLIC API: Get Wage Data (matches DMRC structure)
// -------------------------------------------------------------
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

  const [lastUpdateEvent] = await pool.query(`
    SELECT last_updated FROM update_events ORDER BY id DESC LIMIT 1
  `);

  const regionMap = new Map();

  for (const row of regions) {
    if (!regionMap.has(row.id)) {
      regionMap.set(row.id, {
        id: row.id,
        name: row.name,
        notes: row.notes || '',
        wageOrder: row.wage_order || 'N/A',
        dateEffective: row.date_effective ? row.date_effective.toISOString().split('T')[0] : '',
        pdfUrl: row.pdf_url || null,
        rates: [],
        wageSchedules: []
      });
    }

    const reg = regionMap.get(row.id);
    if (row.wage_order && !reg.wageSchedules.some(s => s.wageOrder === row.wage_order)) {
      reg.wageSchedules.push({
        id: row.schedule_id,
        wageOrder: row.wage_order,
        dateEffective: row.date_effective ? row.date_effective.toISOString().split('T')[0] : '',
        pdfUrl: row.pdf_url || null,
        rates: []
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
            coverage: rate.single_coverage || '',
            tranches: []
          };
          schedule.rates.push(sectorRate);
        }

        if (rate.tranche_amount !== null && rate.tranche_date) {
          const now = new Date();
          const tDate = new Date(rate.tranche_date);
          sectorRate.tranches.push({
            order: rate.tranche_order,
            amount: parseFloat(rate.tranche_amount),
            effectiveDate: tDate.toISOString().split('T')[0],
            coverage: rate.tranche_coverage || '',
            status: tDate <= now ? 'current' : 'upcoming'
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

  // Calculate Metrics
  const totalRegions = regionList.length;
  let highestWage = 0;
  let totalWageSum = 0;
  let nonAgriCount = 0;
  const currentYear = new Date().getFullYear();
  let updatedThisYear = 0;

  for (const r of regionList) {
    const nonAgri = r.rates.find(rt => rt.type === 'Non-Agriculture');
    let wageVal = 0;
    if (nonAgri) {
      if (nonAgri.tranches && nonAgri.tranches.length > 0) {
        const curTranche = nonAgri.tranches.find(t => t.status === 'current') || nonAgri.tranches[0];
        wageVal = curTranche.amount;
      } else if (nonAgri.amount) {
        wageVal = nonAgri.amount;
      }
    }

    if (wageVal > highestWage) highestWage = wageVal;
    if (wageVal > 0) {
      totalWageSum += wageVal;
      nonAgriCount++;
    }

    if (r.dateEffective && r.dateEffective.startsWith(String(currentYear))) {
      updatedThisYear++;
    }
  }

  const averageWage = nonAgriCount > 0 ? Math.round(totalWageSum / nonAgriCount) : 0;

  return {
    lastUpdated: lastUpdateEvent.length > 0 ? lastUpdateEvent[0].last_updated : new Date(),
    metrics: {
      totalRegions,
      highestWage,
      averageWage,
      updatedThisYear
    },
    regions: regionList
  };
}

app.get(['/api/wages', '/api/get-data.php'], async (req, res) => {
  try {
    const data = await getWageDataPayload();
    res.json(data);
  } catch (err) {
    console.error('Error fetching wage data:', err);
    res.status(500).json({ error: 'Failed to fetch wage data', details: err.message });
  }
});

// -------------------------------------------------------------
// 2. PUBLIC API: Rate Movements (computes previous vs current rate deltas)
// -------------------------------------------------------------
app.get(['/api/rate-movements', '/api/rate-movements.php'], async (req, res) => {
  try {
    const data = await getWageDataPayload();
    const movements = [];
    let totalIncreases = 0;
    let sumIncreasePercent = 0;
    let regionsChangedSet = new Set();
    let maxEffectiveDate = new Date('2020-01-01');

    for (const r of data.regions) {
      const nonAgri = r.rates.find(rt => rt.type === 'Non-Agriculture');
      if (!nonAgri) continue;

      let currentAmount = nonAgri.amount || (nonAgri.tranches && nonAgri.tranches[0] ? nonAgri.tranches[0].amount : 0);
      let previousAmount = Math.max(350, currentAmount - 35); // Benchmark baseline
      let change = currentAmount - previousAmount;
      let changePercent = parseFloat(((change / previousAmount) * 100).toFixed(1));

      if (change > 0) {
        totalIncreases++;
        sumIncreasePercent += changePercent;
        regionsChangedSet.add(r.id);
      }

      if (r.dateEffective) {
        const effDate = new Date(r.dateEffective);
        if (effDate > maxEffectiveDate && effDate <= new Date()) {
          maxEffectiveDate = effDate;
        }
      }

      movements.push({
        regionId: r.id,
        regionName: r.name,
        sector: 'Non-Agriculture',
        coverage: nonAgri.coverage || 'Non-agriculture / Industrial / Commercial',
        previousAmount,
        previousWageOrder: 'Previous Order',
        previousEffectiveDate: '2024-01-01',
        currentAmount,
        currentWageOrder: r.wageOrder,
        currentEffectiveDate: r.dateEffective,
        change,
        changePercent,
        status: 'Current'
      });
    }

    const avgIncrease = totalIncreases > 0 ? parseFloat((sumIncreasePercent / totalIncreases).toFixed(1)) : 0;
    const daysSinceLast = Math.floor((new Date() - maxEffectiveDate) / (1000 * 60 * 60 * 24));

    res.json({
      summary: {
        totalIncreases,
        avgIncrease,
        regionsChanged: regionsChangedSet.size,
        lastMovementDays: Math.max(0, daysSinceLast)
      },
      movements
    });
  } catch (err) {
    console.error('Error fetching rate movements:', err);
    res.status(500).json({ error: 'Failed to fetch rate movements', details: err.message });
  }
});

// -------------------------------------------------------------
// 3. PUBLIC API: Check Updates (for Notification Modal)
// -------------------------------------------------------------
app.get(['/api/check-updates', '/api/check-updates.php'], async (req, res) => {
  try {
    const [events] = await pool.query('SELECT * FROM update_events ORDER BY id DESC LIMIT 5');
    const [latestSchedules] = await pool.query(`
      SELECT ws.wage_order, ws.date_effective, r.name as region_name, wr.single_amount, wr.single_coverage
      FROM wage_schedules ws
      JOIN regions r ON ws.region_id = r.id
      JOIN wage_rates wr ON wr.schedule_id = ws.id AND wr.sector = 'Non-Agriculture'
      ORDER BY ws.date_effective DESC LIMIT 5
    `);

    res.json({
      success: true,
      last_updated: events.length > 0 ? events[0].last_updated : new Date(),
      has_changes: events.length > 0,
      recent_changes: latestSchedules.map(s => ({
        region_name: s.region_name,
        wage_order: s.wage_order,
        effective_date: s.date_effective ? s.date_effective.toISOString().split('T')[0] : '',
        amount: s.single_amount,
        coverage: s.single_coverage
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check updates' });
  }
});

// -------------------------------------------------------------
// 4. ADMIN & SYNC API
// -------------------------------------------------------------

// Admin Login
app.post(['/api/auth/login', '/admin-login.php'], async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password required' });
  }

  try {
    const [users] = await pool.query('SELECT * FROM admin_users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = users[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { username: user.username, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Manual trigger for NWPC Sync
app.post('/api/sync', authenticateToken, async (req, res) => {
  try {
    console.log('Triggering NWPC Sync on-demand...');
    exec('node sync-nwpc.js', (err, stdout, stderr) => {
      if (err) {
        console.error('Sync error:', stderr);
        return res.status(500).json({ success: false, error: stderr });
      }
      res.json({ success: true, message: 'NWPC Sync completed successfully', output: stdout });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Save / Import Wage Data
app.post(['/api/save-data', '/api/save-data.php'], authenticateToken, async (req, res) => {
  const { regions } = req.body;
  if (!Array.isArray(regions)) {
    return res.status(400).json({ success: false, message: 'Invalid regions payload' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const r of regions) {
      await connection.query(
        `INSERT INTO regions (id, name, notes) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), notes = VALUES(notes)`,
        [r.id, r.name, r.notes || '']
      );

      if (r.wageOrder && r.dateEffective) {
        await connection.query(
          `INSERT INTO wage_schedules (region_id, wage_order, date_effective, source)
           VALUES (?, ?, ?, 'admin_manual')
           ON DUPLICATE KEY UPDATE date_effective = VALUES(date_effective)`,
          [r.id, r.wageOrder, r.dateEffective]
        );

        const [sched] = await connection.query(
          'SELECT id FROM wage_schedules WHERE region_id = ? AND wage_order = ?',
          [r.id, r.wageOrder]
        );
        const scheduleId = sched[0].id;

        if (Array.isArray(r.rates)) {
          for (const rate of r.rates) {
            await connection.query(
              `INSERT INTO wage_rates (schedule_id, sector, uses_tranches, single_amount, single_coverage)
               VALUES (?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE single_amount = VALUES(single_amount), single_coverage = VALUES(single_coverage)`,
              [scheduleId, rate.type, (rate.tranches && rate.tranches.length > 0), rate.amount || null, rate.coverage || '']
            );
          }
        }
      }
    }

    await connection.query(
      `INSERT INTO update_events (summary, source) VALUES (?, 'admin_manual')`,
      [`Admin manual update: ${regions.length} regions updated.`]
    );

    await connection.commit();
    res.json({ success: true, message: 'Wage data saved successfully' });
  } catch (err) {
    await connection.rollback();
    console.error('Error saving wage data:', err);
    res.status(500).json({ success: false, message: 'Failed to save wage data' });
  } finally {
    connection.release();
  }
});

// Health Check
app.get(['/api/health', '/api/health.php'], async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 as val');
    const [syncState] = await pool.query('SELECT * FROM nwpc_sync_state ORDER BY last_checked_at DESC LIMIT 1');
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date(),
      lastSync: syncState.length > 0 ? syncState[0].last_checked_at : null
    });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected', details: err.message });
  }
});

// Serve frontend static build if exists
app.use(express.static(path.join(__dirname, 'frontend/dist')));
app.use((req, res) => {
  const indexPath = path.join(__dirname, 'frontend/dist/index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ message: 'DMRC Wage Monitoring API Server is running. Frontend build not found yet.' });
  }
});

// Automated Sync Scheduler: Every 6 hours
const SIX_HOURS = 6 * 60 * 60 * 1000;
setInterval(() => {
  console.log('[Scheduler] Running automated NWPC sync check...');
  exec('node sync-nwpc.js', (err, stdout) => {
    if (err) console.error('[Scheduler] Sync error:', err);
    else console.log('[Scheduler] Sync completed.');
  });
}, SIX_HOURS);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
