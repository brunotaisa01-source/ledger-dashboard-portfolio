"use strict";
function matchesTeamView(row, teamFilter) {
  if (!teamFilter) return true;
  return (row.sh || "").toUpperCase() === teamFilter.toUpperCase();
}
function teamViewRows(rows, teamFilter) {
  return teamFilter ? rows.filter((r) => matchesTeamView(r, teamFilter)) : rows;
}
function applyFilters(rows, skipSearch) {
  let filtered = rows.filter((row) => {
    if (countryFilter.size > 0 && !countryFilter.has(row.co)) return false;
    if (companyFilter.size > 0 && !companyFilter.has(row.cc)) return false;
    if (statusFilter.size > 0 && !statusFilter.has(row.st || "")) return false;
    if (queryTypeFilter.size > 0 && !queryTypeFilter.has(row.qt || "")) return false;
    if (ownerFilter.size > 0 && !ownerFilter.has(row.o || "")) return false;
    if (vendorCategoryFilter.size > 0 && !vendorCategoryFilter.has(row.vc || "")) return false;
    if (balanceTypeFilter.size > 0) {
      const isHeader = (row.rl || "").toUpperCase() === "HEADER";
      const signedValue = isHeader ? row.tv || 0 : row.a || 0;
      const itemBalanceType = signedValue > 0 ? "DEBIT" : "CREDIT";
      if (!balanceTypeFilter.has(itemBalanceType)) return false;
    }
    return true;
  });
  if (docCategoryFilter.size > 0) {
    const filteredDetails = filtered.filter((row) => {
      if ((row.rl || "").toUpperCase() !== "DETAIL") return false;
      const category = docCategory(row);
      return docCategoryFilter.has(category);
    });
    const validSuppliers = new Set(filteredDetails.map((r) => vendorKey(r)));
    const filteredHeaders = filtered.filter((row) => {
      if ((row.rl || "").toUpperCase() !== "HEADER") return false;
      return validSuppliers.has(vendorKey(row));
    });
    filtered = [...filteredHeaders, ...filteredDetails];
  }
  if (paymentBlockFilter.size > 0) {
    const pbDetails = filtered.filter((row) => {
      if ((row.rl || "").toUpperCase() !== "DETAIL") return false;
      return paymentBlockFilter.has(row.pb || "");
    });
    const pbSuppliers = new Set(pbDetails.map((r) => vendorKey(r)));
    const pbHeaders = filtered.filter((row) => {
      if ((row.rl || "").toUpperCase() !== "HEADER") return false;
      return pbSuppliers.has(vendorKey(row));
    });
    filtered = [...pbHeaders, ...pbDetails];
  }
  if (globalBucketFilter.size > 0) {
    const specificBuckets = [...globalBucketFilter].filter((b) => b !== "NOT_OVERDUE" && b !== "ALL_OVERDUE");
    if (specificBuckets.length > 0) {
      const bucketHeaders = filtered.filter((row) => {
        if ((row.rl || "").toUpperCase() !== "HEADER") return false;
        for (const b of specificBuckets) {
          if (matchesBucket(row, b)) return true;
        }
        return false;
      });
      const bucketSuppliers = new Set(bucketHeaders.map((r) => r.s + "|" + r.cc));
      const bucketDetails = filtered.filter((row) => {
        if ((row.rl || "").toUpperCase() !== "DETAIL") return false;
        return bucketSuppliers.has(row.s + "|" + row.cc);
      });
      filtered = [...bucketHeaders, ...bucketDetails];
    }
  }
  if (supplierSearchFilter && !skipSearch) {
    const search = supplierSearchFilter;
    const matchingSuppliers = /* @__PURE__ */ new Set();
    filtered.forEach((r) => {
      if (r.s && r.s.toLowerCase().includes(search) || r.sn && r.sn.toLowerCase().includes(search)) {
        matchingSuppliers.add(r.s);
      }
    });
    filtered = filtered.filter((r) => matchingSuppliers.has(r.s));
  }
  return filtered;
}
let _aggCacheVersion = 0;
let _aggCache = { data: null, key: "", result: null };
function aggregateSuppliers(rows, sheetFilter) {
  const thisVersion = ++_aggCacheVersion;
  const _origRows = rows;
  const key = (sheetFilter || "") + "|" + rows.length + "|" + (rows[0]?.s || "") + "|" + (rows[rows.length - 1]?.s || "");
  if (_aggCache.data === _origRows && _aggCache.key === key) return _aggCache.result;
  if (sheetFilter) rows = teamViewRows(rows, sheetFilter);
  const allFilteredRows = rows;
  rows = headerRows(rows);
  const suppliers = {};
  for (const row of rows) {
    if (!row.s) continue;
    const supplierKey = row.s + "|" + (row.cc || "");
    if (!suppliers[supplierKey]) {
      suppliers[supplierKey] = {
        Supplier: row.s,
        SupplierNumber: row.s,
        SupplierName: row.sn,
        Owner: row.o || "",
        Sheet: row.sh,
        CompanyCode: row.cc,
        Country: row.co,
        Currency: row.cur || "",
        Status: row.st || "",
        QueryType: row.qt || "",
        Comment: row.cm || "",
        VendorCategory: row.vc || "",
        ActionDate: row.ad || "",
        NextStep: row.ns || "",
        TotalAmount: 0,
        TotalVol: 0,
        Aged_0_30: 0,
        Aged_31_60: 0,
        Aged_61_90: 0,
        Aged_91_120: 0,
        Aged_121_180: 0,
        Aged_180_plus: 0,
        docs_0_30: 0,
        docs_31_60: 0,
        docs_61_90: 0,
        docs_91_120: 0,
        docs_121_180: 0,
        docs_180_plus: 0,
        overdueDocs: 0,
        doc_count: 0
      };
    }
    suppliers[supplierKey].TotalAmount += row.tv || 0;
    suppliers[supplierKey].TotalVol += row.vv || 0;
    suppliers[supplierKey].Aged_0_30 += row.a030 || 0;
    suppliers[supplierKey].Aged_31_60 += row.a3160 || 0;
    suppliers[supplierKey].Aged_61_90 += row.a6190 || 0;
    suppliers[supplierKey].Aged_91_120 += row.a91120 || 0;
    suppliers[supplierKey].Aged_121_180 += row.a121180 || 0;
    suppliers[supplierKey].Aged_180_plus += row.a180 || 0;
  }
  const detRows = allFilteredRows.filter((r) => (r.rl || "").toUpperCase() === "DETAIL");
  for (const row of detRows) {
    if (!row.s) continue;
    const supplierKey = row.s + "|" + (row.cc || "");
    if (!suppliers[supplierKey]) continue;
    suppliers[supplierKey].doc_count++;
    if (row.a030) suppliers[supplierKey].docs_0_30++;
    if (row.a3160) suppliers[supplierKey].docs_31_60++;
    if (row.a6190) suppliers[supplierKey].docs_61_90++;
    if (row.a91120) suppliers[supplierKey].docs_91_120++;
    if (row.a121180) suppliers[supplierKey].docs_121_180++;
    if (row.a180) suppliers[supplierKey].docs_180_plus++;
    const hasAg = hasAging(row);
    if (hasAg) suppliers[supplierKey].overdueDocs++;
  }
  const result = Object.values(suppliers);
  for (const s of result) {
    s.total_overdue = s.Aged_0_30 + s.Aged_31_60 + s.Aged_61_90 + s.Aged_91_120 + s.Aged_121_180 + s.Aged_180_plus;
    s.Aged_90_plus = s.Aged_91_120 + s.Aged_121_180 + s.Aged_180_plus;
    const riskTier = creditRiskTier(s.TotalAmount);
    if (riskTier === "HIGH_RISK_DEBIT" || riskTier === "HIGH_RISK") {
      s.Priority = "HIGH";
    } else if (riskTier === "MEDIUM_RISK") {
      s.Priority = "MEDIUM";
    } else {
      s.Priority = "LOW";
    }
    s.doc_count = s.doc_count || s.TotalVol || 0;
  }
  const sorted = result.filter((s) => s.TotalAmount !== 0 || s.TotalVol !== 0).sort((a, b) => Math.abs(b.TotalAmount) - Math.abs(a.TotalAmount));
  if (thisVersion !== _aggCacheVersion) return sorted;
  _aggCache = { data: _origRows, key, result: sorted };
  return sorted;
}
function filterByBucket(suppliers, bucketFilter) {
  if (!bucketFilter || bucketFilter instanceof Set && bucketFilter.size === 0) return suppliers;
  const filters = bucketFilter instanceof Set ? bucketFilter : /* @__PURE__ */ new Set([bucketFilter]);
  return suppliers.filter((s) => {
    for (const b of filters) {
      if (b === "NOT_OVERDUE" && s.total_overdue === 0) return true;
      if (b === "ALL_OVERDUE" && s.total_overdue !== 0) return true;
      if (b === "0-30" && s.Aged_0_30 !== 0) return true;
      if (b === "31-60" && s.Aged_31_60 !== 0) return true;
      if (b === "61-90" && s.Aged_61_90 !== 0) return true;
      if (b === "91-120" && s.Aged_91_120 !== 0) return true;
      if (b === "121-180" && s.Aged_121_180 !== 0) return true;
      if (b === "180+" && s.Aged_180_plus !== 0) return true;
    }
    return false;
  });
}
function sumBucketValues(s, bucketSet, defaultVal) {
  if (!bucketSet || bucketSet.size === 0) return defaultVal;
  const agingBuckets = [...bucketSet].filter((b) => b !== "NOT_OVERDUE" && b !== "ALL_OVERDUE");
  if (agingBuckets.length === 0) {
    if (bucketSet.has("ALL_OVERDUE")) return s.total_overdue || 0;
    if (bucketSet.has("NOT_OVERDUE")) return s.TotalAmount - (s.total_overdue || 0);
    return defaultVal;
  }
  let sum = 0;
  for (const b of agingBuckets) {
    if (b === "0-30") sum += s.Aged_0_30 || 0;
    else if (b === "31-60") sum += s.Aged_31_60 || 0;
    else if (b === "61-90") sum += s.Aged_61_90 || 0;
    else if (b === "91-120") sum += s.Aged_91_120 || 0;
    else if (b === "121-180") sum += s.Aged_121_180 || 0;
    else if (b === "180+") sum += s.Aged_180_plus || 0;
  }
  return sum;
}
function sumBucketDocs(s, bucketSet, defaultVal) {
  if (!bucketSet || bucketSet.size === 0) return defaultVal;
  const agingBuckets = [...bucketSet].filter((b) => b !== "NOT_OVERDUE" && b !== "ALL_OVERDUE");
  if (agingBuckets.length === 0) {
    if (bucketSet.has("ALL_OVERDUE")) return s.overdueDocs || 0;
    if (bucketSet.has("NOT_OVERDUE")) return (s.doc_count || s.TotalVol || 0) - (s.overdueDocs || 0);
    return defaultVal;
  }
  let sum = 0;
  for (const b of agingBuckets) {
    if (b === "0-30") sum += s.docs_0_30 || 0;
    else if (b === "31-60") sum += s.docs_31_60 || 0;
    else if (b === "61-90") sum += s.docs_61_90 || 0;
    else if (b === "91-120") sum += s.docs_91_120 || 0;
    else if (b === "121-180") sum += s.docs_121_180 || 0;
    else if (b === "180+") sum += s.docs_180_plus || 0;
  }
  return sum;
}
function filterDocsByBucket(docs, bucketSet) {
  if (!bucketSet || bucketSet.size === 0) return docs;
  const specific = [...bucketSet].filter((b) => b !== "NOT_OVERDUE" && b !== "ALL_OVERDUE");
  const hasAllOverdue = bucketSet.has("ALL_OVERDUE");
  const hasNotOverdue = bucketSet.has("NOT_OVERDUE");
  if (specific.length === 0 && !hasAllOverdue && !hasNotOverdue) return docs;
  return docs.filter((d) => {
    if (hasAllOverdue && hasAging(d)) return true;
    if (hasNotOverdue && !hasAging(d)) return true;
    for (const b of specific) {
      if (matchesBucket(d, b)) return true;
    }
    return false;
  });
}
function topNByPriority(rows, n, valueGetter) {
  const sortVal = typeof valueGetter === "function" ? valueGetter : (r) => Math.abs(r.TotalAmount || 0);
  const buckets = { HIGH: [], MEDIUM: [], LOW: [] };
  for (const r of rows) {
    if (r.Priority && buckets[r.Priority]) buckets[r.Priority].push(r);
  }
  for (const k of Object.keys(buckets)) {
    buckets[k].sort((a, b) => sortVal(b) - sortVal(a));
    if (n > 0) {
      buckets[k] = buckets[k].slice(0, n);
    }
  }
  return [...buckets.HIGH, ...buckets.MEDIUM, ...buckets.LOW];
}
function getDocumentRows(filtered, teamFilter) {
  let docs = filtered.filter((r) => (r.rl || "").toUpperCase() === "DETAIL");
  if (teamFilter) docs = teamViewRows(docs, teamFilter);
  docs = filterDocsByBucket(docs, globalBucketFilter);
  return docs.sort((a, b) => Math.abs(b.a || 0) - Math.abs(a.a || 0));
}
