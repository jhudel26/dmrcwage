const { getPool } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const pool = getPool();

  try {
    // Get all wage schedules with their effective Non-Agriculture rate
    // Use MAX(tranche) if tranches exist, else single_amount
    const [rows] = await pool.query(`
      SELECT
        ws.id            AS schedule_id,
        ws.region_id,
        ws.wage_order,
        ws.date_effective,
        r.name           AS region_name,
        wr.single_amount,
        wr.uses_tranches,
        wr.single_coverage,
        COALESCE(
          (SELECT MAX(wt.amount) FROM wage_tranches wt WHERE wt.rate_id = wr.id),
          wr.single_amount
        )                AS effective_rate
      FROM wage_schedules ws
      JOIN regions r  ON ws.region_id = r.id
      JOIN wage_rates wr ON wr.schedule_id = ws.id AND wr.sector = 'Non-Agriculture'
      ORDER BY ws.region_id, ws.date_effective DESC, ws.id DESC
    `);

    // Group by region_id
    const byRegion = {};
    for (const row of rows) {
      if (!byRegion[row.region_id]) byRegion[row.region_id] = [];
      byRegion[row.region_id].push(row);
    }

    const movements = [];
    let totalIncreases = 0;
    let sumIncreasePercent = 0;
    const regionsChangedSet = new Set();
    let maxEffectiveDate = new Date('2020-01-01');

    for (const regionId of Object.keys(byRegion)) {
      const list = byRegion[regionId]; // sorted newest → oldest by date then id
      const currentRate = parseFloat(list[0].effective_rate) || 0;
      if (currentRate === 0) continue;

      // Find the first OLDER schedule whose rate is DIFFERENT from the current
      // This skips duplicate records created for the same wage order
      let prevRecord = null;
      for (let i = 1; i < list.length; i++) {
        const r = parseFloat(list[i].effective_rate) || 0;
        if (r !== currentRate && r > 0) {
          prevRecord = list[i];
          break;
        }
      }

      // No genuine previous rate found — skip this region
      if (!prevRecord) continue;

      const previousRate = parseFloat(prevRecord.effective_rate);
      const change = parseFloat((currentRate - previousRate).toFixed(2));
      const changePercent = parseFloat(((change / previousRate) * 100).toFixed(1));

      if (change > 0) {
        totalIncreases++;
        sumIncreasePercent += changePercent;
        regionsChangedSet.add(regionId);
      }

      const effDate = list[0].date_effective ? new Date(list[0].date_effective) : null;
      if (effDate && effDate > maxEffectiveDate && effDate <= new Date()) {
        maxEffectiveDate = effDate;
      }

      movements.push({
        regionId,
        regionName: list[0].region_name,
        sector: 'Non-Agriculture',
        coverage: list[0].single_coverage || '',
        previousAmount: previousRate,
        previousWageOrder: prevRecord.wage_order || '—',
        previousEffectiveDate: prevRecord.date_effective
          ? new Date(prevRecord.date_effective).toISOString().split('T')[0]
          : '—',
        currentAmount: currentRate,
        currentWageOrder: list[0].wage_order,
        currentEffectiveDate: list[0].date_effective
          ? new Date(list[0].date_effective).toISOString().split('T')[0]
          : '—',
        change,
        changePercent,
        status: change > 0 ? 'Increased' : change < 0 ? 'Decreased' : 'Unchanged'
      });
    }

    // Sort: largest absolute change first
    movements.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

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
