const { getPool } = require('./_db');

// All known regions with 2-tranche schedules and their data
const TRANCHE_DATA = {
  'region3': [
    { sector: 'Non-Agriculture', t1: { amount: 570, date: '2025-10-30' }, t2: { amount: 600, date: '2026-04-16' } },
    { sector: 'Agriculture',     t1: { amount: 540, date: '2025-10-30' }, t2: { amount: 570, date: '2026-04-16' } }
  ],
  'region3-aurora': [
    { sector: 'Non-Agriculture', t1: { amount: 515, date: '2025-10-30' }, t2: { amount: 545, date: '2026-04-16' } },
    { sector: 'Agriculture',     t1: { amount: 505, date: '2025-10-30' }, t2: { amount: 525, date: '2026-04-16' } }
  ],
  'region5': [
    { sector: 'Non-Agriculture', t1: { amount: 455, date: '2026-04-08' }, t2: { amount: 480, date: '2026-12-01' } },
    { sector: 'Agriculture',     t1: { amount: 455, date: '2026-04-08' }, t2: { amount: 480, date: '2026-12-01' } }
  ],
  'region8': [
    { sector: 'Non-Agriculture', t1: { amount: 440, date: '2025-12-08' }, t2: { amount: 470, date: '2026-06-01' } },
    { sector: 'Agriculture',     t1: { amount: 410, date: '2025-12-08' }, t2: { amount: 440, date: '2026-06-01' } }
  ],
  'region9': [
    { sector: 'Non-Agriculture', t1: { amount: 451, date: '2026-01-01' }, t2: { amount: 464, date: '2026-06-01' } },
    { sector: 'Agriculture',     t1: { amount: 440, date: '2026-01-01' }, t2: { amount: 451, date: '2026-06-01' } }
  ],
  'region10': [
    { sector: 'Non-Agriculture', t1: { amount: 485, date: '2026-01-16' }, t2: { amount: 500, date: '2026-05-01' } },
    { sector: 'Agriculture',     t1: { amount: 475, date: '2026-01-16' }, t2: { amount: 485, date: '2026-05-01' } }
  ],
  'region11': [
    { sector: 'Non-Agriculture', t1: { amount: 525, date: '2026-03-13' }, t2: { amount: 540, date: '2026-09-01' } },
    { sector: 'Agriculture',     t1: { amount: 510, date: '2026-03-13' }, t2: { amount: 525, date: '2026-09-01' } }
  ],
  'region12': [
    { sector: 'Non-Agriculture', t1: { amount: 476, date: '2026-11-22' }, t2: { amount: 501, date: '2027-01-01' } },
    { sector: 'Agriculture',     t1: { amount: 459, date: '2026-11-22' }, t2: { amount: 484, date: '2027-01-01' } }
  ],
  'region13': [
    { sector: 'Non-Agriculture', t1: { amount: 451, date: '2026-01-03' }, t2: { amount: 475, date: '2026-05-01' } },
    { sector: 'Agriculture',     t1: { amount: 451, date: '2026-01-03' }, t2: { amount: 475, date: '2026-05-01' } }
  ],
  'barmm-a': [
    { sector: 'Non-Agriculture', t1: { amount: 436, date: '2026-08-06' }, t2: { amount: 461, date: '2026-12-01' } },
    { sector: 'Agriculture',     t1: { amount: 401, date: '2026-08-06' }, t2: { amount: 426, date: '2026-12-01' } }
  ],
  'barmm-b': [
    { sector: 'Non-Agriculture', t1: { amount: 436, date: '2026-08-06' }, t2: { amount: 461, date: '2026-12-01' } },
    { sector: 'Agriculture',     t1: { amount: 401, date: '2026-08-06' }, t2: { amount: 426, date: '2026-12-01' } }
  ],
  'barmm-c': [
    { sector: 'Non-Agriculture', t1: { amount: 401, date: '2026-08-06' }, t2: { amount: 436, date: '2026-12-01' } },
    { sector: 'Agriculture',     t1: { amount: 401, date: '2026-08-06' }, t2: { amount: 426, date: '2026-12-01' } }
  ]
};

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
      SELECT wr.id as rate_id, wr.schedule_id, wr.sector,
             wr.uses_tranches, wr.single_amount, wr.single_coverage
      FROM wage_rates wr
      ORDER BY wr.schedule_id, wr.sector
    `);

    const [tranches] = await pool.query(`
      SELECT wt.rate_id, wt.tranche_order, wt.amount,
             wt.effective_date, wt.coverage
      FROM wage_tranches wt
      ORDER BY wt.rate_id, wt.tranche_order
    `);

    const [lastUpdateEvent] = await pool.query(
      'SELECT last_updated FROM update_events ORDER BY id DESC LIMIT 1'
    );

    // Build tranche lookup by rate_id
    const tranchesByRateId = {};
    for (const t of tranches) {
      if (!tranchesByRateId[t.rate_id]) tranchesByRateId[t.rate_id] = [];
      const tDate = new Date(t.effective_date);
      tranchesByRateId[t.rate_id].push({
        order: t.tranche_order,
        amount: parseFloat(t.amount),
        effectiveDate: tDate.toISOString().split('T')[0],
        coverage: t.coverage || '',
        status: tDate <= new Date() ? 'current' : 'upcoming'
      });
    }

    // Build region map
    const cleanOrder = (wo) => (wo || 'N/A').replace(/\s+[a-z]\/$/i, '').trim();
    const regionMap = new Map();
    for (const row of regions) {
      const cleanedWo = cleanOrder(row.wage_order);
      if (!regionMap.has(row.id)) {
        regionMap.set(row.id, {
          id: row.id, name: row.name, notes: row.notes || '',
          wageOrder: cleanedWo,
          dateEffective: row.date_effective ? row.date_effective.toISOString().split('T')[0] : '',
          pdfUrl: row.pdf_url || null, rates: [], wageSchedules: []
        });
      }
      const reg = regionMap.get(row.id);
      if (row.wage_order && !reg.wageSchedules.some(s => s.wageOrder === cleanedWo)) {
        reg.wageSchedules.push({
          id: row.schedule_id, wageOrder: cleanedWo,
          dateEffective: row.date_effective ? row.date_effective.toISOString().split('T')[0] : '',
          pdfUrl: row.pdf_url || null, rates: []
        });
      }
    }

    // Attach rates with tranches to schedules
    for (const rate of rates) {
      for (const reg of regionMap.values()) {
        const schedule = reg.wageSchedules.find(s => s.id === rate.schedule_id);
        if (!schedule) continue;

        const dbTranches = tranchesByRateId[rate.rate_id] || [];

        // Check TRANCHE_DATA override for this region
        const regionTranches = TRANCHE_DATA[reg.id];
        const trancheDef = regionTranches
          ? regionTranches.find(td => td.sector === rate.sector)
          : null;

        let builtTranches = dbTranches;

        // If DB has no tranches but we have TRANCHE_DATA, use that
        if (dbTranches.length === 0 && trancheDef) {
          const now = new Date();
          builtTranches = [
            {
              order: 1, amount: trancheDef.t1.amount,
              effectiveDate: trancheDef.t1.date, coverage: rate.single_coverage || '',
              status: new Date(trancheDef.t1.date) <= now ? 'current' : 'upcoming'
            },
            {
              order: 2, amount: trancheDef.t2.amount,
              effectiveDate: trancheDef.t2.date, coverage: rate.single_coverage || '',
              status: new Date(trancheDef.t2.date) <= now ? 'current' : 'upcoming'
            }
          ];
        }

        schedule.rates.push({
          type: rate.sector,
          amount: rate.single_amount ? parseFloat(rate.single_amount) : null,
          coverage: rate.single_coverage || '',
          tranches: builtTranches
        });
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

    // Compute metrics using current tranche amounts
    let highestWage = 0, totalWageSum = 0, nonAgriCount = 0, updatedThisYear = 0;
    const currentYear = new Date().getFullYear();
    for (const r of regionList) {
      const na = r.rates.find(rt => rt.type === 'Non-Agriculture');
      let wage = 0;
      if (na) {
        if (na.tranches && na.tranches.length > 0) {
          const curT = na.tranches.filter(t => t.status === 'current');
          wage = curT.length > 0 ? Math.max(...curT.map(t => t.amount)) : na.tranches[0].amount;
        } else if (na.amount) wage = na.amount;
      }
      if (wage > highestWage) highestWage = wage;
      if (wage > 0) { totalWageSum += wage; nonAgriCount++; }
      if (r.dateEffective && r.dateEffective.startsWith(String(currentYear))) updatedThisYear++;
    }

    res.json({
      lastUpdated: lastUpdateEvent.length > 0 ? lastUpdateEvent[0].last_updated : new Date(),
      metrics: {
        totalRegions: regionList.length, highestWage,
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
