require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { getPool } = require('./api/_db');

// Ensure env defaults are populated for local dev before api/* handlers read them
process.env.DB_HOST = process.env.DB_HOST || 'mysql-erucare.alwaysdata.net';
process.env.DB_USER = process.env.DB_USER || 'erucare';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'Mickeyandmouse152526.';
process.env.DB_NAME = process.env.DB_NAME || 'erucare_dmrcwagerate';

const wagesHandler = require('./api/wages');
const checkUpdatesHandler = require('./api/check-updates');
const rateMovementsHandler = require('./api/rate-movements');
const healthHandler = require('./api/health');
const authLoginHandler = require('./api/auth-login');
const syncHandler = require('./api/sync');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'dmrc-wage-secret-key-2026';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '15mb' }));

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

// Unified routes backed by the exact same handlers used in Vercel serverless functions
app.get('/api/wages', wagesHandler);
app.get('/api/check-updates', checkUpdatesHandler);
app.get('/api/rate-movements', rateMovementsHandler);
app.get('/api/health', healthHandler);
app.post('/api/auth/login', authLoginHandler);
app.all('/api/sync', syncHandler);

app.post('/api/save-data', authenticateToken, async (req, res) => {
  const { regions } = req.body;
  if (!Array.isArray(regions)) return res.status(400).json({ success: false, message: 'Invalid payload' });
  const conn = await getPool().getConnection();
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
  } finally {
    conn.release();
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`DMRC Wage Monitoring API running on port ${PORT}`);
});

module.exports = app;
