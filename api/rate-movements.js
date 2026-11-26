const { getPool } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const pool = getPool();

  try {
    // Get all wage schedules with their Non-Agriculture rate, ordered by region + date
    const [schedules] = await pool.query(`
      SELECT
        ws.id        AS schedule_id,
        ws.region_id,
        ws.wage_order,
        ws.date_effective,
        r.name       AS region_name,
        wr.sector,
        wr.single_amount,
        wr.uses_tranches,
        wr.single_coverage,
        -- get the highest tranche amount as the effective rate when tranches are used
        (SELECT MAX(wt.amount) FROM wage_tranches wt WHERE wt.rate_id = wr.id) AS max_tranche
      FROM wage_schedules ws
      JOIN regions r  ON ws.region_id = r.id
      JOIN wage_rates wr ON wr.schedule_id = ws.id AND wr.sector = 'Non-Agriculture'
      ORDER BY ws.region_id, ws.date_effective DESC
    `);

    // Group into { regionId -> [schedule_newest, schedule_older, ...] }
    const byRegion = {};
    for (const s of schedules) {
      if (!byRegion[s.region_id]) byRegion[s.region_id] = [];
      byRegion[s.region_id].push(s);
    }

    const movements = [];
    let totalIncreases = 0;
    let sumIncreasePercent = 0;
    const regionsChangedSet = new Set();
    let maxEffectiveDate = new Date('2020-01-01');

    for (const regionId of Object.keys(byRegion)) {
      const list = byRegion[regionId]; // sorted newest → oldest

      // Need at least 2 schedules to show a movement
      if (list.length < 2) continue;

      const curr = list[0];
      const prev = list[1];

      // Resolve effective rate: use max_tranche if tranches exist, else single_amount
      const currentAmount  = parseFloat(curr.max_tranche || curr.single_amount) || 0;
      const previousAmount = parseFloat(prev.max_tranche || prev.single_amount) || 0;

      if (currentAmount === 0 || previousAmount === 0) continue;

      const change = parseFloat((currentAmount - previousAmount).toFixed(2));
      const changePercent = parseFloat(((change / previousAmount) * 100).toFixed(1));

      if (change > 0) {
        totalIncreases++;
        sumIncreasePercent += changePercent;
        regionsChangedSet.add(regionId);
      }

      if (curr.date_effective) {
        const effDate = new Date(curr.date_effective);
        if (effDate > maxEffectiveDate && effDate <= new Date()) maxEffectiveDate = effDate;
      }

      movements.push({
        regionId,
        regionName: curr.region_name,
        sector: 'Non-Agriculture',
        coverage: curr.single_coverage || '',
        previousAmount,
        previousWageOrder: prev.wage_order || '—',
        previousEffectiveDate: prev.date_effective
          ? new Date(prev.date_effective).toISOString().split('T')[0]
          : '',
        currentAmount,
        currentWageOrder: curr.wage_order,
        currentEffectiveDate: curr.date_effective
          ? new Date(curr.date_effective).toISOString().split('T')[0]
          : '',
        change,
        changePercent,
        status: change > 0 ? 'Increased' : change < 0 ? 'Decreased' : 'Unchanged'
      });
    }

    // Sort movements: largest increase first
    movements.sort((a, b) => b.change - a.change);

    const avgIncrease = totalIncreases > 0
      ? parseFloat((sumIncreasePercent / totalIncreases).toFixed(1))
      : 0;
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
