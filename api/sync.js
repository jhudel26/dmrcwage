const { getPool } = require('./_db');
const { runSync } = require('../sync-nwpc-core');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const CRON_SECRET = process.env.CRON_SECRET || 'dmrc-cron-secret-2026';
  const provided = req.headers['x-cron-secret'] || req.query?.secret;
  if (provided !== CRON_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized – invalid or missing secret' });
  }

  const pool = getPool();
  try {
    const result = await runSync(pool);
    res.json({ success: true, timestamp: new Date(), ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
