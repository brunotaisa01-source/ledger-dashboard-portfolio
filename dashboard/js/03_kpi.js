"use strict";
function computeKPIs(rows, sheetFilter) {
  if (sheetFilter) rows = teamViewRows(rows, sheetFilter);
  const headerRowsData = headerRows(rows);
  let total_balance = 0;
  let aged_0_30 = 0, aged_31_60 = 0, aged_61_90 = 0;
  let aged_91_120 = 0, aged_121_180 = 0, aged_180_plus = 0;
  let aged_0_30_count = 0, aged_31_60_count = 0, aged_61_90_count = 0;
  let aged_91_120_count = 0, aged_121_180_count = 0, aged_180_plus_count = 0;
  const suppliers = /* @__PURE__ */ new Set();
  for (const r of headerRowsData) {
    total_balance += r.tv || 0;
    const a030 = r.a030 || 0, a3160 = r.a3160 || 0, a6190 = r.a6190 || 0;
    const a91120 = r.a91120 || 0, a121180 = r.a121180 || 0, a180 = r.a180 || 0;
    aged_0_30 += a030;
    aged_31_60 += a3160;
    aged_61_90 += a6190;
    aged_91_120 += a91120;
    aged_121_180 += a121180;
    aged_180_plus += a180;
    if (a030) aged_0_30_count++;
    if (a3160) aged_31_60_count++;
    if (a6190) aged_61_90_count++;
    if (a91120) aged_91_120_count++;
    if (a121180) aged_121_180_count++;
    if (a180) aged_180_plus_count++;
    if (r.s) suppliers.add(vendorKey(r));
  }
  const total_vendors = suppliers.size;
  const total_overdue = aged_0_30 + aged_31_60 + aged_61_90 + aged_91_120 + aged_121_180 + aged_180_plus;
  const aged_120_plus = aged_121_180 + aged_180_plus;
  const aged_90_plus = aged_91_120 + aged_121_180 + aged_180_plus;
  const detailRowsData = filterDocsByBucket(detailRows(rows), globalBucketFilter);
  let currentDocs = 0;
  let overdueDocs = 0;
  let currentValue = 0;
  let overdueValue = 0;
  let aged_0_30_docs = 0, aged_31_60_docs = 0, aged_61_90_docs = 0;
  let aged_91_120_docs = 0, aged_121_180_docs = 0, aged_180_plus_docs = 0;
  for (const row of detailRowsData) {
    const hasAg = hasAging(row);
    const amt = row.a || 0;
    if (hasAg) {
      overdueDocs += 1;
      overdueValue += amt;
    } else {
      currentDocs += 1;
      currentValue += amt;
    }
    if (row.a030) aged_0_30_docs++;
    if (row.a3160) aged_31_60_docs++;
    if (row.a6190) aged_61_90_docs++;
    if (row.a91120) aged_91_120_docs++;
    if (row.a121180) aged_121_180_docs++;
    if (row.a180) aged_180_plus_docs++;
  }
  const total_docs = currentDocs + overdueDocs;
  const weekRange = getWeekRange(currentWeek);
  const vendors_worked = new Set(detailRowsData.filter((r) => r.s && r.ad && isInWeek(r.ad, weekRange)).map((r) => vendorKey(r)));
  const docs_worked = detailRowsData.filter((r) => r.ad && isInWeek(r.ad, weekRange)).length;
  const action_rate = total_vendors > 0 ? vendors_worked.size / total_vendors * 100 : 0;
  const critical_pct = Math.abs(total_overdue) > 0 ? Math.min(100, Math.abs(aged_120_plus) / Math.abs(total_overdue) * 100) : 0;
  const aged_90_plus_docs = aged_91_120_docs + aged_121_180_docs + aged_180_plus_docs;
  const aged_90_plus_count = aged_91_120_count + aged_121_180_count + aged_180_plus_count;
  return {
    total_balance,
    total_overdue,
    aged_120_plus,
    aged_90_plus,
    aged_0_30,
    aged_31_60,
    aged_61_90,
    aged_91_120,
    aged_121_180,
    aged_180_plus,
    vendors_worked: vendors_worked.size,
    docs_worked,
    total_vendors,
    total_docs,
    action_rate,
    critical_pct,
    currentDocs,
    overdueDocs,
    currentValue,
    overdueValue,
    aged_0_30_count,
    aged_31_60_count,
    aged_61_90_count,
    aged_91_120_count,
    aged_121_180_count,
    aged_180_plus_count,
    aged_90_plus_count,
    // composite: 91-120 + 121-180 + 180+
    aged_0_30_docs,
    aged_31_60_docs,
    aged_61_90_docs,
    aged_91_120_docs,
    aged_121_180_docs,
    aged_180_plus_docs,
    aged_90_plus_docs
    // composite: 91-120 + 121-180 + 180+
  };
}
function computeWorkByOwner(rows) {
  rows = detailRows(rows);
  const weekRange = getWeekRange(currentWeek);
  const work = {};
  for (const row of rows) {
    if (!row.ad || !isInWeek(row.ad, weekRange)) continue;
    const owner = row.o;
    if (!owner) continue;
    if (!work[owner]) work[owner] = { vendors: /* @__PURE__ */ new Set(), docs: 0, amount: 0 };
    if (row.s) work[owner].vendors.add(vendorKey(row));
    work[owner].docs += 1;
    work[owner].amount += row.a || 0;
  }
  return Object.keys(work).map((owner) => ({
    owner,
    vendors_worked: work[owner].vendors.size,
    docs_worked: work[owner].docs,
    total_amount: work[owner].amount
  })).sort((a, b) => b.vendors_worked - a.vendors_worked);
}
function computeEntities(rows) {
  const detailVolumeByCompany = {};
  const bucketActive = globalBucketFilter.size > 0;
  for (const row of filterDocsByBucket(detailRows(rows), globalBucketFilter)) {
    const cc = row.cc;
    if (!cc) continue;
    detailVolumeByCompany[cc] = (detailVolumeByCompany[cc] || 0) + 1;
  }
  rows = headerRows(rows);
  const entities = {};
  for (const row of rows) {
    const cc = row.cc;
    if (!cc) continue;
    if (!entities[cc]) entities[cc] = { CompanyCode: cc, Country: row.co, Currency: row.cur || "", TotalBalance: 0, TotalVol: 0, Aged_121_180: 0, Aged_180_plus: 0, Aged_120_plus: 0 };
    entities[cc].TotalBalance += bucketActive ? sumRowBuckets(row, globalBucketFilter, row.tv || 0) : row.tv || 0;
    entities[cc].TotalVol += row.vv || 0;
    entities[cc].Aged_121_180 += row.a121180 || 0;
    entities[cc].Aged_180_plus += row.a180 || 0;
  }
  const result = Object.values(entities);
  for (const e of result) {
    e.Aged_120_plus = e.Aged_121_180 + e.Aged_180_plus;
    if (detailVolumeByCompany[e.CompanyCode] !== void 0) {
      e.TotalVol = detailVolumeByCompany[e.CompanyCode];
    }
  }
  return result.sort((a, b) => Math.abs(b.TotalBalance) - Math.abs(a.TotalBalance));
}
function getPrevWeek() {
  const idx = SORTED_WEEKS.indexOf(currentWeek);
  return idx >= 0 && idx < SORTED_WEEKS.length - 1 ? SORTED_WEEKS[idx + 1] : null;
}
function deltaHtml(curr, prev, invert, suffix) {
  if (prev === null || prev === void 0) return '<span class="kpi-delta neutral"> vs LW</span>';
  let magDiff, displayDiff;
  if (invert) {
    magDiff = Math.abs(curr) - Math.abs(prev);
    displayDiff = magDiff;
  } else {
    magDiff = curr - prev;
    displayDiff = magDiff;
  }
  const absDiff = Math.abs(displayDiff);
  let label;
  if (absDiff >= 1e6) label = (absDiff / 1e6).toFixed(1) + "M";
  else if (absDiff >= 1e3) label = (absDiff / 1e3).toFixed(0) + "K";
  else label = absDiff.toFixed(0);
  if (absDiff < 0.5) return '<span class="kpi-delta neutral"><i class="fa-solid fa-minus"></i> No change</span>';
  const isGood = invert ? magDiff < 0 : magDiff > 0;
  const arrow = magDiff > 0 ? "fa-arrow-up" : "fa-arrow-down";
  const cls = isGood ? "down" : "up";
  return `<span class="kpi-delta ${cls}"><i class="fa-solid ${arrow}"></i> ${label}${suffix || ""} vs LW</span>`;
}
function computeAgingByOwner(rows, sheetFilter) {
  let dRows = filterDocsByBucket(detailRows(rows), globalBucketFilter);
  if (sheetFilter) dRows = teamViewRows(dRows, sheetFilter);
  const owners = {};
  for (const r of dRows) {
    const o = r.o || "Unassigned";
    if (!owners[o]) owners[o] = { owner: o, a030: 0, a3160: 0, a6190: 0, a91120: 0, a121180: 0, a180: 0, total: 0 };
    owners[o].a030 += Math.abs(r.a030 || 0);
    owners[o].a3160 += Math.abs(r.a3160 || 0);
    owners[o].a6190 += Math.abs(r.a6190 || 0);
    owners[o].a91120 += Math.abs(r.a91120 || 0);
    owners[o].a121180 += Math.abs(r.a121180 || 0);
    owners[o].a180 += Math.abs(r.a180 || 0);
  }
  for (const o of Object.values(owners)) {
    o.total = o.a030 + o.a3160 + o.a6190 + o.a91120 + o.a121180 + o.a180;
  }
  return Object.values(owners).sort((a, b) => b.total - a.total).slice(0, 8);
}
function isOverdueBucketSelected(bucketFilter) {
  return bucketFilter.has("ALL_OVERDUE") || bucketFilter.has("0-30") || bucketFilter.has("31-60") || bucketFilter.has("61-90") || bucketFilter.has("91-120") || bucketFilter.has("121-180") || bucketFilter.has("180+");
}
function isAgingBucketVisible(bucket, bucketFilter = globalBucketFilter) {
  return bucketFilter.size === 0 || bucketFilter.has("ALL_OVERDUE") || bucketFilter.has(bucket);
}
function computeAgingByQueryType(rows, bucketFilter = globalBucketFilter) {
  const hRows = headerRows(rows).filter((r) => r.sh.toUpperCase() === "ROL");
  const types = {};
  for (const r of hRows) {
    const t = r.qt || "Unknown";
    if (!types[t]) types[t] = { type: t, a030: 0, a3160: 0, a6190: 0, a91120: 0, a121180: 0, a180: 0, total: 0 };
    if (isAgingBucketVisible("0-30", bucketFilter)) types[t].a030 += Math.abs(r.a030 || 0);
    if (isAgingBucketVisible("31-60", bucketFilter)) types[t].a3160 += Math.abs(r.a3160 || 0);
    if (isAgingBucketVisible("61-90", bucketFilter)) types[t].a6190 += Math.abs(r.a6190 || 0);
    if (isAgingBucketVisible("91-120", bucketFilter)) types[t].a91120 += Math.abs(r.a91120 || 0);
    if (isAgingBucketVisible("121-180", bucketFilter)) types[t].a121180 += Math.abs(r.a121180 || 0);
    if (isAgingBucketVisible("180+", bucketFilter)) types[t].a180 += Math.abs(r.a180 || 0);
  }
  for (const t of Object.values(types)) {
    t.total = t.a030 + t.a3160 + t.a6190 + t.a91120 + t.a121180 + t.a180;
  }
  return Object.values(types).sort((a, b) => b.total - a.total).slice(0, 8);
}
function bucketKPIFieldValue(kpis, key, bucketFilter = globalBucketFilter) {
  if (bucketFilter.size === 0) return kpis[key] || 0;
  const sumValueBuckets = () => {
    if (bucketFilter.has("ALL_OVERDUE")) return kpis.total_overdue || 0;
    if (!isOverdueBucketSelected(bucketFilter)) return 0;
    let sum = 0;
    if (bucketFilter.has("0-30")) sum += kpis.aged_0_30 || 0;
    if (bucketFilter.has("31-60")) sum += kpis.aged_31_60 || 0;
    if (bucketFilter.has("61-90")) sum += kpis.aged_61_90 || 0;
    if (bucketFilter.has("91-120")) sum += kpis.aged_91_120 || 0;
    if (bucketFilter.has("121-180")) sum += kpis.aged_121_180 || 0;
    if (bucketFilter.has("180+")) sum += kpis.aged_180_plus || 0;
    return sum;
  };
  const sumDocBuckets = () => {
    if (bucketFilter.has("ALL_OVERDUE")) return kpis.overdueDocs || 0;
    if (!isOverdueBucketSelected(bucketFilter)) return 0;
    let sum = 0;
    if (bucketFilter.has("0-30")) sum += kpis.aged_0_30_docs || 0;
    if (bucketFilter.has("31-60")) sum += kpis.aged_31_60_docs || 0;
    if (bucketFilter.has("61-90")) sum += kpis.aged_61_90_docs || 0;
    if (bucketFilter.has("91-120")) sum += kpis.aged_91_120_docs || 0;
    if (bucketFilter.has("121-180")) sum += kpis.aged_121_180_docs || 0;
    if (bucketFilter.has("180+")) sum += kpis.aged_180_plus_docs || 0;
    return sum;
  };
  const sumSupplierBuckets = () => {
    if (bucketFilter.has("ALL_OVERDUE")) return kpis.total_vendors || 0;
    if (!isOverdueBucketSelected(bucketFilter)) return 0;
    let sum = 0;
    if (bucketFilter.has("0-30")) sum += kpis.aged_0_30_count || 0;
    if (bucketFilter.has("31-60")) sum += kpis.aged_31_60_count || 0;
    if (bucketFilter.has("61-90")) sum += kpis.aged_61_90_count || 0;
    if (bucketFilter.has("91-120")) sum += kpis.aged_91_120_count || 0;
    if (bucketFilter.has("121-180")) sum += kpis.aged_121_180_count || 0;
    if (bucketFilter.has("180+")) sum += kpis.aged_180_plus_count || 0;
    return sum;
  };
  if (key === "total_overdue") return sumValueBuckets();
  if (key === "overdueDocs") return sumDocBuckets();
  if (key === "aged_0_30") return isAgingBucketVisible("0-30", bucketFilter) ? kpis.aged_0_30 || 0 : 0;
  if (key === "aged_31_60") return isAgingBucketVisible("31-60", bucketFilter) ? kpis.aged_31_60 || 0 : 0;
  if (key === "aged_61_90") return isAgingBucketVisible("61-90", bucketFilter) ? kpis.aged_61_90 || 0 : 0;
  if (key === "aged_91_120") return isAgingBucketVisible("91-120", bucketFilter) ? kpis.aged_91_120 || 0 : 0;
  if (key === "aged_121_180") return isAgingBucketVisible("121-180", bucketFilter) ? kpis.aged_121_180 || 0 : 0;
  if (key === "aged_180_plus") return isAgingBucketVisible("180+", bucketFilter) ? kpis.aged_180_plus || 0 : 0;
  if (key === "aged_0_30_docs") return isAgingBucketVisible("0-30", bucketFilter) ? kpis.aged_0_30_docs || 0 : 0;
  if (key === "aged_31_60_docs") return isAgingBucketVisible("31-60", bucketFilter) ? kpis.aged_31_60_docs || 0 : 0;
  if (key === "aged_61_90_docs") return isAgingBucketVisible("61-90", bucketFilter) ? kpis.aged_61_90_docs || 0 : 0;
  if (key === "aged_91_120_docs") return isAgingBucketVisible("91-120", bucketFilter) ? kpis.aged_91_120_docs || 0 : 0;
  if (key === "aged_121_180_docs") return isAgingBucketVisible("121-180", bucketFilter) ? kpis.aged_121_180_docs || 0 : 0;
  if (key === "aged_180_plus_docs") return isAgingBucketVisible("180+", bucketFilter) ? kpis.aged_180_plus_docs || 0 : 0;
  if (key === "aged_0_30_count") return isAgingBucketVisible("0-30", bucketFilter) ? kpis.aged_0_30_count || 0 : 0;
  if (key === "aged_31_60_count") return isAgingBucketVisible("31-60", bucketFilter) ? kpis.aged_31_60_count || 0 : 0;
  if (key === "aged_61_90_count") return isAgingBucketVisible("61-90", bucketFilter) ? kpis.aged_61_90_count || 0 : 0;
  if (key === "aged_91_120_count") return isAgingBucketVisible("91-120", bucketFilter) ? kpis.aged_91_120_count || 0 : 0;
  if (key === "aged_121_180_count") return isAgingBucketVisible("121-180", bucketFilter) ? kpis.aged_121_180_count || 0 : 0;
  if (key === "aged_180_plus_count") return isAgingBucketVisible("180+", bucketFilter) ? kpis.aged_180_plus_count || 0 : 0;
  if (key === "aged_120_plus") return bucketFilter.has("ALL_OVERDUE") ? kpis.aged_120_plus || 0 : (bucketFilter.has("121-180") ? kpis.aged_121_180 || 0 : 0) + (bucketFilter.has("180+") ? kpis.aged_180_plus || 0 : 0);
  if (key === "aged_90_plus") return bucketFilter.has("ALL_OVERDUE") ? kpis.aged_90_plus || 0 : (bucketFilter.has("91-120") ? kpis.aged_91_120 || 0 : 0) + (bucketFilter.has("121-180") ? kpis.aged_121_180 || 0 : 0) + (bucketFilter.has("180+") ? kpis.aged_180_plus || 0 : 0);
  if (key === "aged_90_plus_docs") return bucketFilter.has("ALL_OVERDUE") ? kpis.aged_90_plus_docs || 0 : (bucketFilter.has("91-120") ? kpis.aged_91_120_docs || 0 : 0) + (bucketFilter.has("121-180") ? kpis.aged_121_180_docs || 0 : 0) + (bucketFilter.has("180+") ? kpis.aged_180_plus_docs || 0 : 0);
  if (key === "aged_90_plus_count") return bucketFilter.has("ALL_OVERDUE") ? kpis.aged_90_plus_count || 0 : (bucketFilter.has("91-120") ? kpis.aged_91_120_count || 0 : 0) + (bucketFilter.has("121-180") ? kpis.aged_121_180_count || 0 : 0) + (bucketFilter.has("180+") ? kpis.aged_180_plus_count || 0 : 0);
  if (key.endsWith("_docs")) return sumDocBuckets();
  if (key.endsWith("_count")) return sumSupplierBuckets();
  return kpis[key] || 0;
}
function bucketKPIValue(kpis) {
  const isValue = viewModeFilter === "VALUE";
  const isTx = viewModeFilter === "TRANSACTIONS";
  if (globalBucketFilter.size === 0) {
    return isValue ? kpis.total_balance : isTx ? kpis.total_docs : kpis.total_vendors;
  }
  if (!isValue && !isTx) return kpis.total_vendors;
  const hasAllOverdue = globalBucketFilter.has("ALL_OVERDUE");
  const hasNotOverdue = globalBucketFilter.has("NOT_OVERDUE");
  if (hasAllOverdue && hasNotOverdue) {
    return isValue ? kpis.total_balance : kpis.total_docs;
  }
  if (hasAllOverdue) return isValue ? kpis.total_overdue : kpis.overdueDocs;
  if (hasNotOverdue) return isValue ? kpis.total_balance - kpis.total_overdue : isTx ? kpis.currentDocs : kpis.total_vendors;
  let sum = 0;
  if (isValue) {
    for (const b of globalBucketFilter) {
      if (b === "0-30") sum += kpis.aged_0_30;
      else if (b === "31-60") sum += kpis.aged_31_60;
      else if (b === "61-90") sum += kpis.aged_61_90;
      else if (b === "91-120") sum += kpis.aged_91_120;
      else if (b === "121-180") sum += kpis.aged_121_180;
      else if (b === "180+") sum += kpis.aged_180_plus;
    }
  } else {
    for (const b of globalBucketFilter) {
      if (b === "0-30") sum += kpis.aged_0_30_docs;
      else if (b === "31-60") sum += kpis.aged_31_60_docs;
      else if (b === "61-90") sum += kpis.aged_61_90_docs;
      else if (b === "91-120") sum += kpis.aged_91_120_docs;
      else if (b === "121-180") sum += kpis.aged_121_180_docs;
      else if (b === "180+") sum += kpis.aged_180_plus_docs;
    }
  }
  return sum;
}
function bucketKPIFmt(kpis) {
  const val = bucketKPIValue(kpis);
  const isValue = viewModeFilter === "VALUE";
  const isTx = viewModeFilter === "TRANSACTIONS";
  return isValue ? fmt(val) : isTx ? val.toLocaleString() : String(val);
}
function bucketKPITitle(kpis) {
  const val = bucketKPIValue(kpis);
  const isValue = viewModeFilter === "VALUE";
  const isTx = viewModeFilter === "TRANSACTIONS";
  return isValue ? fmtExact(val) : isTx ? val + " transactions" : val + " suppliers";
}
function computeOTP(rows, sheetFilter) {
  let dRows = filterDocsByBucket(detailRows(rows), globalBucketFilter);
  if (sheetFilter) dRows = teamViewRows(dRows, sheetFilter);
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  let onTime = 0, late = 0, hasEstimated = false;
  for (const r of dRows) {
    if (!r.nd) continue;
    if (r.nde) hasEstimated = true;
    const parts = r.nd.split("-");
    if (parts.length !== 3) continue;
    const nd = new Date(+parts[2], +parts[1] - 1, +parts[0]);
    if (isNaN(nd.getTime()) || nd > today) continue;
    const hasAg = hasAging(r);
    if (hasAg) late++;
    else onTime++;
  }
  const total = onTime + late;
  return { otp: total > 0 ? onTime / total * 100 : 100, onTime, late, hasEstimated };
}
