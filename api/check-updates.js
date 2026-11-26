const { getPool } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const pool = getPool();

  try {
    const [events] = await pool.query('SELECT * FROM update_events ORDER BY id DESC LIMIT 5');
    const [latestSchedules] = await pool.query(`
      SELECT ws.wage_order, ws.date_effective, r.name as region_name,
             wr.single_amount, wr.single_coverage,
             (SELECT MAX(wt.amount) FROM wage_tranches wt WHERE wt.rate_id = wr.id) AS max_tranche
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
        wage_order: (s.wage_order || '').replace(/\s+[a-z]\/$/i, '').trim(),
        effective_date: s.date_effective ? new Date(s.date_effective).toISOString().split('T')[0] : '',
        amount: parseFloat(s.max_tranche || s.single_amount) || null,
        coverage: s.single_coverage
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check updates' });
  }
};
