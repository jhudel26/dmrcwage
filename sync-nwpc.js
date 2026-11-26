require('dotenv').config();
const mysql = require('mysql2/promise');
const { runSync } = require('./sync-nwpc-core');

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'mysql-erucare.alwaysdata.net',
    user: process.env.DB_USER || 'erucare',
    password: process.env.DB_PASSWORD || 'Mickeyandmouse152526.',
    database: process.env.DB_NAME || 'erucare_dmrcwagerate',
    connectionLimit: 5,
    ssl: { rejectUnauthorized: false }
  });

  console.log('[NWPC Sync] Starting at', new Date().toISOString());
  try {
    const result = await runSync(pool);
    console.log('[NWPC Sync] Done:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('[NWPC Sync] Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
