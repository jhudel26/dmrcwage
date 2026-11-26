const { getPool } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const pool = getPool();

  try {
    // 1. All regions + their wage schedules & Non-Agriculture rates
    const [schedules] = await pool.query(`
      SELECT
        r.id         AS region_id,
        r.name       AS region_name,
        r.sort_order,
        ws.id        AS schedule_id,
        ws.wage_order,
        ws.date_effective,
        wr.id        AS rate_id,
        wr.single_amount,
        wr.single_coverage,
        (SELECT MAX(wt.amount) FROM wage_tranches wt WHERE wt.rate_id = wr.id) AS max_tranche
      FROM regions r
      LEFT JOIN wage_schedules ws ON ws.region_id = r.id
      LEFT JOIN wage_rates wr ON wr.schedule_id = ws.id AND wr.sector = 'Non-Agriculture'
      ORDER BY r.sort_order ASC, ws.date_effective DESC, ws.id DESC
    `);

    // 2. Multi-tranche progressions (Tranche 1 -> Tranche 2 within an order)
    const [tranches] = await pool.query(`
      SELECT
        wt.rate_id,
        wt.tranche_order,
        wt.amount,
        wt.effective_date,
        wt.coverage,
        wr.schedule_id,
        ws.region_id,
        ws.wage_order,
        r.name AS region_name
      FROM wage_tranches wt
      JOIN wage_rates wr ON wt.rate_id = wr.id AND wr.sector = 'Non-Agriculture'
      JOIN wage_schedules ws ON wr.schedule_id = ws.id
      JOIN regions r ON ws.region_id = r.id
      ORDER BY r.sort_order ASC, ws.id, wt.tranche_order ASC
    `);

    const movements = [];
    const regionsWithMovement = new Set();
    let totalIncreases = 0;
    let sumIncreasePercent = 0;
    const regionsChangedSet = new Set();
    let maxEffectiveDate = new Date('2020-01-01');
    const now = new Date();
    const cleanOrder = (wo) => (wo || '—').replace(/\s+[a-z]\/$/i, '').trim();

    // Index tranches by rate_id
    const tranchesByRate = {};
    for (const t of tranches) {
      if (!tranchesByRate[t.rate_id]) tranchesByRate[t.rate_id] = [];
      tranchesByRate[t.rate_id].push(t);
    }

    // Group schedules by region
    const byRegion = {};
    const regionOrder = [];
    for (const s of schedules) {
      if (!byRegion[s.region_id]) {
        byRegion[s.region_id] = [];
        regionOrder.push(s.region_id);
      }
      if (s.schedule_id) byRegion[s.region_id].push(s);
    }

    // First, add tranche-to-tranche movements for all multi-tranche regions
    for (const rateId of Object.keys(tranchesByRate)) {
      const list = tranchesByRate[rateId];
      if (list.length < 2) continue;
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const curr = list[i];
        const prevAmt = parseFloat(prev.amount) || 0;
        const currAmt = parseFloat(curr.amount) || 0;
        if (prevAmt <= 0 || currAmt <= 0 || currAmt === prevAmt) continue;

        const change = parseFloat((currAmt - prevAmt).toFixed(2));
        const changePercent = parseFloat(((change / prevAmt) * 100).toFixed(1));
        const currDt = curr.effective_date ? new Date(curr.effective_date).toISOString().split('T')[0] : '';
        const prevDt = prev.effective_date ? new Date(prev.effective_date).toISOString().split('T')[0] : '';

        if (change > 0) {
          totalIncreases++;
          sumIncreasePercent += changePercent;
          regionsChangedSet.add(curr.region_id);
        }
        if (currDt && new Date(currDt) <= now && new Date(currDt) > maxEffectiveDate) {
          maxEffectiveDate = new Date(currDt);
        }

        regionsWithMovement.add(curr.region_id);
        movements.push({
          regionId: curr.region_id,
          regionName: curr.region_name,
          sector: 'Non-Agriculture',
          coverage: curr.coverage || '',
          previousAmount: prevAmt,
          previousWageOrder: `${cleanOrder(curr.wage_order)} (T${prev.tranche_order})`,
          previousEffectiveDate: prevDt,
          currentAmount: currAmt,
          currentWageOrder: `${cleanOrder(curr.wage_order)} (T${curr.tranche_order})`,
          currentEffectiveDate: currDt,
          change,
          changePercent,
          status: new Date(currDt) > now ? 'Upcoming Tranche' : 'Increased'
        });
      }
    }

    // Next, check schedule-to-schedule movements & include all remaining regions as baseline
    for (const regionId of regionOrder) {
      const list = byRegion[regionId];
      if (!list.length) continue;

      const unique = [];
      for (const s of list) {
        const amt = parseFloat(s.max_tranche || s.single_amount) || 0;
        const dt = s.date_effective ? new Date(s.date_effective).toISOString().split('T')[0] : '';
        if (!unique.some(u => u.amt === amt && u.dt === dt)) {
          unique.push({ ...s, amt, dt });
        }
      }

      if (unique.length >= 2) {
        const curr = unique[0];
        const prev = unique[1];
        if (curr.amt > 0 && prev.amt > 0 && curr.amt !== prev.amt) {
          const change = parseFloat((curr.amt - prev.amt).toFixed(2));
          const changePercent = parseFloat(((change / prev.amt) * 100).toFixed(1));
          if (change > 0) {
            totalIncreases++;
            sumIncreasePercent += changePercent;
            regionsChangedSet.add(regionId);
          }
          if (curr.dt && new Date(curr.dt) <= now && new Date(curr.dt) > maxEffectiveDate) {
            maxEffectiveDate = new Date(curr.dt);
          }
          regionsWithMovement.add(regionId);
          movements.push({
            regionId,
            regionName: curr.region_name,
            sector: 'Non-Agriculture',
            coverage: curr.single_coverage || '',
            previousAmount: prev.amt,
            previousWageOrder: cleanOrder(prev.wage_order),
            previousEffectiveDate: prev.dt,
            currentAmount: curr.amt,
            currentWageOrder: cleanOrder(curr.wage_order),
            currentEffectiveDate: curr.dt,
            change,
            changePercent,
            status: change > 0 ? 'Increased' : 'Decreased'
          });
          continue;
        }
      }

      // Include regions that don't have a prior schedule/tranche yet so all 23 regions are visible
      if (!regionsWithMovement.has(regionId)) {
        const curr = unique[0];
        if (curr.dt && new Date(curr.dt) <= now && new Date(curr.dt) > maxEffectiveDate) {
          maxEffectiveDate = new Date(curr.dt);
        }
        movements.push({
          regionId,
          regionName: curr.region_name,
          sector: 'Non-Agriculture',
          coverage: curr.single_coverage || '',
          previousAmount: null,
          previousWageOrder: '—',
          previousEffectiveDate: '',
          currentAmount: curr.amt,
          currentWageOrder: cleanOrder(curr.wage_order),
          currentEffectiveDate: curr.dt,
          change: null,
          changePercent: null,
          status: 'Current Order'
        });
      }
    }

    // Sort: actual movements first (most recent date), then baseline regions
    movements.sort((a, b) => {
      const aHasChange = a.change !== null ? 1 : 0;
      const bHasChange = b.change !== null ? 1 : 0;
      if (aHasChange !== bHasChange) return bHasChange - aHasChange;
      return new Date(b.currentEffectiveDate || 0).getTime() - new Date(a.currentEffectiveDate || 0).getTime();
    });

    const avgIncrease = totalIncreases > 0
      ? parseFloat((sumIncreasePercent / totalIncreases).toFixed(1))
      : 0;
    const daysSinceLast = Math.floor((now - maxEffectiveDate) / (1000 * 60 * 60 * 24));

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
