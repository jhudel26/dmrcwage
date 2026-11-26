// Shared DB pool factory for Vercel serverless (re-use across warm invocations)
const mysql = require('mysql2/promise');

let pool;
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      enableKeepAlive: true,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

module.exports = { getPool };
