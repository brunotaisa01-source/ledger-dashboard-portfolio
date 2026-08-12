const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

function expect(actual) {
  return {
    toBe(expected) { assert.equal(actual, expected); },
    toBeNull() { assert.equal(actual, null); },
    toContain(expected) { assert.ok(actual.includes(expected)); },
    toEqual(expected) { assert.deepEqual(actual, expected); },
    toHaveLength(expected) { assert.equal(actual.length, expected); },
    not: {
      toEqual(expected) {
        if (expected && expected.__arrayContaining) {
          assert.ok(!expected.__arrayContaining.every((item) => actual.includes(item)));
        } else {
          assert.notDeepEqual(actual, expected);
        }
      },
    },
  };
}
expect.arrayContaining = (items) => ({ __arrayContaining: items });

const {
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
} = require('./src/storebook_zr');

function row(overrides) {
  return {
    source: 'STOREBOOK',
    supplier_id: 'S001',
    supplier_name: 'Alpha Supplies',
    company_or_entity: '1000',
    category: 'Mismatch',
    status: 'Open',
    snapshot_date: '2026-06-12',
    opened_date: '2026-06-01',
    action_date: '2026-06-05',
    resolved_date: null,
    value: 100,
    ...overrides,
  };
}

const sampleRows = [
  row({ source_key: 'sb-open-alpha', opened_date: '2026-06-02', action_date: '2026-06-10', resolved_date: null, status: 'Open' }),
  row({ source_key: 'sb-resolved-alpha', opened_date: '2026-06-03', action_date: '2026-06-12', resolved_date: '2026-06-15', status: 'Closed' }),
  row({ source_key: 'sb-old-alpha', opened_date: '2026-05-20', action_date: '2026-05-25', resolved_date: '2026-05-31', status: 'Closed' }),
  row({ source_key: 'sb-beta', supplier_id: 'S002', supplier_name: 'Beta Goods', company_or_entity: '2000', category: 'Pricing', opened_date: '2026-06-11', action_date: '2026-06-16', resolved_date: null, status: 'Open' }),
  row({ source: 'ZR', source_key: 'zr-open', supplier_id: 'Z001', supplier_name: 'Zeta Retail', company_or_entity: 'SYN-ZR-001', category: 'Receipt', opened_date: '2026-06-01', action_date: '2026-06-09', resolved_date: null, status: 'Open' }),
  row({ source: 'ZR', source_key: 'zr-resolved', supplier_id: 'Z002', supplier_name: 'Zed Foods', company_or_entity: 'SYN-ZR-002', category: 'Receipt', opened_date: '2026-06-04', action_date: '2026-06-13', resolved_date: '2026-06-14', status: 'Closed' }),
];

const baseFilters = {
  source: 'STOREBOOK',
  lifecycle: 'ALL',
  dateFrom: '2026-06-10',
  dateTo: '2026-06-16',
  statuses: [],
  categories: [],
  companies: [],
  supplierSearch: '',
  supplierDrill: null,
};

describe('Storebook / Z & R date semantics', () => {
  test('Storebook mapping uses manual Status, fixed synthetic company, and matrix category payload', () => {
    const mapped = normalizeRawRow({
      Source: 'STOREBOOK',
      'Status sytem': 'System Blocked',
      Status: 'Resolved',
      Site: 'London DC',
      snapshot_date: '2026-06-12',
      Supplier: '700001',
      'Unique Ref': '9001 700001',
      Category: 'Bakery',
      'Action Date': '2026-06-12',
    });

    expect(mapped.status).toBe('Resolved');
    expect(mapped.company_or_entity).toBe('9001');
    expect(mapped.source_key).toBe('9001 700001');
    expect(mapped.category).toBe('Bakery');
  });

  test('compressed payload-shaped Storebook row maps stable fields and productivity date', () => {
    const mapped = normalizeRawRow({
      source: 'Storebook',
      source_key: 'Storebook|7200001|8300000001|7100001',
      supplier_id: '700001',
      supplier_name: 'Alpha Supplies',
      company_or_entity: '9001',
      company_code: '9001',
      unique_ref: '9001 700001',
      category: 'Bakery',
      status_system: 'System Blocked',
      status: 'Resolved',
      opened_date: '2026-06-01',
      action_date: '2026-06-12',
      snapshot_date: '2026-06-12',
    });

    const view = buildViewModel([mapped], baseFilters);

    expect(mapped.status).toBe('Resolved');
    expect(mapped.status_system).toBe('System Blocked');
    expect(mapped.category).toBe('Bakery');
    expect(mapped.company_code).toBe('9001');
    expect(mapped.company_or_entity).toBe('9001');
    expect(mapped.unique_ref).toBe('9001 700001');
    expect(mapped.resolved_date).toBe('2026-06-12');
    expect(view.productivityRows.map((r) => r.source_key)).toEqual(['Storebook|7200001|8300000001|7100001']);
    expect(view.kpis.resolvedCount).toBe(1);
  });

  test('Z&R mapping uses Company Code for company/entity filter field', () => {
    const mapped = normalizeRawRow({
      Source: 'ZR',
      'Company Code': 'SYN-CC-002',
      Vendor: '700111',
      'Unique Ref': 'SYN-CC-002 700111',
      Category: 'Fuel',
      Status: 'Awaiting Response',
      'Action Date': '2026-06-12',
    });

    expect(mapped.company_or_entity).toBe('SYN-CC-002');
    expect(mapped.source_key).toBe('SYN-CC-002 700111');
    expect(mapped.category).toBe('Fuel');
  });

  test('open/resolved/productivity/detail predicates match the required From/To rules', () => {
    const open = row({ opened_date: '2026-06-02', resolved_date: null, action_date: '2026-06-11' });
    const resolvedAfterTo = row({ opened_date: '2026-06-02', resolved_date: '2026-06-20' });
    const resolvedInRange = row({ opened_date: '2026-06-03', resolved_date: '2026-06-15', action_date: '2026-06-12' });
    const resolvedBeforeFrom = row({ opened_date: '2026-05-20', resolved_date: '2026-06-09', action_date: '2026-06-11' });

    expect(isOpenAt(open, '2026-06-16')).toBe(true);
    expect(isOpenAt(resolvedAfterTo, '2026-06-16')).toBe(true);
    expect(isOpenAt(resolvedInRange, '2026-06-16')).toBe(false);
    expect(isResolvedInRange(resolvedInRange, '2026-06-10', '2026-06-16')).toBe(true);
    expect(isResolvedInRange(resolvedBeforeFrom, '2026-06-10', '2026-06-16')).toBe(false);
    expect(isProductiveInRange(resolvedInRange, '2026-06-10', '2026-06-16')).toBe(true);
    expect(isActiveInPeriod(open, '2026-06-10', '2026-06-16')).toBe(true);
    expect(isActiveInPeriod(resolvedInRange, '2026-06-10', '2026-06-16')).toBe(true);
    expect(isActiveInPeriod(resolvedBeforeFrom, '2026-06-10', '2026-06-16')).toBe(false);
  });

  test('KPIs calculate open, resolved, and business-day averages from the selected range', () => {
    const view = buildViewModel(sampleRows, baseFilters);

    expect(view.kpis.openCount).toBe(2);
    expect(view.kpis.resolvedCount).toBe(1);
    expect(view.kpis.avgDaysOpen).toBe((businessDays('2026-06-02', '2026-06-16') + businessDays('2026-06-11', '2026-06-16')) / 2);
    expect(view.kpis.avgDaysResolve).toBe(
      businessDays('2026-06-03', '2026-06-15'),
    );
    expect(view.productivityRows.map((r) => r.source_key).sort()).toEqual(['sb-beta', 'sb-open-alpha', 'sb-resolved-alpha']);
    expect(view.detailRows.map((r) => r.source_key).sort()).toEqual(['sb-beta', 'sb-old-alpha', 'sb-open-alpha', 'sb-resolved-alpha']);
  });

  test('productivity uses Action Date, not opened or created date', () => {
    const actionOnly = row({
      source_key: 'action-only',
      opened_date: '2026-05-01',
      action_date: '2026-06-12',
      resolved_date: null,
    });
    const openedOnly = row({
      source_key: 'opened-only',
      opened_date: '2026-06-12',
      action_date: '2026-05-30',
      resolved_date: null,
    });

    const view = buildViewModel([actionOnly, openedOnly], baseFilters);

    expect(view.productivityRows.map((r) => r.source_key)).toEqual(['action-only']);
  });

  test('Z&R resolution timing uses Action Date for non-open statuses, not Clearing date', () => {
    const closed = normalizeRawRow({
      Source: 'ZR',
      Status: 'Closed',
      'Action Date': '2026-06-12',
      'Clearing date': '2026-06-20',
    });
    const open = normalizeRawRow({
      Source: 'ZR',
      Status: 'Open',
      'Action Date': '2026-06-12',
      'Clearing date': '2026-06-20',
    });

    expect(closed.resolved_date).toBe('2026-06-12');
    expect(open.resolved_date).toBeNull();
  });

  test('Z&R Removed with Action Date resolves and is not open at selected To date', () => {
    const removed = normalizeRawRow({
      Source: 'ZR',
      Status: 'Removed',
      'Action Date': '2026-06-30',
      snapshot_date: '2026-06-30',
      'Document Date': '2026-06-01',
      'Company Code': 'SYN-CC-002',
      Vendor: '700111',
      'Unique Ref': 'SYN-CC-002 700111',
      Category: 'Fuel',
    });

    const view = buildViewModel([removed], {
      ...baseFilters,
      source: 'ZR',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
    });

    expect(removed.resolved_date).toBe('2026-06-30');
    expect(isOpenAt(removed, '2026-06-30')).toBe(false);
    expect(view.kpis.openCount).toBe(0);
    expect(view.kpis.resolvedCount).toBe(1);
    expect(view.productivityRows).toHaveLength(1);
    expect(view.detailRows).toHaveLength(1);
  });
});

describe('Storebook / Z & R switch and filters', () => {
  test('switching source changes rows and recalculates KPIs/table/chart inputs', () => {
    const storebook = buildViewModel(sampleRows, baseFilters);
    const zr = buildViewModel(sampleRows, { ...baseFilters, source: 'ZR' });

    expect(storebook.sourceRows.every((r) => r.source === 'STOREBOOK')).toBe(true);
    expect(zr.sourceRows.every((r) => r.source === 'ZR')).toBe(true);
    expect(storebook.kpis.openCount).toBe(2);
    expect(zr.kpis.openCount).toBe(1);
    expect(storebook.detailRows.map((r) => r.source_key).sort()).toEqual(['sb-beta', 'sb-old-alpha', 'sb-open-alpha', 'sb-resolved-alpha']);
    expect(zr.detailRows.map((r) => r.source_key).sort()).toEqual(['zr-open', 'zr-resolved']);
    expect(zr.productivityRows.map((r) => r.source_key).sort()).toEqual(['zr-resolved']);
  });

  test('one key over eight snapshots contributes once to operational outputs', () => {
    const rows = Array.from({ length: 8 }, (_unused, index) => row({
      source_key: 'sb-repeated',
      snapshot_date: `2026-07-${String(index + 1).padStart(2, '0')}`,
      supplier_name: index === 7 ? 'Effective Supplier' : 'Historical Supplier',
      action_date: null,
    }));
    const filters = {
      ...baseFilters,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-08',
    };

    const view = buildViewModel(rows, filters);
    const exported = csvRowsForActiveSource(rows, filters);

    expect(view.detailRows.map((r) => r.snapshot_date)).toEqual(['2026-07-08']);
    expect(view.kpis.openCount).toBe(1);
    expect(view.topSuppliers).toEqual([{ label: 'Effective Supplier', count: 1 }]);
    expect(exported).toHaveLength(1);
  });

  test('To selects the latest available global snapshot at or before it', () => {
    const rows = [
      row({ source_key: 'sb-a', snapshot_date: '2026-06-01', supplier_name: 'A old' }),
      row({ source_key: 'sb-a', snapshot_date: '2026-06-05', supplier_name: 'A effective' }),
      row({ source_key: 'sb-b', snapshot_date: '2026-06-05', supplier_name: 'B effective' }),
      row({ source_key: 'sb-a', snapshot_date: '2026-06-10', supplier_name: 'A future' }),
    ];

    const view = buildViewModel(rows, {
      ...baseFilters,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-07',
    });
    const beforeHistory = buildViewModel(rows, {
      ...baseFilters,
      dateFrom: '2026-01-01',
      dateTo: '2026-05-31',
    });

    expect(view.detailRows.map((r) => r.supplier_name).sort()).toEqual(['A effective', 'B effective']);
    expect(beforeHistory.detailRows).toEqual([]);
  });

  test('status filter evaluates the state in the effective snapshot', () => {
    const rows = [
      row({ source_key: 'sb-status', snapshot_date: '2026-06-01', status: 'Open' }),
      row({ source_key: 'sb-status', snapshot_date: '2026-06-05', status: 'Closed', resolved_date: '2026-06-05' }),
    ];

    const view = buildViewModel(rows, {
      ...baseFilters,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-05',
      statuses: ['Open'],
    });

    expect(view.detailRows).toEqual([]);
  });

  test('From does not hide the effective operational snapshot', () => {
    const effective = row({ source_key: 'sb-before-from', snapshot_date: '2026-06-05' });

    const view = buildViewModel([effective], {
      ...baseFilters,
      dateFrom: '2026-06-10',
      dateTo: '2026-06-16',
    });

    expect(view.detailRows).toEqual([effective]);
  });

  test('resolved and action events use event windows, full history, and key-date deduplication', () => {
    const rows = [
      row({
        source_key: 'event-a',
        snapshot_date: '2026-05-01',
        opened_date: '2026-05-01',
        action_date: '2026-06-12',
        resolved_date: '2026-06-14',
        status: 'Closed',
      }),
      row({
        source_key: 'event-a',
        snapshot_date: '2026-07-01',
        opened_date: '2026-05-01',
        action_date: '2026-06-12',
        resolved_date: '2026-06-14',
        status: 'Closed',
      }),
      row({ source_key: 'event-b', snapshot_date: '2026-05-02', action_date: '2026-06-13' }),
      row({
        source_key: 'event-outside',
        snapshot_date: '2026-07-02',
        action_date: '2026-05-31',
        resolved_date: '2026-06-09',
        status: 'Closed',
      }),
    ];

    const view = buildViewModel(rows, {
      ...baseFilters,
      dateFrom: '2026-06-10',
      dateTo: '2026-06-16',
    });

    expect(view.kpis.resolvedCount).toBe(1);
    expect(view.productivityRows.map((r) => `${r.source_key}:${r.action_date}`).sort()).toEqual([
      'event-a:2026-06-12',
      'event-b:2026-06-13',
    ]);
  });

  test('auto-resolution stays operational and resolved but is excluded only from productivity', () => {
    const rows = [
      row({
        source: 'ZR',
        source_key: 'zr-auto',
        snapshot_date: '2026-06-16',
        action_date: '2026-06-15',
        resolved_date: '2026-06-15',
        status: 'Auto Resolved - Missing From Source',
        resolution_source: 'auto_missing_from_source',
      }),
      row({
        source: 'ZR',
        source_key: 'zr-human',
        snapshot_date: '2026-06-16',
        action_date: '2026-06-15',
        status: 'Open',
      }),
    ];

    const view = buildViewModel(rows, {
      ...baseFilters,
      source: 'ZR',
      dateFrom: '2026-06-10',
      dateTo: '2026-06-16',
    });

    expect(view.detailRows.map((r) => r.source_key).sort()).toEqual(['zr-auto', 'zr-human']);
    expect(view.kpis.resolvedCount).toBe(1);
    expect(view.productivityRows.map((r) => r.source_key)).toEqual(['zr-human']);
  });

  test('date defaults span earliest through latest snapshot for the selected source', () => {
    expect(dateBoundsForSource([
      row({ source: 'STOREBOOK', snapshot_date: '2026-06-03' }),
      row({ source: 'STOREBOOK', snapshot_date: '2026-07-09' }),
      row({ source: 'ZR', snapshot_date: '2026-08-01' }),
    ], 'STOREBOOK')).toEqual({ earliest: '2026-06-03', latest: '2026-07-09' });
  });

  test('Z&R dashboard All uses the effective snapshot and keeps Auto Resolved operationally', () => {
    const rows = [
      row({
        source: 'ZR',
        source_key: 'zr-current',
        snapshot_date: '2026-07-02',
        supplier_name: 'Current Supplier',
        opened_date: '2026-06-20',
        action_date: '2026-07-01',
        action_date_source: 'carried_from_history',
        status: 'Awaiting Response',
        resolved_date: null,
      }),
      row({
        source: 'ZR',
        source_key: 'zr-current',
        snapshot_date: '2026-07-01',
        supplier_name: 'Old Supplier Name',
        opened_date: '2026-06-20',
        action_date: '2026-07-01',
        action_date_source: 'derived_manual_change',
        status: 'Awaiting Response',
        resolved_date: null,
      }),
      row({
        source: 'ZR',
        source_key: 'zr-auto',
        snapshot_date: '2026-07-02',
        supplier_name: 'Auto Supplier',
        opened_date: '2026-06-10',
        action_date: null,
        action_date_source: '',
        status: 'Auto Resolved - Missing From Source',
        resolved_date: '2026-07-02',
        resolution_source: 'auto_missing_from_source',
      }),
      row({
        source: 'ZR',
        source_key: 'zr-resolved',
        snapshot_date: '2026-06-30',
        supplier_name: 'Resolved Supplier',
        opened_date: '2026-06-01',
        action_date: '2026-06-30',
        action_date_source: 'manual',
        status: 'Removed',
        resolved_date: '2026-06-30',
      }),
    ];

    const view = buildViewModel(rows, {
      ...baseFilters,
      source: 'ZR',
      dateFrom: '2026-06-01',
      dateTo: '2026-07-31',
    });

    expect(view.sourceRows.map((r) => r.source_key).sort()).toEqual(['zr-auto', 'zr-current']);
    expect(view.detailRows).toHaveLength(2);
    expect(view.detailRows.some((r) => r.resolution_source === 'auto_missing_from_source')).toBe(true);
    expect(view.kpis.openCount).toBe(1);
    expect(view.kpis.resolvedCount).toBe(2);
    expect(view.topSuppliers).toHaveLength(2);
    expect(view.productivityRows.map((r) => `${r.source_key}:${r.action_date}`).sort()).toEqual([
      'zr-current:2026-07-01',
      'zr-resolved:2026-06-30',
    ]);
  });

  test('Storebook dashboard All uses the effective snapshot while events use history', () => {
    const rows = [
      row({
        source_key: 'sb-history',
        snapshot_date: '2026-07-01',
        supplier_name: 'Historical Storebook',
        opened_date: '2026-06-01',
        action_date: '2026-07-01',
        status: 'Resolved',
        resolved_date: '2026-07-01',
      }),
      row({
        source_key: 'sb-current',
        snapshot_date: '2026-07-02',
        supplier_name: 'Current Storebook',
        opened_date: '2026-06-20',
        action_date: '2026-07-02',
        status: 'Open',
        resolved_date: null,
      }),
    ];
    const filters = {
      ...baseFilters,
      dateFrom: '2026-06-01',
      dateTo: '2026-07-31',
    };

    const view = buildViewModel(rows, filters);
    const exported = csvRowsForActiveSource(rows, filters);

    expect(view.sourceRows.map((r) => r.source_key)).toEqual(['sb-current']);
    expect(view.detailRows.map((r) => r.source_key)).toEqual(['sb-current']);
    expect(view.kpis.openCount).toBe(1);
    expect(view.kpis.resolvedCount).toBe(1);
    expect(exported.map((r) => r.supplier_name)).toEqual(['Current Storebook']);
  });

  test('status, category, and company filters apply after the selected source switch', () => {
    const view = buildViewModel(sampleRows, {
      ...baseFilters,
      source: 'ZR',
      statuses: ['Closed'],
      categories: ['Receipt'],
      companies: ['SYN-ZR-002'],
    });

    expect(view.detailRows.map((r) => r.source_key)).toEqual(['zr-resolved']);
    expect(view.kpis.openCount).toBe(0);
    expect(view.kpis.resolvedCount).toBe(1);
  });

  test('top supplier drill-through filters detail rows to the clicked supplier', () => {
    const before = buildViewModel(sampleRows, baseFilters);
    expect(before.kpis.topSupplierName).toBe('Alpha Supplies');
    expect(before.kpis.topSupplierCount).toBe(3);

    const drilled = buildViewModel(sampleRows, {
      ...baseFilters,
      supplierDrill: 'Alpha Supplies',
    });

    expect(drilled.detailRows.map((r) => r.source_key).sort()).toEqual(['sb-old-alpha', 'sb-open-alpha', 'sb-resolved-alpha']);
    expect(drilled.detailRows.every((r) => r.supplier_name === 'Alpha Supplies')).toBe(true);
  });

  test('CSV export source set contains only the active switch mode', () => {
    const exportFilters = { ...baseFilters, dateFrom: '2026-06-01' };
    const storebookCsv = csvRowsForActiveSource(sampleRows, exportFilters);
    const zrCsv = csvRowsForActiveSource(sampleRows, { ...exportFilters, source: 'ZR' });

    expect(new Set(storebookCsv.map((r) => r.source))).toEqual(new Set(['STOREBOOK']));
    expect(new Set(zrCsv.map((r) => r.source))).toEqual(new Set(['ZR']));
  });

  test('Z&R CSV exports only the effective global snapshot', () => {
    const rows = [
      row({
        source: 'ZR',
        source_key: 'zr-repeated',
        snapshot_date: '2026-06-01',
        supplier_name: 'Old snapshot',
        opened_date: '2026-05-10',
      }),
      row({
        source: 'ZR',
        source_key: 'zr-repeated',
        snapshot_date: '2026-06-05',
        supplier_name: 'Latest snapshot',
        opened_date: '2026-05-10',
        status: 'Auto Resolved - Missing From Source',
        resolution_source: 'auto_missing_from_source',
      }),
      row({
        source: 'ZR',
        source_key: 'zr-repeated',
        snapshot_date: '2026-06-05',
        supplier_name: 'Latest snapshot duplicate',
        opened_date: '2026-05-10',
      }),
      row({
        source: 'ZR',
        source_key: 'zr-in-range',
        snapshot_date: '2026-06-30',
        supplier_name: 'In range',
        opened_date: '2026-05-01',
      }),
      row({
        source: 'ZR',
        source_key: 'zr-before',
        snapshot_date: '2026-05-31',
        supplier_name: 'Before range',
        opened_date: '2026-05-10',
      }),
      row({
        source: 'ZR',
        source_key: 'zr-after',
        snapshot_date: '2026-07-05',
        supplier_name: 'After range',
        opened_date: '2026-05-10',
      }),
    ];

    const exported = csvRowsForActiveSource(rows, {
      ...baseFilters,
      source: 'ZR',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
    });

    expect(exported.map((r) => r.supplier_name)).toEqual(['In range']);
  });

  test('Storebook CSV exports only the effective global snapshot', () => {
    const rows = [
      row({
        source_key: 'sb-repeated',
        snapshot_date: '2026-06-01',
        supplier_name: 'Old snapshot',
        opened_date: '2026-05-01',
      }),
      row({
        source_key: 'sb-repeated',
        snapshot_date: '2026-06-05',
        supplier_name: 'Latest snapshot',
        opened_date: '2026-05-01',
      }),
      row({
        source_key: 'sb-repeated',
        snapshot_date: '2026-06-05',
        supplier_name: 'Latest snapshot duplicate',
        opened_date: '2026-05-01',
      }),
      row({
        source_key: 'sb-in-range',
        snapshot_date: '2026-06-30',
        supplier_name: 'In range',
        opened_date: '2026-05-01',
      }),
      row({
        source_key: 'sb-outside',
        snapshot_date: '2026-07-01',
        supplier_name: 'Outside range',
        opened_date: '2026-05-01',
      }),
    ];

    const exported = csvRowsForActiveSource(rows, {
      ...baseFilters,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
    });

    expect(exported.map((r) => r.supplier_name)).toEqual(['In range']);
  });

  test('CSV export respects status, category, company, and supplier filters for both sources', () => {
    const zrExported = csvRowsForActiveSource(sampleRows, {
      ...baseFilters,
      source: 'ZR',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-16',
      statuses: ['Closed'],
      categories: ['Receipt'],
      companies: ['SYN-ZR-002'],
      supplierSearch: 'zed foods',
    });
    const storebookExported = csvRowsForActiveSource(sampleRows, {
      ...baseFilters,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-16',
      statuses: ['Closed'],
      categories: ['Mismatch'],
      companies: ['1000'],
      supplierSearch: 'alpha supplies',
    });

    expect(zrExported.map((r) => r.supplier_name)).toEqual(['Zed Foods']);
    expect(storebookExported).toHaveLength(2);
    expect(storebookExported.every((r) => r.supplier_name === 'Alpha Supplies')).toBe(true);
  });

  test('All/Open/Resolved lifecycle filter controls table, KPIs, charts, and CSV for both sources', () => {
    for (const source of ['STOREBOOK', 'ZR']) {
      const rows = [
        row({
          source,
          source_key: `${source}-open`,
          snapshot_date: '2026-07-01',
          supplier_name: 'Open Supplier',
          opened_date: '2026-06-20',
          action_date: '2026-07-01',
          status: 'Open',
          resolved_date: null,
        }),
        row({
          source,
          source_key: `${source}-open`,
          snapshot_date: '2026-07-02',
          supplier_name: 'Open Supplier',
          opened_date: '2026-06-20',
          action_date: '2026-07-02',
          status: 'Open',
          resolved_date: null,
        }),
        row({
          source,
          source_key: `${source}-resolved`,
          snapshot_date: '2026-07-02',
          supplier_name: 'Resolved Supplier',
          opened_date: '2026-06-15',
          action_date: '2026-07-02',
          status: 'Resolved',
          resolved_date: '2026-07-02',
        }),
      ];
      const filters = {
        ...baseFilters,
        source,
        dateFrom: '2026-07-01',
        dateTo: '2026-07-02',
      };

      const allView = buildViewModel(rows, { ...filters, lifecycle: 'ALL' });
      const openView = buildViewModel(rows, { ...filters, lifecycle: 'OPEN' });
      const resolvedView = buildViewModel(rows, { ...filters, lifecycle: 'RESOLVED' });
      const allCsv = csvRowsForActiveSource(rows, { ...filters, lifecycle: 'ALL' });
      const openCsv = csvRowsForActiveSource(rows, { ...filters, lifecycle: 'OPEN' });
      const resolvedCsv = csvRowsForActiveSource(rows, { ...filters, lifecycle: 'RESOLVED' });

      expect(allView.detailRows.map((r) => r.source_key).sort()).toEqual([
        `${source}-open`,
        `${source}-resolved`,
      ]);
      expect(allView.kpis.openCount).toBe(1);
      expect(allView.kpis.resolvedCount).toBe(1);
      expect(openView.detailRows.map((r) => r.source_key)).toEqual([`${source}-open`]);
      expect(openView.kpis.openCount).toBe(1);
      expect(openView.kpis.resolvedCount).toBe(0);
      expect(openView.productivityRows).toHaveLength(2);
      expect(openView.topSuppliers).toEqual([{ label: 'Open Supplier', count: 1 }]);
      expect(resolvedView.detailRows.map((r) => r.source_key)).toEqual([`${source}-resolved`]);
      expect(resolvedView.kpis.openCount).toBe(0);
      expect(resolvedView.kpis.resolvedCount).toBe(1);
      expect(resolvedView.productivityRows).toHaveLength(1);
      expect(resolvedView.topSuppliers).toEqual([{ label: 'Resolved Supplier', count: 1 }]);
      expect(allCsv).toHaveLength(2);
      expect(openCsv).toHaveLength(1);
      expect(resolvedCsv).toHaveLength(1);
    }
  });

  test('detail/export columns align to source workbook visible columns and include Category', () => {
    expect(displayColumnsForSource('ZR')).toEqual([
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
    ]);
    expect(displayColumnsForSource('STOREBOOK')).toEqual([
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
    ]);
    expect(csvHeadersForSource('ZR')[0]).toBe('Source');
    expect(csvHeadersForSource('ZR')).toContain('Category');
    expect(csvHeadersForSource('ZR')).toContain('Amount in local currency');
    expect(csvHeadersForSource('ZR')).not.toEqual(expect.arrayContaining([
      'Cleared/open items symbol',
      'Posting Key',
      'Clearing date',
      'Clearing Document',
      'Net due date symbol',
      'Total Amount',
    ]));
    expect(csvHeadersForSource('STOREBOOK')).toContain('Category');
  });
});
