const { getPool } = require('./_db');
const { runSync } = require('../sync-nwpc-core');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cron-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const CRON_SECRET = process.env.CRON_SECRET || 'dmrc-cron-secret-2026';
  const JWT_SECRET  = process.env.JWT_SECRET  || 'dmrc-wage-secret-key-2026';

  // Accept: cron secret via header or query param
  const cronProvided = req.headers['x-cron-secret'] || req.query?.secret;
  const validCron    = cronProvided === CRON_SECRET;

  // Accept: valid admin JWT via Authorization: Bearer <token>
  let validJwt = false;
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
      if (payload && payload.role === 'admin') validJwt = true;
    } catch {
      // invalid/expired token — fall through
    }
  }

  if (!validCron && !validJwt) {
    return res.status(401).json({ success: false, error: 'Unauthorized – invalid or missing secret' });
  }

  const pool = getPool();
  const force = req.query?.force === '1' || req.query?.force === 'true';
  try {
    const result = await runSync(pool, { force });
    res.json({ success: true, timestamp: new Date(), ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
