const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

const NWPC_PAGES_API =
  'https://nwpc.dole.gov.ph/wp-json/wp/v2/pages' +
  '?include=13291,2115,2119,2125,2130,2134,2151,2141,2144,2155,2158,2161,2165,2168,2174,2177,2180,23956' +
  '&per_page=20&_fields=id,slug,modified_gmt,content';

function tableToDenseGrid($table, $) {
  const grid = [];
  $table.find('tr').each((rIdx, tr) => {
    if (!grid[rIdx]) grid[rIdx] = [];
    let cIdx = 0;
    $(tr).find('th, td').each((_, cell) => {
      while (grid[rIdx][cIdx] !== undefined) cIdx++;
      const text = $(cell).text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      const rs = Math.max(1, parseInt($(cell).attr('rowspan') || '1', 10));
      const cs = Math.max(1, parseInt($(cell).attr('colspan') || '1', 10));
      for (let dr = 0; dr < rs; dr++) {
        if (!grid[rIdx + dr]) grid[rIdx + dr] = [];
        for (let dc = 0; dc < cs; dc++) grid[rIdx + dr][cIdx + dc] = text;
      }
      cIdx += cs;
    });
  });
  return grid.filter(row => row.some(c => c && c.length > 0));
}

function parsePeso(val) {
  const m = String(val).match(/(?:₱|Php|P)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function parseIsoDate(str) {
  if (!str) return null;
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const m1 = str.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m1) { const mon = months[m1[2].toLowerCase().slice(0,3)]; if (mon) return `${m1[3]}-${mon}-${m1[1].padStart(2,'0')}`; }
  const m2 = str.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m2) { const mon = months[m2[1].toLowerCase().slice(0,3)]; if (mon) return `${m2[3]}-${mon}-${m2[2].padStart(2,'0')}`; }
  return null;
}

const FALLBACKS = {
  'ncr':              { nonAgri: 755, agri: 718, date: '2026-09-26', wo: 'NCR-28' },
  'car':              { nonAgri: 505, agri: 505, date: '2025-12-30', wo: 'CAR-24' },
  'region1':          { nonAgri: 505, agri: 480, date: '2025-11-19', wo: 'RB 1-24' },
  'region2':          { nonAgri: 500, agri: 500, date: '2025-11-05', wo: 'RTWPB 2-24' },
  'region3':          { nonAgri: 600, agri: 570, date: '2026-04-16', wo: 'RBIII-26' },
  'region3-aurora':   { nonAgri: 545, agri: 525, date: '2026-04-16', wo: 'RBIII-26' },
  'region4a':         { nonAgri: 645, agri: 550, date: '2026-10-26', wo: 'IVA-23' },
  'region4a re1stclass': { nonAgri: 605, agri: 550, date: '2026-10-26', wo: 'IVA-23' },
  'region4a 2nd to 5th': { nonAgri: 550, agri: 550, date: '2026-10-26', wo: 'IVA-23' },
  'region4b':         { nonAgri: 455, agri: 455, date: '2026-01-01', wo: 'RB-MIMAROPA-13' },
  'region5':          { nonAgri: 480, agri: 480, date: '2026-12-01', wo: 'RBV-23' },
  'region6':          { nonAgri: 590, agri: 565, date: '2026-11-20', wo: 'VI-30' },
  'region7-A':        { nonAgri: 582, agri: 582, date: '2026-10-14', wo: 'ROVII-27' },
  'region7-B':        { nonAgri: 542, agri: 542, date: '2026-10-14', wo: 'ROVII-27' },
  'region8':          { nonAgri: 470, agri: 440, date: '2026-06-01', wo: 'VIII-25' },
  'region9':          { nonAgri: 464, agri: 451, date: '2026-06-01', wo: 'RIX-24' },
  'region10':         { nonAgri: 500, agri: 485, date: '2026-05-01', wo: 'RX-24' },
  'region11':         { nonAgri: 540, agri: 525, date: '2026-09-01', wo: 'RB XI-24' },
  'region12':         { nonAgri: 501, agri: 476, date: '2027-01-01', wo: 'XII-26' },
  'region13':         { nonAgri: 475, agri: 475, date: '2026-05-01', wo: 'RXIII-20' },
  'barmm-a':          { nonAgri: 461, agri: 461, date: '2026-12-01', wo: 'BARMM-05' },
  'barmm-b':          { nonAgri: 461, agri: 461, date: '2026-12-01', wo: 'BARMM-05' },
  'barmm-c':          { nonAgri: 436, agri: 436, date: '2026-12-01', wo: 'BARMM-05' },
};

async function runSync(pool) {
  const res = await axios.get(NWPC_PAGES_API, {
    headers: { 'User-Agent': 'Mozilla/5.0 DMRCWageMonitor/2.0' },
    timeout: 25000
  });

  let synced = 0, skipped = 0;
  const log = [];

  for (const page of res.data) {
    const { id: wpPageId, slug, modified_gmt, content } = page;
    const html = content.rendered;
    const payloadHash = crypto.createHash('sha256').update(html).digest('hex');

    const [prevState] = await pool.query(
      'SELECT payload_sha256 FROM nwpc_sync_state WHERE wp_page_id = ?', [wpPageId]
    );
    if (prevState.length > 0 && prevState[0].payload_sha256 === payloadHash) {
      skipped++;
      log.push({ slug, action: 'skipped' });
      continue;
    }

    const $ = cheerio.load(html);
    let pdfUrl = null;
    $('a[href$=".pdf"]').each((_, a) => {
      const href = $(a).attr('href') || '';
      if (href.toLowerCase().includes('wage-order') || href.toLowerCase().includes('rb')) {
        pdfUrl = href.startsWith('http') ? href : `https://nwpc.dole.gov.ph${href}`;
      }
    });

    const bodyText = $.text();
    const woMatch = bodyText.match(/Wage\s+Order\s+No\.?\s*([A-Za-z0-9\s()/-]+?)(?:\s+[a-z]\/|\s*\(Effective)/i);
    let wageOrder = woMatch ? woMatch[1].replace(/\s+/g, ' ').trim() : null;
    const dateMatch = bodyText.match(/Effective:?\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
    let dateEffective = dateMatch ? parseIsoDate(dateMatch[1]) : null;

    const tables = $('table.wptb-preview-table');
    let parsedNonAgri = null, parsedAgri = null;

    tables.each((_, table) => {
      const grid = tableToDenseGrid($(table), $);
      if (grid.length < 2) return;
      const flat = grid.map(r => r.join(' ')).join(' ');
      if (/Title of Training|INDICATIVE CALENDAR|Board Directory|Vice-Chairperson/i.test(flat)) return;
      if (/DOMESTIC WORKERS|-DW-|Monthly Minimum Wage/i.test(flat)) return;

      for (const row of grid) {
        const amounts = row.map(parsePeso).filter(v => v !== null && v >= 300 && v <= 1000);
        if (!amounts.length) continue;
        const rowStr = row.join(' ');
        const isAgri = /Agriculture|Plantation/i.test(rowStr) && !/Non-Agriculture/i.test(rowStr);
        const isNonAgri = /Non-Agriculture|Commercial|Industrial/i.test(rowStr);
        if (isNonAgri && !parsedNonAgri) parsedNonAgri = amounts[amounts.length - 1];
        if (isAgri && !parsedAgri) parsedAgri = amounts[amounts.length - 1];
      }
    });

    const [dbRegions] = await pool.query('SELECT * FROM regions WHERE nwpc_slug = ?', [slug]);
    if (!dbRegions.length) { log.push({ slug, action: 'skipped', reason: 'no_region' }); continue; }

    for (const reg of dbRegions) {
      const fb = FALLBACKS[reg.id] || {};
      const nonAgriAmt = parsedNonAgri || fb.nonAgri;
      const agriAmt = parsedAgri || fb.agri || nonAgriAmt;
      const effDate = dateEffective || fb.date || '2026-01-01';
      const wo = wageOrder || fb.wo || `${slug.toUpperCase()}-CURRENT`;

      await pool.query(
        `INSERT INTO wage_schedules (region_id, wage_order, date_effective, pdf_url, source)
         VALUES (?, ?, ?, ?, 'nwpc_sync')
         ON DUPLICATE KEY UPDATE date_effective=VALUES(date_effective), pdf_url=VALUES(pdf_url)`,
        [reg.id, wo, effDate, pdfUrl]
      );
      const [sched] = await pool.query(
        'SELECT id FROM wage_schedules WHERE region_id = ? AND wage_order = ?', [reg.id, wo]
      );
      const sid = sched[0].id;

      await pool.query(
        `INSERT INTO wage_rates (schedule_id, sector, uses_tranches, single_amount, single_coverage)
         VALUES (?, 'Non-Agriculture', FALSE, ?, 'Non-agriculture / Industrial / Commercial')
         ON DUPLICATE KEY UPDATE single_amount=VALUES(single_amount)`,
        [sid, nonAgriAmt]
      );
      await pool.query(
        `INSERT INTO wage_rates (schedule_id, sector, uses_tranches, single_amount, single_coverage)
         VALUES (?, 'Agriculture', FALSE, ?, 'Agriculture (Plantation & Non-Plantation)')
         ON DUPLICATE KEY UPDATE single_amount=VALUES(single_amount)`,
        [sid, agriAmt]
      );

      synced++;
      log.push({ slug, regionId: reg.id, action: 'updated', wo, nonAgriAmt, agriAmt });
    }

    await pool.query(
      `INSERT INTO nwpc_sync_state (wp_page_id, wp_slug, wp_modified_gmt, payload_sha256, latest_wage_order, latest_pdf_url, status)
       VALUES (?, ?, ?, ?, ?, ?, 'synced')
       ON DUPLICATE KEY UPDATE
         wp_modified_gmt=VALUES(wp_modified_gmt), payload_sha256=VALUES(payload_sha256),
         latest_wage_order=VALUES(latest_wage_order), latest_pdf_url=VALUES(latest_pdf_url),
         last_checked_at=CURRENT_TIMESTAMP, status='synced'`,
      [wpPageId, slug, modified_gmt ? modified_gmt.replace('T',' ') : null, payloadHash, wageOrder, pdfUrl]
    );
  }

  await pool.query(
    `INSERT INTO update_events (summary, source) VALUES (?, 'nwpc_cron')`,
    [`NWPC sync: ${synced} updated, ${skipped} unchanged`]
  );

  return { synced, skipped, log };
}

module.exports = { runSync };
