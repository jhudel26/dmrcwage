const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

const KNOWN_PAGE_IDS =
  '13291,2115,2119,2125,2130,2134,2151,2141,2144,2155,2158,2161,2165,2168,2174,2177,2180,23956';

const NWPC_PAGES_API =
  `https://nwpc.dole.gov.ph/wp-json/wp/v2/pages?include=${KNOWN_PAGE_IDS}&per_page=25&_fields=id,slug,title,modified_gmt,content`;

const NWPC_DISCOVER_API =
  'https://nwpc.dole.gov.ph/wp-json/wp/v2/pages?search=Wage+Order+No.&per_page=30&_fields=id,slug,title,modified_gmt,content';

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
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  const m1 = str.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m1) {
    const mon = months[m1[2].toLowerCase().slice(0, 3)];
    if (mon) return `${m1[3]}-${mon}-${m1[1].padStart(2, '0')}`;
  }
  const m2 = str.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m2) {
    const mon = months[m2[1].toLowerCase().slice(0, 3)];
    if (mon) return `${m2[3]}-${mon}-${m2[2].padStart(2, '0')}`;
  }
  return null;
}

/**
 * Extract tranche dates from header rows of a dense grid.
 * Returns e.g. [effDate, '2027-01-01'] when 2 tranches are detected.
 */
function extractTrancheDates(grid, defaultEffDate) {
  const headerRows = grid.slice(0, Math.min(4, grid.length));
  const headerText = headerRows.map(r => r.join(' ')).join(' ');
  if (!/tranche/i.test(headerText)) return [];

  // Look for all explicit dates in header rows (beyond "Upon Effectivity")
  const explicitDates = [];
  for (const row of headerRows) {
    for (const cell of row) {
      const iso = parseIsoDate(cell);
      if (iso && !explicitDates.includes(iso)) explicitDates.push(iso);
    }
  }

  // Standard 2-tranche layout: Tranche 1 is Upon Effectivity (or first explicit date),
  // Tranche 2 is the later explicit date in header
  if (explicitDates.length >= 2) return explicitDates.slice(0, 3);
  if (explicitDates.length === 1) return [defaultEffDate, explicitDates[0]];
  return [defaultEffDate];
}

/**
 * Given a row in a wage table, extract current rate & any tranche rates.
 * Numbers >= 300 and <= 1500 represent daily minimum wage rates (increases are < 200).
 */
function extractRowRates(row, trancheDates, defaultEffDate) {
  const dailyAmounts = row.map(parsePeso).filter(v => v !== null && v >= 300 && v <= 1500);
  if (!dailyAmounts.length) return null;

  // If table has tranche columns (typically: [prevMW, tranche1MW, tranche2MW, ...])
  if (trancheDates.length >= 2 && dailyAmounts.length >= 3) {
    const trancheAmounts = dailyAmounts.slice(-trancheDates.length);
    const tranches = trancheAmounts.map((amt, idx) => ({
      order: idx + 1,
      amount: amt,
      effectiveDate: trancheDates[idx] || defaultEffDate,
    }));
    return {
      finalAmount: tranches[tranches.length - 1].amount,
      tranches,
    };
  }

  return {
    finalAmount: dailyAmounts[dailyAmounts.length - 1],
    tranches: [],
  };
}

/**
 * Detect column-based sector groups (e.g. Region IV-A where Non-Agriculture,
 * Agriculture, and Retail & Service are side-by-side column groups).
 */
function detectSectorColumns(grid) {
  const headerRows = grid.slice(0, Math.min(3, grid.length));
  const nonAgriCols = new Set();
  const agriCols = new Set();
  for (const row of headerRows) {
    row.forEach((cell, cIdx) => {
      if (/Non-Agriculture/i.test(cell)) nonAgriCols.add(cIdx);
      else if (/Agriculture/i.test(cell)) agriCols.add(cIdx);
    });
  }
  return {
    hasSectorCols: nonAgriCols.size > 0 && agriCols.size > 0,
    nonAgriCols: [...nonAgriCols],
    agriCols: [...agriCols],
  };
}

/**
 * Parse a single NWPC page's tables into general + subregion-specific rate matches.
 */
function parseWageTables($, defaultEffDate) {
  const tables = $('table.wptb-preview-table');
  let generalNonAgri = null;
  let generalAgri = null;
  const subMatches = {}; // keyed by regionId

  tables.each((_, table) => {
    const grid = tableToDenseGrid($(table), $);
    if (grid.length < 2) return;
    const flat = grid.map(r => r.join(' ')).join(' ');
    if (/Title of Training|INDICATIVE CALENDAR|Board Directory|Vice-Chairperson/i.test(flat)) return;
    if (/DOMESTIC WORKERS|-DW-|Monthly Minimum Wage/i.test(flat)) return;

    const trancheDates = extractTrancheDates(grid, defaultEffDate);
    const { hasSectorCols, nonAgriCols, agriCols } = detectSectorColumns(grid);
    const isAuroraTable = /Province of AURORA/i.test(flat);
    const isCentralLuzonTable = /BATAAN.*BULACAN/i.test(flat);

    for (const row of grid) {
      const rowStr = row.join(' ');
      const parsed = extractRowRates(row, trancheDates, defaultEffDate);
      if (!parsed) continue;

      const parsedNonAgri = hasSectorCols
        ? extractRowRates(nonAgriCols.map(c => row[c] ?? ''), trancheDates, defaultEffDate)
        : parsed;
      const parsedAgri = hasSectorCols
        ? extractRowRates(agriCols.map(c => row[c] ?? ''), trancheDates, defaultEffDate)
        : null;

      // Subregion-specific row matching (Region IV-A, Region VII, BARMM)
      if (/Extended Metropolitan/i.test(rowStr)) {
        subMatches['region4a'] = subMatches['region4a'] || {};
        if (parsedNonAgri) subMatches['region4a'].nonAgri = parsedNonAgri;
        if (parsedAgri) subMatches['region4a'].agri = parsedAgri;
      } else if (/1st Class Municipalit/i.test(rowStr)) {
        subMatches['region4a re1stclass'] = subMatches['region4a re1stclass'] || {};
        if (parsedNonAgri) subMatches['region4a re1stclass'].nonAgri = parsedNonAgri;
        if (parsedAgri) subMatches['region4a re1stclass'].agri = parsedAgri;
      } else if (/2nd to 5th Class/i.test(rowStr)) {
        subMatches['region4a 2nd to 5th'] = subMatches['region4a 2nd to 5th'] || {};
        if (parsedNonAgri) subMatches['region4a 2nd to 5th'].nonAgri = parsedNonAgri;
        if (parsedAgri) subMatches['region4a 2nd to 5th'].agri = parsedAgri;
      } else if (/Class A/i.test(rowStr) && /Cebu|Mandaue/i.test(flat)) {
        subMatches['region7-A'] = subMatches['region7-A'] || {};
        subMatches['region7-A'].nonAgri = parsed;
      } else if (/Class B/i.test(rowStr) && /Cebu|Bohol/i.test(flat)) {
        subMatches['region7-B'] = subMatches['region7-B'] || {};
        subMatches['region7-B'].nonAgri = parsed;
      }

      const isAgri = /Agriculture|Plantation/i.test(rowStr) && !/Non-Agriculture/i.test(rowStr);
      const isNonAgri = /Non-Agriculture|Commercial|Industrial/i.test(rowStr);

      if (isAuroraTable) {
        subMatches['region3-aurora'] = subMatches['region3-aurora'] || {};
        if (isNonAgri && !subMatches['region3-aurora'].nonAgri) subMatches['region3-aurora'].nonAgri = parsed;
        if (isAgri && !subMatches['region3-aurora'].agri) subMatches['region3-aurora'].agri = parsed;
      } else if (isCentralLuzonTable) {
        subMatches['region3'] = subMatches['region3'] || {};
        if (isNonAgri && !subMatches['region3'].nonAgri) subMatches['region3'].nonAgri = parsed;
        if (isAgri && !subMatches['region3'].agri) subMatches['region3'].agri = parsed;
      } else {
        if (isNonAgri && !generalNonAgri) generalNonAgri = parsed;
        if (isAgri && !generalAgri) generalAgri = parsed;
      }
    }
  });

  return { generalNonAgri, generalAgri, subMatches };
}

const FALLBACKS = {
  'ncr':                   { nonAgri: 755, agri: 718, date: '2026-09-26', wo: 'NCR-28' },
  'car':                   { nonAgri: 505, agri: 505, date: '2025-12-30', wo: 'CAR-24' },
  'region1':               { nonAgri: 505, agri: 480, date: '2025-11-19', wo: 'RB 1-24' },
  'region2':               { nonAgri: 500, agri: 500, date: '2025-11-05', wo: 'RTWPB 2-24' },
  'region3':               { nonAgri: 600, agri: 570, date: '2026-04-16', wo: 'RBIII-26' },
  'region3-aurora':        { nonAgri: 545, agri: 525, date: '2026-04-16', wo: 'RBIII-26' },
  'region4a':              { nonAgri: 645, agri: 550, date: '2026-10-26', wo: 'IVA-23' },
  'region4a re1stclass':   { nonAgri: 590, agri: 550, date: '2026-10-26', wo: 'IVA-23' },
  'region4a 2nd to 5th':   { nonAgri: 550, agri: 550, date: '2026-10-26', wo: 'IVA-23' },
  'region4b':              { nonAgri: 455, agri: 455, date: '2026-01-01', wo: 'RB-MIMAROPA-13' },
  'region5':               { nonAgri: 480, agri: 480, date: '2026-12-01', wo: 'RBV-23' },
  'region6':               { nonAgri: 590, agri: 565, date: '2026-11-20', wo: 'VI-30' },
  'region7-A':             { nonAgri: 582, agri: 582, date: '2026-10-14', wo: 'ROVII-27' },
  'region7-B':             { nonAgri: 542, agri: 542, date: '2026-10-14', wo: 'ROVII-27' },
  'region8':               { nonAgri: 470, agri: 440, date: '2026-06-01', wo: 'VIII-25' },
  'region9':               { nonAgri: 464, agri: 451, date: '2026-06-01', wo: 'RIX-24' },
  'region10':              { nonAgri: 500, agri: 485, date: '2026-05-01', wo: 'RX-24' },
  'region11':              { nonAgri: 540, agri: 525, date: '2026-09-01', wo: 'RB XI-24' },
  'region12':              { nonAgri: 501, agri: 476, date: '2027-01-01', wo: 'XII-26' },
  'region13':              { nonAgri: 475, agri: 475, date: '2026-05-01', wo: 'RXIII-20' },
  'barmm-a':               { nonAgri: 461, agri: 461, date: '2026-12-01', wo: 'BARMM-05' },
  'barmm-b':               { nonAgri: 461, agri: 461, date: '2026-12-01', wo: 'BARMM-05' },
  'barmm-c':               { nonAgri: 436, agri: 436, date: '2026-12-01', wo: 'BARMM-05' },
};

async function upsertSectorRate(pool, scheduleId, sector, defaultCoverage, parsedRate, fallbackAmt) {
  const hasTranches = parsedRate && parsedRate.tranches && parsedRate.tranches.length >= 2;
  const amount = (parsedRate && parsedRate.finalAmount) || fallbackAmt;
  if (!amount) return;

  await pool.query(
    `INSERT INTO wage_rates (schedule_id, sector, uses_tranches, single_amount, single_coverage)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       uses_tranches = IF(VALUES(uses_tranches), TRUE, uses_tranches),
       single_amount = VALUES(single_amount)`,
    [scheduleId, sector, hasTranches, amount, defaultCoverage]
  );

  if (hasTranches) {
    const [rateRows] = await pool.query(
      'SELECT id FROM wage_rates WHERE schedule_id = ? AND sector = ?',
      [scheduleId, sector]
    );
    if (rateRows.length > 0) {
      const rateId = rateRows[0].id;
      await pool.query('DELETE FROM wage_tranches WHERE rate_id = ?', [rateId]);
      for (const tr of parsedRate.tranches) {
        await pool.query(
          `INSERT INTO wage_tranches (rate_id, tranche_order, amount, effective_date, coverage)
           VALUES (?, ?, ?, ?, ?)`,
          [rateId, tr.order, tr.amount, tr.effectiveDate, defaultCoverage]
        );
      }
    }
  }
}

async function runSync(pool, { force = false } = {}) {
  // Fetch known regional pages + discover any new regional wage pages on NWPC
  const [knownRes, discoverRes] = await Promise.all([
    axios.get(NWPC_PAGES_API, {
      headers: { 'User-Agent': 'Mozilla/5.0 DMRCWageMonitor/2.0' },
      timeout: 25000
    }),
    axios.get(NWPC_DISCOVER_API, {
      headers: { 'User-Agent': 'Mozilla/5.0 DMRCWageMonitor/2.0' },
      timeout: 25000
    }).catch(() => ({ data: [] }))
  ]);

  const pagesMap = new Map();
  for (const p of knownRes.data) pagesMap.set(p.id, p);
  for (const p of discoverRes.data) {
    if (!pagesMap.has(p.id) && /^(region-|ncr|car|barmm|nir)/i.test(p.slug || '')) {
      pagesMap.set(p.id, p);
    }
  }

  let synced = 0, skipped = 0;
  const log = [];

  for (const page of pagesMap.values()) {
    const { id: wpPageId, slug, title, modified_gmt, content } = page;
    const html = content.rendered;
    const payloadHash = crypto.createHash('sha256').update(html).digest('hex');

    const [prevState] = await pool.query(
      'SELECT payload_sha256 FROM nwpc_sync_state WHERE wp_page_id = ?',
      [wpPageId]
    );
    if (!force && prevState.length > 0 && prevState[0].payload_sha256 === payloadHash) {
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
    let wageOrder = woMatch
      ? woMatch[1].replace(/\s+[a-z]\/$/i, '').replace(/\s+/g, ' ').trim()
      : null;
    const dateMatch = bodyText.match(/Effective:?\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
    let dateEffective = dateMatch ? parseIsoDate(dateMatch[1]) : null;

    let [dbRegions] = await pool.query('SELECT * FROM regions WHERE nwpc_slug = ?', [slug]);

    // Auto-register newly discovered NWPC region page if it has a valid wage table
    if (!dbRegions.length && $('table.wptb-preview-table').length > 0 && /Non-Agriculture/i.test(bodyText)) {
      const cleanTitle = cheerio.load(title?.rendered || slug).text().trim() || slug.toUpperCase();
      const newId = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      await pool.query(
        `INSERT IGNORE INTO regions (id, name, nwpc_slug, notes, sort_order)
         VALUES (?, ?, ?, ?, 99)`,
        [newId, cleanTitle, slug, `Auto-discovered from NWPC (${slug})`]
      );
      [dbRegions] = await pool.query('SELECT * FROM regions WHERE nwpc_slug = ?', [slug]);
    }

    if (!dbRegions.length) {
      log.push({ slug, action: 'skipped', reason: 'no_region' });
      continue;
    }

    const defaultEffDate = dateEffective || (FALLBACKS[dbRegions[0].id] && FALLBACKS[dbRegions[0].id].date) || '2026-01-01';
    const { generalNonAgri, generalAgri, subMatches } = parseWageTables($, defaultEffDate);
    const isMultiRegionPage = dbRegions.length > 1;

    for (const reg of dbRegions) {
      const fb = FALLBACKS[reg.id] || {};
      const sub = subMatches[reg.id] || {};
      const effDate = dateEffective || fb.date || '2026-01-01';
      const wo = (isMultiRegionPage && fb.wo) ? fb.wo : (wageOrder || fb.wo || `${slug.toUpperCase()}-CURRENT`);

      const nonAgriParsed = sub.nonAgri || (!isMultiRegionPage ? generalNonAgri : null);
      const agriParsed = sub.agri || (!isMultiRegionPage ? generalAgri : null);

      await pool.query(
        `INSERT INTO wage_schedules (region_id, wage_order, date_effective, pdf_url, source)
         VALUES (?, ?, ?, ?, 'nwpc_sync')
         ON DUPLICATE KEY UPDATE date_effective=VALUES(date_effective), pdf_url=VALUES(pdf_url)`,
        [reg.id, wo, effDate, pdfUrl]
      );
      const [sched] = await pool.query(
        'SELECT id FROM wage_schedules WHERE region_id = ? AND wage_order = ?',
        [reg.id, wo]
      );
      const sid = sched[0].id;

      await upsertSectorRate(
        pool, sid, 'Non-Agriculture',
        'Non-agriculture / Industrial / Commercial',
        nonAgriParsed, fb.nonAgri
      );
      await upsertSectorRate(
        pool, sid, 'Agriculture',
        'Agriculture (Plantation & Non-Plantation)',
        agriParsed, fb.agri || fb.nonAgri
      );

      synced++;
      log.push({
        slug,
        regionId: reg.id,
        action: 'updated',
        wo,
        nonAgriAmt: nonAgriParsed?.finalAmount || fb.nonAgri,
        tranchesFound: nonAgriParsed?.tranches?.length || 0
      });
    }

    await pool.query(
      `INSERT INTO nwpc_sync_state (wp_page_id, wp_slug, wp_modified_gmt, payload_sha256, latest_wage_order, latest_pdf_url, status)
       VALUES (?, ?, ?, ?, ?, ?, 'synced')
       ON DUPLICATE KEY UPDATE
         wp_modified_gmt=VALUES(wp_modified_gmt), payload_sha256=VALUES(payload_sha256),
         latest_wage_order=VALUES(latest_wage_order), latest_pdf_url=VALUES(latest_pdf_url),
         last_checked_at=CURRENT_TIMESTAMP, status='synced'`,
      [wpPageId, slug, modified_gmt ? modified_gmt.replace('T', ' ') : null, payloadHash, wageOrder, pdfUrl]
    );
  }

  if (synced > 0) {
    await pool.query(
      `INSERT INTO update_events (summary, source) VALUES (?, 'nwpc_cron')`,
      [`NWPC sync: ${synced} updated, ${skipped} unchanged`]
    );
  }

  return { synced, skipped, log };
}

module.exports = { runSync, parseWageTables, tableToDenseGrid };
