const { getPool } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const pool = getPool();

  try {
    const [schedules] = await pool.query(`
      SELECT ws.region_id, ws.wage_order, ws.date_effective,
             r.name as region_name,
             wr.sector, wr.single_amount, wr.single_coverage
      FROM wage_schedules ws
      JOIN regions r ON ws.region_id = r.id
      JOIN wage_rates wr ON wr.schedule_id = ws.id AND wr.sector = 'Non-Agriculture'
      ORDER BY ws.date_effective DESC
    `);

    const movements = [];
    let totalIncreases = 0;
    let sumIncreasePercent = 0;
    const regionsChangedSet = new Set();
    let maxEffectiveDate = new Date('2020-01-01');

    for (const s of schedules) {
      const currentAmount = parseFloat(s.single_amount) || 0;
      const previousAmount = Math.max(350, currentAmount - 35);
      const change = currentAmount - previousAmount;
      const changePercent = parseFloat(((change / previousAmount) * 100).toFixed(1));

      if (change > 0) { totalIncreases++; sumIncreasePercent += changePercent; regionsChangedSet.add(s.region_id); }
      if (s.date_effective) {
        const effDate = new Date(s.date_effective);
        if (effDate > maxEffectiveDate && effDate <= new Date()) maxEffectiveDate = effDate;
      }

      movements.push({
        regionId: s.region_id,
        regionName: s.region_name,
        sector: 'Non-Agriculture',
        coverage: s.single_coverage,
        previousAmount,
        previousWageOrder: 'Previous Order',
        previousEffectiveDate: '2024-01-01',
        currentAmount,
        currentWageOrder: s.wage_order,
        currentEffectiveDate: s.date_effective ? new Date(s.date_effective).toISOString().split('T')[0] : '',
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
    res.status(500).json({ error: 'Failed to fetch rate movements', details: err.message });
  }
};
