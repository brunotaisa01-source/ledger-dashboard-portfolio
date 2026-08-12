function businessDays(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  let days = 0;
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Math.max(0, days - 1);
}

function isOpenAt(row, toIso) {
  return Boolean(row.opened_date) && row.opened_date <= toIso && (!row.resolved_date || row.resolved_date > toIso);
}

function isResolvedInRange(row, fromIso, toIso) {
  return Boolean(row.resolved_date) && row.resolved_date >= fromIso && row.resolved_date <= toIso;
}

function isProductiveInRange(row, fromIso, toIso) {
  return Boolean(row.action_date) && row.action_date >= fromIso && row.action_date <= toIso;
}

function isActiveInPeriod(row, fromIso, toIso) {
  return Boolean(row.opened_date) && row.opened_date <= toIso && (!row.resolved_date || row.resolved_date >= fromIso);
}

function isResolvedLifecycle(row, toIso) {
  if (row.resolved_date) return row.resolved_date <= toIso;
  return isResolvedStatus(row.status);
}

function passesLifecycle(row, lifecycle, toIso) {
  const selected = lifecycle || 'ALL';
  if (selected === 'RESOLVED') return isResolvedLifecycle(row, toIso);
  if (selected === 'OPEN') return !isResolvedLifecycle(row, toIso) && isOpenAt(row, toIso);
  return true;
}

function normalizeDate(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const uk = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (uk) return `${uk[3]}-${uk[2].padStart(2, '0')}-${uk[1].padStart(2, '0')}`;
  return raw;
}

function isResolvedStatus(status) {
  const value = String(status || '').trim().toUpperCase();
  if (!value) return false;
  if (['OPEN', 'UNRESOLVED', 'PENDING', 'IN PROGRESS', 'WIP', 'NEW'].some((token) => value.includes(token))) return false;
  return ['CLOSED', 'RESOLVED', 'COMPLETE', 'COMPLETED', 'CLEARED', 'DONE', 'REMOVED', 'NON OPEN', 'NON-OPEN'].some((token) => value.includes(token));
}

function uniqueRef(raw) {
  return String(raw.unique_ref || raw.uniqueRef || raw['Unique Ref'] || '').trim() || null;
}

function companyCode(raw, source) {
  const explicit = String(raw.company_code || raw.companyCode || raw['Company Code'] || '').trim();
  if (explicit) return explicit;
  if (source === 'STOREBOOK') {
    const ref = uniqueRef(raw);
    return (ref ? ref.split(/\s+/)[0] : '') || '9001';
  }
  return String(raw.company_or_entity || raw.companyOrEntity || '').trim() || null;
}

function normalizeRawRow(raw) {
  const source = String(raw.source || raw.Source || 'STOREBOOK').trim().toUpperCase() === 'ZR' ? 'ZR' : 'STOREBOOK';
  const status = String(raw.manual_status || raw.manualStatus || raw.status || raw.Status || '').trim() || null;
  const actionDate = normalizeDate(raw.action_date || raw.actionDate || raw.ActionDate || raw['Action Date'] || raw['action date']);
  const ref = uniqueRef(raw);
  const code = companyCode(raw, source);
  return {
    source,
    snapshot_date: normalizeDate(raw.snapshot_date || raw.snapshotDate || raw.SnapshotDate),
    source_key: String(raw.source_key || raw.sourceKey || raw.SourceKey || raw['Unique Ref'] || ref || '').trim() || null,
    unique_ref: ref,
    company_code: code,
    company_or_entity: source === 'STOREBOOK'
      ? code
      : String(raw.company_or_entity || raw.companyOrEntity || code || '').trim() || null,
    category: String(raw.category || raw.Category || '').trim() || null,
    status_system: String(raw.status_system || raw.statusSystem || raw['Status sytem'] || raw['Status system'] || '').trim() || null,
    status,
    opened_date: normalizeDate(raw.opened_date || raw.openedDate || raw.OpenedDate || raw['Created Date'] || raw['Document Date'] || raw['Posting Date']),
    action_date: actionDate,
    action_date_source: String(raw.action_date_source || raw.actionDateSource || '').trim() || null,
    resolved_date: normalizeDate(raw.resolved_date || raw.resolvedDate || raw.ResolvedDate) || (isResolvedStatus(status) ? actionDate : null),
    resolution_source: String(raw.resolution_source || raw.resolutionSource || '').trim() || null,
  };
}

function supplierLabel(row) {
  return row.supplier_name || row.supplier_id || 'Missing supplier';
}

function passesStaticFilters(row, filters) {
  if (row.source !== filters.source) return false;
  if (filters.statuses?.length && !filters.statuses.includes(row.status || '')) return false;
  if (filters.categories?.length && !filters.categories.includes(row.category || '')) return false;
  if (filters.companies?.length && !filters.companies.includes(row.company_or_entity || '')) return false;
  if (filters.supplierDrill && supplierLabel(row) !== filters.supplierDrill) return false;
  if (filters.supplierSearch) {
    const needle = filters.supplierSearch.toLowerCase();
    const id = String(row.supplier_id || '').toLowerCase();
    const name = String(row.supplier_name || '').toLowerCase();
    if (!id.includes(needle) && !name.includes(needle)) return false;
  }
  return true;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function topSuppliers(rows, limit = 10) {
  const counts = {};
  for (const row of rows) {
    const label = supplierLabel(row);
    counts[label] = (counts[label] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function operationalRows(rows, source, toIso) {
  const eligibleRows = rows.filter(
    (row) => row.source === source && row.snapshot_date && row.snapshot_date <= toIso,
  );
  const effectiveSnapshot = eligibleRows.reduce(
    (latest, row) => String(row.snapshot_date || '') > latest ? String(row.snapshot_date || '') : latest,
    '',
  );
  if (!effectiveSnapshot) return [];
  return uniqueRowsBySnapshotKey(
    eligibleRows.filter((row) => String(row.snapshot_date || '') === effectiveSnapshot),
  );
}

function uniqueEvents(rows, dateField) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${String(row.source_key || '')}|${String(row[dateField] || '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueRowsBySnapshotKey(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = String(row.source_key || '').trim();
    if (!key) return true;
    const snapshotKey = `${String(row.snapshot_date || '')}|${key}`;
    if (seen.has(snapshotKey)) return false;
    seen.add(snapshotKey);
    return true;
  });
}

function snapshotRowsForFilters(rows, filters) {
  const toIso = filters.dateTo || new Date().toISOString().slice(0, 10);
  return operationalRows(rows, filters.source, toIso)
    .filter((row) => passesStaticFilters(row, filters))
    .filter((row) => passesLifecycle(row, filters.lifecycle, toIso));
}

function dateBoundsForSource(rows, source) {
  const dates = rows
    .filter((row) => row.source === source && row.snapshot_date)
    .map((row) => row.snapshot_date)
    .sort();
  return {
    earliest: dates[0] || '',
    latest: dates[dates.length - 1] || '',
  };
}

function buildViewModel(rows, filters) {
  const fromIso = filters.dateFrom || '0000-01-01';
  const toIso = filters.dateTo || new Date().toISOString().slice(0, 10);
  const sourceRows = snapshotRowsForFilters(rows, filters);
  const filteredRows = sourceRows;
  const historicalRows = rows
    .filter((row) => passesStaticFilters(row, filters))
    .filter((row) => passesLifecycle(row, filters.lifecycle, toIso));
  const openRows = filteredRows.filter((row) => passesLifecycle(row, 'OPEN', toIso));
  const resolvedRows = uniqueEvents(
    historicalRows.filter((row) => isResolvedInRange(row, fromIso, toIso)),
    'resolved_date',
  );
  const detailRows = filteredRows;
  const productivityRows = uniqueEvents(
    historicalRows.filter(
      (row) => row.resolution_source !== 'auto_missing_from_source'
        && isProductiveInRange(row, fromIso, toIso),
    ),
    'action_date',
  );
  const suppliers = topSuppliers(detailRows, 10);
  const topSupplier = suppliers[0] || { label: 'n/a', count: 0 };

  return {
    sourceRows,
    filteredRows,
    detailRows,
    productivityRows,
    topSuppliers: suppliers,
    kpis: {
      openCount: openRows.length,
      avgDaysOpen: average(openRows.map((row) => businessDays(row.opened_date, toIso)).filter((v) => v != null)),
      avgDaysResolve: average(resolvedRows.map((row) => businessDays(row.opened_date, row.resolved_date)).filter((v) => v != null)),
      resolvedCount: resolvedRows.length,
      topSupplierName: topSupplier.label,
      topSupplierCount: topSupplier.count,
    },
  };
}

function csvRowsForActiveSource(rows, filters) {
  return snapshotRowsForFilters(rows, filters)
    .map((row) => ({
      source: row.source,
      supplier_id: row.supplier_id,
      supplier_name: row.supplier_name,
    }));
}

const ZR_DISPLAY_COLUMNS = [
  'Owner',
  'Unique Ref',
  'Document Number',
  'Vendor',
  'Company Code',
  'Vendor Name 1',
  'Document Type',
  'Reference',
  'Document Date',
  'Amount in local currency',
  'Local Currency',
  'Net due date',
  'Tax code',
  'Posting Date',
  'Text',
  'Payment Block',
  'User name',
  'Category',
  'Status',
  'Action Date',
  'Comments',
];

const STOREBOOK_DISPLAY_COLUMNS = [
  'Owner',
  'Status sytem',
  'Created Date',
  'Financial Net Price COGS',
  'Site',
  'Site',
  'Supplier',
  'Supplier',
  'Main Storebook #',
  'Main Vendor Doc.',
  'Unique Ref',
  'Category',
  'Comments',
  'Action Date',
  'Status',
];

function displayColumnsForSource(source) {
  return source === 'ZR' ? ZR_DISPLAY_COLUMNS : STOREBOOK_DISPLAY_COLUMNS;
}

function csvHeadersForSource(source) {
  return ['Source', ...displayColumnsForSource(source)];
}

module.exports = {
  businessDays,
  isOpenAt,
  isResolvedInRange,
  isProductiveInRange,
  isActiveInPeriod,
  normalizeRawRow,
  dateBoundsForSource,
  buildViewModel,
  csvRowsForActiveSource,
  displayColumnsForSource,
  csvHeadersForSource,
};
