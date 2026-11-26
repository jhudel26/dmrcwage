const { getPool } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const pool = getPool();

  try {
    const [regions] = await pool.query(`
      SELECT r.id, r.name, r.notes, r.sort_order,
             ws.id as schedule_id, ws.wage_order, ws.date_effective, ws.pdf_url
      FROM regions r
      LEFT JOIN wage_schedules ws ON r.id = ws.region_id
      ORDER BY r.sort_order ASC, ws.date_effective DESC
    `);

    const [rates] = await pool.query(`
      SELECT wr.*, wt.amount as tranche_amount, wt.effective_date as tranche_date,
             wt.coverage as tranche_coverage, wt.tranche_order
      FROM wage_rates wr
      LEFT JOIN wage_tranches wt ON wr.id = wt.rate_id
      ORDER BY wr.schedule_id, wr.sector, wt.tranche_order
    `);

    const [lastUpdateEvent] = await pool.query(
      'SELECT last_updated FROM update_events ORDER BY id DESC LIMIT 1'
    );

    // Build region map
    const regionMap = new Map();
    for (const row of regions) {
      if (!regionMap.has(row.id)) {
        regionMap.set(row.id, {
          id: row.id,
          name: row.name,
          notes: row.notes || '',
          wageOrder: row.wage_order || 'N/A',
          dateEffective: row.date_effective ? row.date_effective.toISOString().split('T')[0] : '',
          pdfUrl: row.pdf_url || null,
          rates: [],
          wageSchedules: []
        });
      }
      const reg = regionMap.get(row.id);
      if (row.wage_order && !reg.wageSchedules.some(s => s.wageOrder === row.wage_order)) {
        reg.wageSchedules.push({
          id: row.schedule_id,
          wageOrder: row.wage_order,
          dateEffective: row.date_effective ? row.date_effective.toISOString().split('T')[0] : '',
          pdfUrl: row.pdf_url || null,
          rates: []
        });
      }
    }

    // Attach rates
    for (const rate of rates) {
      for (const reg of regionMap.values()) {
        const schedule = reg.wageSchedules.find(s => s.id === rate.schedule_id);
        if (schedule) {
          let sectorRate = schedule.rates.find(r => r.type === rate.sector);
          if (!sectorRate) {
            sectorRate = {
              type: rate.sector,
              amount: rate.single_amount ? parseFloat(rate.single_amount) : null,
              coverage: rate.single_coverage || '',
              tranches: []
            };
            schedule.rates.push(sectorRate);
          }
          if (rate.tranche_amount !== null && rate.tranche_date) {
            const now = new Date();
            const tDate = new Date(rate.tranche_date);
            sectorRate.tranches.push({
              order: rate.tranche_order,
              amount: parseFloat(rate.tranche_amount),
              effectiveDate: tDate.toISOString().split('T')[0],
              coverage: rate.tranche_coverage || '',
              status: tDate <= now ? 'current' : 'upcoming'
            });
          }
        }
      }
    }

    const regionList = Array.from(regionMap.values()).map(r => {
      if (r.wageSchedules.length > 0) {
        r.rates = r.wageSchedules[0].rates;
        r.wageOrder = r.wageSchedules[0].wageOrder;
        r.dateEffective = r.wageSchedules[0].dateEffective;
        r.pdfUrl = r.wageSchedules[0].pdfUrl;
      }
      return r;
    });

    // Compute metrics
    let highestWage = 0;
    let totalWageSum = 0;
    let nonAgriCount = 0;
    const currentYear = new Date().getFullYear();
    let updatedThisYear = 0;

    for (const r of regionList) {
      const nonAgri = r.rates.find(rt => rt.type === 'Non-Agriculture');
      let wageVal = 0;
      if (nonAgri) {
        if (nonAgri.tranches && nonAgri.tranches.length > 0) {
          const curTranche = nonAgri.tranches.find(t => t.status === 'current') || nonAgri.tranches[0];
          wageVal = curTranche.amount;
        } else if (nonAgri.amount) {
          wageVal = nonAgri.amount;
        }
      }
      if (wageVal > highestWage) highestWage = wageVal;
      if (wageVal > 0) { totalWageSum += wageVal; nonAgriCount++; }
      if (r.dateEffective && r.dateEffective.startsWith(String(currentYear))) updatedThisYear++;
    }

    res.json({
      lastUpdated: lastUpdateEvent.length > 0 ? lastUpdateEvent[0].last_updated : new Date(),
      metrics: {
        totalRegions: regionList.length,
        highestWage,
        averageWage: nonAgriCount > 0 ? Math.round(totalWageSum / nonAgriCount) : 0,
        updatedThisYear
      },
      regions: regionList
    });
  } catch (err) {
    console.error('GET /api/wages error:', err);
    res.status(500).json({ error: 'Failed to fetch wage data', details: err.message });
  }
};
