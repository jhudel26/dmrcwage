const { getPool } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const pool = getPool();

  try {
    await pool.query('SELECT 1');
    const [syncState] = await pool.query('SELECT * FROM nwpc_sync_state ORDER BY last_checked_at DESC LIMIT 1');
    res.json({
      status: 'ok',
      database: 'connected',
      host: process.env.DB_NAME + '@' + process.env.DB_HOST,
      timestamp: new Date(),
      lastSync: syncState.length > 0 ? syncState[0].last_checked_at : null,
      version: '2.0.0'
    });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected', details: err.message });
  }
};
