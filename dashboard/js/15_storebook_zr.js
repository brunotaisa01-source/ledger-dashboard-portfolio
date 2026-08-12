let sbzData = null;
let sbzMode = "STOREBOOK";
let sbzPage = 1;
let sbzPageSize = 25;
let sbzSort = { col: "opened_date", dir: "desc" };
let sbzFilteredCache = [];
let sbzCharts = {};
let sbzFiltersWired = false;
let sbzDefaultsApplied = false;
let sbzXmsDefaultsApplied = false;
let sbzSupplierDrill = null;
let sbzFilterTimer = null;
const SBZ_SOURCE_LABELS = {
  STOREBOOK: "Storebook",
  ZR: "Z & R"
};
const SBZ_ZR_TABLE_COLS = [
  { id: "owner", label: "Owner", keys: ["Owner", "owner"] },
  { id: "uniqueRef", label: "Unique Ref", keys: ["Unique Ref", "unique_ref", "uniqueRef", "source_key", "sourceKey"] },
  { id: "documentNumber", label: "Document Number", keys: ["Document Number", "document_number"] },
  { id: "vendor", label: "Vendor", keys: ["Vendor", "supplier_id", "vendor_id"] },
  { id: "companyCode", label: "Company Code", keys: ["Company Code", "company_code", "company_or_entity"] },
  { id: "vendorName1", label: "Vendor Name 1", keys: ["Vendor Name 1", "supplier_name", "vendor_name"] },
  { id: "documentType", label: "Document Type", keys: ["Document Type", "document_type"] },
  { id: "reference", label: "Reference", keys: ["Reference", "reference"] },
  { id: "documentDate", label: "Document Date", keys: ["Document Date", "document_date", "opened_date"], fmt: (v) => sbzFmtDate(v) },
  { id: "amountLocal", label: "Amount in local currency", keys: ["Amount in local currency", "value"], fmt: (v) => sbzFmtMoney(v) },
  { id: "localCurrency", label: "Local Currency", keys: ["Local Currency", "local_currency"] },
  { id: "netDueDate", label: "Net due date", keys: ["Net due date", "net_due_date"], fmt: (v) => sbzFmtDate(v) },
  { id: "taxCode", label: "Tax code", keys: ["Tax code", "tax_code"] },
  { id: "postingDate", label: "Posting Date", keys: ["Posting Date", "posting_date"], fmt: (v) => sbzFmtDate(v) },
  { id: "text", label: "Text", keys: ["Text", "text"] },
  { id: "paymentBlock", label: "Payment Block", keys: ["Payment Block", "payment_block"] },
  { id: "userName", label: "User name", keys: ["User name", "user_name"] },
  { id: "category", label: "Category", keys: ["Category", "category"] },
  { id: "status", label: "Status", keys: ["Status", "status"] },
  { id: "actionDate", label: "Action Date", keys: ["action date", "Action Date", "action_date"], fmt: (v) => sbzFmtDate(v) },
  { id: "comments", label: "Comments", keys: ["Comments", "comments"] }
];
const SBZ_STOREBOOK_TABLE_COLS = [
  { id: "owner", label: "Owner", keys: ["Owner", "owner"] },
  { id: "statusSystem", label: "Status sytem", keys: ["status_system", "Status sytem", "Status system"] },
  { id: "createdDate", label: "Created Date", keys: ["Created Date", "created_date", "opened_date"], fmt: (v) => sbzFmtDate(v) },
  { id: "financialNetPriceCogs", label: "Financial Net Price COGS", keys: ["Financial Net Price COGS", "financial_net_price_cogs", "value"], fmt: (v) => sbzFmtMoney(v) },
  { id: "site", label: "Site", keys: ["site_id", "Site", "site"] },
  { id: "site2", label: "Site", keys: ["site_name", "Site_2", "Site.1", "Site 2", "site_2"] },
  { id: "supplier", label: "Supplier", keys: ["Supplier", "supplier_id"] },
  { id: "supplier2", label: "Supplier", keys: ["Supplier_2", "Supplier.1", "Supplier 2", "supplier_name"] },
  { id: "mainStorebook", label: "Main Storebook #", keys: ["Main Storebook #", "main_storebook_number"] },
  { id: "mainVendorDoc", label: "Main Vendor Doc.", keys: ["Main Vendor Doc.", "main_vendor_doc"] },
  { id: "uniqueRef", label: "Unique Ref", keys: ["Unique Ref", "unique_ref", "uniqueRef", "source_key", "sourceKey"] },
  { id: "category", label: "Category", keys: ["Category", "category"] },
  { id: "comments", label: "Comments", keys: ["Comments", "comments"] },
  { id: "actionDate", label: "Action Date", keys: ["Action Date", "action date", "action_date"], fmt: (v) => sbzFmtDate(v) },
  { id: "status", label: "Status", keys: ["Status", "status"] }
];
function sbzToSource(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (raw === "ZR" || raw === "Z&R" || raw === "ZANDR") return "ZR";
  return "STOREBOOK";
}
function sbzToNumber(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
function sbzDisplayRawValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  return String(value).trim();
}
function sbzPickRaw(raw, keys) {
  for (const key of keys) {
    if (raw[key] != null && raw[key] !== "") return raw[key];
  }
  return null;
}
function sbzNormalizeDate(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const uk = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (uk) return `${uk[3]}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  return raw;
}
function sbzIsResolvedStatus(status) {
  const value = String(status || "").trim().toUpperCase();
  if (!value) return false;
  if (["OPEN", "UNRESOLVED", "PENDING", "IN PROGRESS", "WIP", "NEW"].some((token) => value.includes(token))) return false;
  return ["CLOSED", "RESOLVED", "COMPLETE", "COMPLETED", "CLEARED", "DONE", "REMOVED", "NON OPEN", "NON-OPEN"].some((token) => value.includes(token));
}
function sbzManualStatus(raw) {
  return String(raw.manual_status ?? raw.manualStatus ?? raw.status ?? raw.Status ?? "").trim() || null;
}
function sbzUniqueRef(raw) {
  return String(raw.unique_ref ?? raw.uniqueRef ?? raw["Unique Ref"] ?? "").trim() || null;
}
function sbzCompanyCode(raw, source) {
  const explicit = String(raw.company_code ?? raw.companyCode ?? raw["Company Code"] ?? "").trim();
  if (explicit) return explicit;
  if (source === "STOREBOOK") {
    const uniqueRef = sbzUniqueRef(raw);
    const fromUniqueRef = uniqueRef ? uniqueRef.split(/\s+/)[0] : "";
    return fromUniqueRef || "9001";
  }
  return String(raw.company_or_entity ?? raw.companyOrEntity ?? raw.entity ?? "").trim() || null;
}
function sbzMapRow(raw) {
  const source = sbzToSource(raw.source ?? raw.Source);
  const actionDate = sbzNormalizeDate(raw.action_date ?? raw.actionDate ?? raw.ActionDate ?? raw["Action Date"] ?? raw["action date"]);
  const status = sbzManualStatus(raw);
  const uniqueRef = sbzUniqueRef(raw);
  const companyCode = sbzCompanyCode(raw, source);
  const rawResolvedDate = sbzNormalizeDate(raw.resolved_date ?? raw.resolvedDate ?? raw.ResolvedDate);
  const row = {
    source,
    snapshot_date: sbzNormalizeDate(raw.snapshot_date ?? raw.snapshotDate ?? raw.SnapshotDate),
    source_key: String(raw.source_key ?? raw.sourceKey ?? raw.SourceKey ?? raw["Unique Ref"] ?? "").trim() || null,
    owner: String(raw.owner ?? raw.Owner ?? "").trim() || null,
    supplier_id: String(raw.supplier_id ?? raw.supplierId ?? raw.vendor_id ?? raw.vendorId ?? raw.Vendor ?? raw.Supplier ?? "").trim() || null,
    supplier_name: String(raw.supplier_name ?? raw.supplierName ?? raw.vendor_name ?? raw.vendorName ?? raw["Vendor Name 1"] ?? raw.Supplier_2 ?? raw["Supplier.1"] ?? "").trim() || null,
    company_or_entity: source === "STOREBOOK" ? companyCode : String(raw.company_or_entity ?? raw.companyOrEntity ?? companyCode ?? "").trim() || null,
    unique_ref: uniqueRef,
    company_code: companyCode,
    status_system: String(raw.status_system ?? raw.statusSystem ?? raw["Status sytem"] ?? raw["Status system"] ?? "").trim() || null,
    site_id: String(raw.site_id ?? raw.siteId ?? raw.Site ?? raw.site ?? "").trim() || null,
    site_name: String(raw.site_name ?? raw.siteName ?? raw.Site_2 ?? raw["Site.1"] ?? raw["Site 2"] ?? raw.site_2 ?? "").trim() || null,
    category: String(raw.category ?? raw.Category ?? "").trim() || null,
    value: sbzToNumber(raw.value ?? raw.Value ?? raw["Amount in local currency"] ?? raw["Financial Net Price COGS"]),
    opened_date: sbzNormalizeDate(raw.opened_date ?? raw.openedDate ?? raw.OpenedDate ?? raw["Created Date"] ?? raw["Document Date"] ?? raw["Posting Date"]),
    action_date: actionDate,
    action_date_source: String(raw.action_date_source ?? raw.actionDateSource ?? "").trim() || null,
    resolved_date: rawResolvedDate || (sbzIsResolvedStatus(status) ? actionDate : null),
    resolution_source: String(raw.resolution_source ?? raw.resolutionSource ?? "").trim() || null,
    status,
    comments: String(raw.comments ?? raw.Comments ?? "").trim() || null
  };
  if (uniqueRef && row["Unique Ref"] == null) row["Unique Ref"] = uniqueRef;
  if (companyCode && row["Company Code"] == null) row["Company Code"] = companyCode;
  if (row.status_system && row["Status sytem"] == null) row["Status sytem"] = row.status_system;
  for (const col of SBZ_ZR_TABLE_COLS.concat(SBZ_STOREBOOK_TABLE_COLS)) {
    for (const key of col.keys) {
      const value = sbzDisplayRawValue(raw[key]);
      if (value != null && row[key] == null) row[key] = value;
    }
  }
  return row;
}
function sbzExtractRows(payload) {
  const rawRows = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray(payload.rows) ? payload.rows : [];
  return rawRows.map((row) => sbzMapRow(row));
}
async function loadStorebookZrData() {
  if (sbzData) return sbzData;
  const b64 = window.DASHBOARD_DATA?.storebook_zr_compressed;
  if (!b64) {
    console.warn("Storebook/ZR data unavailable: missing DASHBOARD_DATA.storebook_zr_compressed");
    sbzData = [];
    return sbzData;
  }
  try {
    const payload = await decompressBlob(b64);
    sbzData = sbzExtractRows(payload);
    return sbzData;
  } catch (e) {
    console.warn("Storebook/ZR decompress error:", e);
    sbzData = [];
    return sbzData;
  }
}
function sbzBusinessDays(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = /* @__PURE__ */ new Date(startIso + "T00:00:00Z");
  const end = /* @__PURE__ */ new Date(endIso + "T00:00:00Z");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return null;
  let days = 0;
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Math.max(0, days - 1);
}
function sbzRangeFrom(filters) {
  return filters.dateFrom || "0000-01-01";
}
function sbzRangeTo(filters) {
  return filters.dateTo || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function sbzIsOpenAt(row, toIso) {
  const opened = row.opened_date || "";
  const resolved = row.resolved_date || "";
  return Boolean(opened) && opened <= toIso && (!resolved || resolved > toIso);
}
function sbzIsResolvedInRange(row, fromIso, toIso) {
  const resolved = row.resolved_date || "";
  return Boolean(resolved) && resolved >= fromIso && resolved <= toIso;
}
function sbzIsProductiveInRange(row, fromIso, toIso) {
  const action = row.action_date || "";
  return Boolean(action) && action >= fromIso && action <= toIso;
}
function sbzIsActiveInPeriod(row, fromIso, toIso) {
  const opened = row.opened_date || "";
  const resolved = row.resolved_date || "";
  return Boolean(opened) && opened <= toIso && (!resolved || resolved >= fromIso);
}
function sbzIsResolvedLifecycle(row, toIso) {
  if (row.resolved_date) return row.resolved_date <= toIso;
  return sbzIsResolvedStatus(row.status);
}
function sbzPassesLifecycle(row, lifecycle, toIso) {
  if (lifecycle === "RESOLVED") return sbzIsResolvedLifecycle(row, toIso);
  if (lifecycle === "OPEN") return !sbzIsResolvedLifecycle(row, toIso) && sbzIsOpenAt(row, toIso);
  return true;
}
function sbzSupplierLabel(row) {
  const name = String(row.supplier_name || "").trim();
  const id = String(row.supplier_id || "").trim();
  return name || id || "Missing supplier";
}
function sbzPassesStaticFilters(row, filters) {
  if (row.source !== filters.source) return false;
  if (filters.statuses.length && !filters.statuses.includes(row.status || "")) return false;
  if (filters.categories.length && !filters.categories.includes(row.category || "")) return false;
  if (filters.companies.length && !filters.companies.includes(row.company_or_entity || "")) return false;
  if (filters.supplierDrill && sbzSupplierLabel(row) !== filters.supplierDrill) return false;
  if (filters.supplierSearch) {
    const needle = filters.supplierSearch.toLowerCase();
    const supplierId = String(row.supplier_id || "").toLowerCase();
    const supplierName = String(row.supplier_name || "").toLowerCase();
    if (!supplierId.includes(needle) && !supplierName.includes(needle)) return false;
  }
  return true;
}
function sbzTopSuppliers(rows, limit = 10) {
  const counts = {};
  rows.forEach((row) => {
    const label = sbzSupplierLabel(row);
    counts[label] = (counts[label] || 0) + 1;
  });
  return Object.entries(counts).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
}
function sbzOperationalRows(rows, source, toIso) {
  const eligibleRows = rows.filter(
    (row) => row.source === source && Boolean(row.snapshot_date) && String(row.snapshot_date) <= toIso
  );
  const effectiveSnapshot = eligibleRows.reduce(
    (latest, row) => String(row.snapshot_date || "") > latest ? String(row.snapshot_date || "") : latest,
    ""
  );
  if (!effectiveSnapshot) return [];
  return sbzUniqueRowsBySnapshotKey(
    eligibleRows.filter((row) => String(row.snapshot_date || "") === effectiveSnapshot)
  );
}
function sbzUniqueEvents(rows, dateField) {
  const seen = /* @__PURE__ */ new Set();
  return rows.filter((row) => {
    const eventDate = String(row[dateField] || "");
    const key = `${String(row.source_key || "")}|${eventDate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function sbzUniqueRowsBySnapshotKey(rows) {
  const seen = /* @__PURE__ */ new Set();
  return rows.filter((row) => {
    const key = String(row.source_key || "").trim();
    if (!key) return true;
    const snapshotKey = `${String(row.snapshot_date || "")}|${key}`;
    if (seen.has(snapshotKey)) return false;
    seen.add(snapshotKey);
    return true;
  });
}
function sbzRowsForCsv(rows, filters) {
  const toIso = sbzRangeTo(filters);
  return sbzOperationalRows(rows, filters.source, toIso).filter((row) => sbzPassesStaticFilters(row, filters)).filter((row) => sbzPassesLifecycle(row, filters.lifecycle, toIso));
}
function sbzDateBoundsForSource(rows, source) {
  const dates = rows.filter((row) => row.source === source && Boolean(row.snapshot_date)).map((row) => String(row.snapshot_date)).sort();
  return {
    earliest: dates[0] || "",
    latest: dates[dates.length - 1] || ""
  };
}
function sbzTruncateLabel(label, maxLength = 28) {
  return label.length > maxLength ? label.slice(0, maxLength - 1).trimEnd() + "..." : label;
}
function sbzAverage(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function sbzBuildViewModel(rows, filters) {
  const fromIso = sbzRangeFrom(filters);
  const toIso = sbzRangeTo(filters);
  const sourceRows = sbzRowsForCsv(rows, filters);
  const filteredRows = sourceRows;
  const historicalRows = rows.filter((row) => sbzPassesStaticFilters(row, filters)).filter((row) => sbzPassesLifecycle(row, filters.lifecycle, toIso));
  const openRows = filteredRows.filter((row) => sbzPassesLifecycle(row, "OPEN", toIso));
  const resolvedRows = sbzUniqueEvents(
    historicalRows.filter((row) => sbzIsResolvedInRange(row, fromIso, toIso)),
    "resolved_date"
  );
  const detailRows = filteredRows;
  const productivityRows = sbzUniqueEvents(
    historicalRows.filter(
      (row) => row.resolution_source !== "auto_missing_from_source" && sbzIsProductiveInRange(row, fromIso, toIso)
    ),
    "action_date"
  );
  const topSuppliers = sbzTopSuppliers(detailRows, 10);
  const openDays = openRows.map((row) => sbzBusinessDays(row.opened_date, toIso)).filter((value) => value != null);
  const resolvedDays = resolvedRows.map((row) => sbzBusinessDays(row.opened_date, row.resolved_date)).filter((value) => value != null);
  const topSupplier = topSuppliers[0] || { label: "n/a", count: 0 };
  return {
    sourceRows,
    filteredRows,
    detailRows,
    productivityRows,
    topSuppliers,
    kpis: {
      openCount: openRows.length,
      avgDaysOpen: sbzAverage(openDays),
      avgDaysResolve: sbzAverage(resolvedDays),
      resolvedCount: resolvedRows.length,
      topSupplierName: topSupplier.label,
      topSupplierCount: topSupplier.count
    }
  };
}
function sbzReadFilters() {
  return {
    source: sbzMode,
    lifecycle: document.getElementById("sbzLifecycle")?.value || "ALL",
    dateFrom: document.getElementById("sbzDateFrom")?.value || "",
    dateTo: document.getElementById("sbzDateTo")?.value || "",
    statuses: xmsGetValues("xms_sbz_status"),
    categories: xmsGetValues("xms_sbz_category"),
    companies: xmsGetValues("xms_sbz_company"),
    supplierSearch: String(document.getElementById("sbzSupplierSearch")?.value || "").trim(),
    supplierDrill: sbzSupplierDrill
  };
}
function sbzFmtDate(value) {
  if (!value) return "";
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
function sbzEsc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function sbzFmtMoney(value) {
  const n = sbzToNumber(value);
  return n == null ? "" : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function sbzDisplayDaysOpen(row) {
  const toIso = sbzRangeTo(sbzReadFilters());
  const days = sbzIsOpenAt(row, toIso) ? sbzBusinessDays(row.opened_date, toIso) : null;
  return days == null ? "" : String(days);
}
function sbzDisplayDaysResolve(row) {
  const days = row.resolved_date ? sbzBusinessDays(row.opened_date, row.resolved_date) : null;
  return days == null ? "" : String(days);
}
function sbzRenderKpis(kpis) {
  const el = document.getElementById("sbzKPIs");
  if (!el) return;
  const card = (label, value, sub, color, clickable = false) => '<div class="sbz-kpi-card' + (clickable ? ' sbz-kpi-clickable" id="sbzTopSupplierKpi" role="button" tabindex="0' : "") + '" style="border-top-color:' + color + ';"><div class="sbz-kpi-label">' + sbzEsc(label) + '</div><div class="sbz-kpi-value" style="color:' + color + ';">' + sbzEsc(value) + '</div><div class="sbz-kpi-sub">' + sbzEsc(sub) + "</div></div>";
  el.innerHTML = card("Open Count", String(kpis.openCount), SBZ_SOURCE_LABELS[sbzMode], "#F59E0B") + card("Avg Days Open", kpis.avgDaysOpen.toFixed(1), "open at selected To date", "#DC3545") + card("Avg Days to Resolve", kpis.avgDaysResolve.toFixed(1), "resolved in selected range", "#3b82f6") + card("Resolved Count", String(kpis.resolvedCount), "resolved in selected range", "#28A745") + card("Top Recurring Supplier", kpis.topSupplierName, kpis.topSupplierCount + " filtered rows", "#7C3AED", true);
  const top = document.getElementById("sbzTopSupplierKpi");
  if (top && kpis.topSupplierName !== "n/a") {
    const apply = () => {
      sbzSupplierDrill = kpis.topSupplierName;
      const search = document.getElementById("sbzSupplierSearch");
      if (search) search.value = "";
      sbzPage = 1;
      updateStorebookZr();
    };
    top.addEventListener("click", apply);
    top.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        apply();
      }
    });
  }
}
function sbzRenderAppliedFilters() {
  const el = document.getElementById("sbzAppliedFilters");
  if (!el) return;
  if (!sbzSupplierDrill) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  el.style.display = "flex";
  el.innerHTML = '<span class="sbz-applied-label">Applied drill-through</span><button type="button" class="sbz-filter-chip" id="sbzClearSupplierDrill"><span>Supplier: ' + sbzEsc(sbzSupplierDrill) + '</span><span class="sbz-chip-x" aria-hidden="true">&times;</span></button>';
  document.getElementById("sbzClearSupplierDrill")?.addEventListener("click", () => {
    sbzSupplierDrill = null;
    sbzPage = 1;
    updateStorebookZr();
  });
}
function sbzDestroyChart(id) {
  if (sbzCharts[id]) {
    try {
      sbzCharts[id].destroy();
    } catch (_e) {
    }
    delete sbzCharts[id];
  }
}
function sbzRenderProductivityChart(rows) {
  const canvas = document.getElementById("sbzProductivityChart");
  if (!canvas) return;
  const counts = {};
  rows.forEach((row) => {
    const key = row.action_date || "";
    if (key) counts[key] = (counts[key] || 0) + 1;
  });
  const labels = Object.keys(counts).sort();
  sbzDestroyChart("productivity");
  sbzCharts.productivity = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: SBZ_SOURCE_LABELS[sbzMode],
        data: labels.map((label) => counts[label]),
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,0.16)",
        fill: true,
        tension: 0.25
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });
}
function sbzRenderTopSupplierChart(items) {
  const canvas = document.getElementById("sbzTopSupplierChart");
  if (!canvas) return;
  const fullLabels = items.map((item) => item.label);
  const labels = fullLabels.map((label) => sbzTruncateLabel(label));
  const valueLabelPlugin = {
    id: "sbzValueLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      const data = chart.data.datasets[0]?.data || [];
      ctx.save();
      ctx.font = "700 13px Inter, Segoe UI, sans-serif";
      ctx.fillStyle = "#F8FAFC";
      ctx.textBaseline = "middle";
      data.forEach((value, index) => {
        const point = meta.data[index];
        if (!point) return;
        ctx.fillText(String(value), point.x + 8, point.y);
      });
      ctx.restore();
    }
  };
  sbzDestroyChart("topSupplier");
  sbzCharts.topSupplier = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Rows",
        data: items.map((item) => item.count),
        backgroundColor: labels.map((_label, i) => ["#7C3AED", "#3b82f6", "#02c39a", "#F59E0B", "#DC3545"][i % 5])
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 32 } },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: {
          callbacks: {
            title(context) {
              const index = context[0]?.dataIndex ?? 0;
              return fullLabels[index] || labels[index] || "";
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: "#E2E8F0", font: { size: 12, weight: "700" }, precision: 0 },
          grid: { color: "rgba(148,163,184,0.22)" }
        },
        y: {
          ticks: { color: "#F8FAFC", font: { size: 12, weight: "500" } },
          grid: { display: false }
        }
      },
      onClick: (_event, elements) => {
        const index = elements && elements[0] ? elements[0].index : -1;
        if (index >= 0 && fullLabels[index]) {
          sbzSupplierDrill = fullLabels[index];
          sbzPage = 1;
          updateStorebookZr();
        }
      }
    },
    plugins: [valueLabelPlugin]
  });
}
function sbzSortRows(rows) {
  const dir = sbzSort.dir === "desc" ? -1 : 1;
  const colDef = sbzTableColumns().find((col) => col.id === sbzSort.col);
  return rows.slice().sort((a, b) => {
    const av = colDef ? sbzCellValue(a, colDef) : a[sbzSort.col];
    const bv = colDef ? sbzCellValue(b, colDef) : b[sbzSort.col];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}
function sbzTableColumns() {
  return sbzMode === "ZR" ? SBZ_ZR_TABLE_COLS : SBZ_STOREBOOK_TABLE_COLS;
}
function sbzCellValue(row, col) {
  return sbzPickRaw(row, col.keys);
}
function sbzRenderTable(rows) {
  const table = document.getElementById("sbzTable");
  if (!table) return;
  const countEl = document.getElementById("sbzRowCount");
  const pagEl = document.getElementById("sbzPagination");
  const sorted = sbzSortRows(rows);
  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / sbzPageSize));
  const columns = sbzTableColumns();
  sbzPage = Math.min(Math.max(1, sbzPage), pageCount);
  const slice = sorted.slice((sbzPage - 1) * sbzPageSize, sbzPage * sbzPageSize);
  const head = "<thead><tr>" + columns.map((col) => {
    const arrow = col.id === sbzSort.col ? sbzSort.dir === "asc" ? " " : " " : "";
    return '<th data-sort="' + sbzEsc(col.id) + '">' + sbzEsc(col.label + arrow) + "</th>";
  }).join("") + "</tr></thead>";
  const body = "<tbody>" + slice.map((row) => {
    const cells = columns.map((col) => {
      const raw = sbzCellValue(row, col);
      const display = col.fmt ? col.fmt(raw, row) : raw == null ? "" : String(raw);
      return "<td>" + sbzEsc(display) + "</td>";
    }).join("");
    return "<tr>" + cells + "</tr>";
  }).join("") + "</tbody>";
  table.innerHTML = head + body;
  table.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-sort") || "";
      if (sbzSort.col === col) sbzSort.dir = sbzSort.dir === "asc" ? "desc" : "asc";
      else {
        sbzSort.col = col;
        sbzSort.dir = "asc";
      }
      sbzRenderTable(rows);
    });
  });
  if (countEl) countEl.textContent = "(" + total + " rows)";
  if (pagEl) {
    pagEl.innerHTML = "<button " + (sbzPage === 1 ? "disabled" : "") + ' onclick="sbzGotoPage(' + (sbzPage - 1) + ')">Prev</button><span style="font-size:0.85rem;color:var(--text-muted);">Page ' + sbzPage + " / " + pageCount + "</span><button " + (sbzPage === pageCount ? "disabled" : "") + ' onclick="sbzGotoPage(' + (sbzPage + 1) + ')">Next</button>';
  }
}
function sbzGotoPage(page) {
  sbzPage = page;
  sbzRenderTable(sbzFilteredCache);
}
function exportStorebookZrCSV() {
  const rows = sbzSortRows(sbzRowsForCsv(sbzData || [], sbzReadFilters()));
  const columns = sbzTableColumns();
  const headers = ["Source"].concat(columns.map((col) => col.label));
  const escapeCell = (value) => {
    if (value == null) return "";
    const s = String(value);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map(escapeCell).join(",")];
  rows.forEach((row) => {
    const cells = [row.source, ...columns.map((col) => {
      const raw = sbzCellValue(row, col);
      return col.fmt ? col.fmt(raw, row) : raw == null ? "" : String(raw);
    })];
    lines.push(cells.map(escapeCell).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "storebook_zr_" + sbzMode.toLowerCase() + "_" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
function sbzUnique(values) {
  return Array.from(new Set(values.filter((value) => Boolean(value)))).sort();
}
function sbzSyncXmsLabel(id) {
  const vals = xmsGetValues(id);
  const label = document.querySelector("#" + id + " .xms-label");
  const wrap = document.getElementById(id);
  if (!label) return;
  const allLabel = wrap?.dataset.all || "All";
  if (!vals.length) label.textContent = allLabel;
  else if (vals.length <= 2) label.textContent = vals.join(", ");
  else label.textContent = vals.length + " selected";
}
function sbzPopulateFilters(rows) {
  const sourceRows = rows.filter((row) => row.source === sbzMode);
  xmsPopulate("xms_sbz_status", sbzUnique(sourceRows.map((row) => row.status)));
  xmsPopulate("xms_sbz_category", sbzUnique(sourceRows.map((row) => row.category)));
  xmsPopulate("xms_sbz_company", sbzUnique(sourceRows.map((row) => row.company_or_entity)));
  if (!sbzXmsDefaultsApplied) {
    ["xms_sbz_status", "xms_sbz_category", "xms_sbz_company"].forEach((id) => {
      const panel = document.getElementById(id + "_panel");
      if (panel) panel.querySelectorAll("input").forEach((cb) => {
        cb.checked = false;
      });
      sbzSyncXmsLabel(id);
    });
    sbzXmsDefaultsApplied = true;
  }
  const bounds = sbzDateBoundsForSource(rows, sbzMode);
  if (bounds.earliest && !sbzDefaultsApplied) {
    const fromEl = document.getElementById("sbzDateFrom");
    const toEl = document.getElementById("sbzDateTo");
    if (fromEl) fromEl.value = bounds.earliest;
    if (toEl) toEl.value = bounds.latest;
    sbzDefaultsApplied = true;
  }
}
function sbzSetMode(source) {
  sbzMode = source;
  sbzSupplierDrill = null;
  sbzPage = 1;
  sbzDefaultsApplied = false;
  sbzXmsDefaultsApplied = false;
  document.getElementById("sbzModeStorebook")?.classList.toggle("active", source === "STOREBOOK");
  document.getElementById("sbzModeZr")?.classList.toggle("active", source === "ZR");
  updateStorebookZr();
}
function sbzTriggerUpdate() {
  if (sbzFilterTimer) clearTimeout(sbzFilterTimer);
  sbzFilterTimer = setTimeout(() => {
    sbzPage = 1;
    updateStorebookZr();
  }, 120);
}
function sbzPatchXmsUpdate() {
  const w = window;
  if (w.__sbzXmsPatched || typeof w.xmsUpdate !== "function") return;
  const original = w.xmsUpdate;
  w.xmsUpdate = (id) => {
    if (id.indexOf("xms_sbz_") === 0) {
      sbzSyncXmsLabel(id);
      sbzTriggerUpdate();
      return;
    }
    original(id);
  };
  w.__sbzXmsPatched = true;
}
function sbzWireFilters() {
  if (sbzFiltersWired) return;
  sbzFiltersWired = true;
  sbzPatchXmsUpdate();
  document.getElementById("sbzModeStorebook")?.addEventListener("click", () => sbzSetMode("STOREBOOK"));
  document.getElementById("sbzModeZr")?.addEventListener("click", () => sbzSetMode("ZR"));
  ["sbzDateFrom", "sbzDateTo", "sbzSupplierSearch"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => {
      if (id === "sbzSupplierSearch") sbzSupplierDrill = null;
      sbzTriggerUpdate();
    });
  });
  document.getElementById("sbzLifecycle")?.addEventListener("change", sbzTriggerUpdate);
  document.getElementById("sbzPageSize")?.addEventListener("change", (event) => {
    sbzPageSize = Number(event.target.value) || 25;
    sbzPage = 1;
    sbzRenderTable(sbzFilteredCache);
  });
  document.getElementById("sbzResetBtn")?.addEventListener("click", async () => {
    const search = document.getElementById("sbzSupplierSearch");
    if (search) search.value = "";
    const lifecycle = document.getElementById("sbzLifecycle");
    if (lifecycle) lifecycle.value = "ALL";
    sbzSupplierDrill = null;
    sbzDefaultsApplied = false;
    sbzXmsDefaultsApplied = false;
    ["xms_sbz_status", "xms_sbz_category", "xms_sbz_company"].forEach((id) => {
      const panel = document.getElementById(id + "_panel");
      if (panel) panel.querySelectorAll("input").forEach((cb) => {
        cb.checked = false;
      });
      sbzSyncXmsLabel(id);
    });
    sbzPage = 1;
    updateStorebookZr();
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target && target.tagName === "INPUT" && target.type === "checkbox") {
      const wrap = target.closest(".xms-wrap");
      if (wrap && wrap.id.indexOf("xms_sbz_") === 0) {
        sbzSyncXmsLabel(wrap.id);
        sbzTriggerUpdate();
      }
    }
  });
}
async function updateStorebookZr() {
  const all = await loadStorebookZrData();
  const noData = document.getElementById("sbzNoData");
  sbzWireFilters();
  document.getElementById("sbzModeStorebook")?.classList.toggle("active", sbzMode === "STOREBOOK");
  document.getElementById("sbzModeZr")?.classList.toggle("active", sbzMode === "ZR");
  if (!all.length) {
    if (noData) noData.style.display = "block";
    sbzFilteredCache = [];
    sbzRenderKpis({ openCount: 0, avgDaysOpen: 0, avgDaysResolve: 0, resolvedCount: 0, topSupplierName: "n/a", topSupplierCount: 0 });
    sbzRenderTable([]);
    return;
  }
  if (noData) noData.style.display = "none";
  sbzPopulateFilters(all);
  const view = sbzBuildViewModel(all, sbzReadFilters());
  sbzFilteredCache = view.detailRows;
  sbzRenderAppliedFilters();
  sbzRenderKpis(view.kpis);
  sbzRenderProductivityChart(view.productivityRows);
  sbzRenderTopSupplierChart(view.topSuppliers);
  sbzRenderTable(view.detailRows);
}
(function sbzInjectCss() {
  if (document.getElementById("sbzInlineCss")) return;
  const style = document.createElement("style");
  style.id = "sbzInlineCss";
  style.textContent = '#storebookZr .sbz-filter-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end;margin-bottom:2px;}#storebookZr .sbz-filter-field label,#storebookZr .sbz-filter-label{display:block;font-size:0.72rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:4px;}#storebookZr .sbz-filter-control,#storebookZr .xms-btn{width:100%;min-height:34px;padding:7px 9px;border-radius:7px;border:1px solid rgba(148,163,184,0.34);background:#fff;color:#16245c;font-size:0.82rem;}[data-theme="dark"] #storebookZr .sbz-filter-control,[data-theme="dark"] #storebookZr .xms-btn{background:rgba(15,23,42,0.72);color:var(--text);border-color:rgba(148,163,184,0.22);}#storebookZr .xms-wrap{position:relative;}#storebookZr .xms-panel{position:absolute;z-index:40;width:100%;background:var(--card-bg,#0f172a);border:1px solid rgba(148,163,184,0.28);border-radius:7px;margin-top:3px;max-height:190px;overflow-y:auto;display:none;padding:6px 9px;font-size:0.8rem;box-shadow:0 14px 32px rgba(15,23,42,0.22);}#xms_sbz_status .xms-panel.open,#xms_sbz_category .xms-panel.open,#xms_sbz_company .xms-panel.open{display:block!important;}#storebookZr .xms-panel label{display:flex;gap:6px;align-items:center;padding:3px 0;cursor:pointer;}#storebookZr .sbz-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px;}#storebookZr .sbz-kpi-card{background:linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.025));border:1px solid rgba(148,163,184,0.18);border-top:3px solid;border-radius:8px;padding:13px;min-width:0;}#storebookZr .sbz-kpi-label{font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:800;}#storebookZr .sbz-kpi-value{font-size:clamp(1.05rem,1.4vw,1.55rem);font-weight:850;margin-top:3px;white-space:normal;overflow-wrap:anywhere;line-height:1.1;}#storebookZr .sbz-kpi-sub{font-size:0.72rem;color:var(--text-muted);margin-top:5px;}#storebookZr .sbz-kpi-clickable{cursor:pointer;transition:transform 0.12s ease,border-color 0.12s ease,background 0.12s ease;}#storebookZr .sbz-kpi-clickable:hover,#storebookZr .sbz-kpi-clickable:focus{transform:translateY(-1px);border-color:rgba(124,58,237,0.55);outline:none;background:rgba(124,58,237,0.09);}#storebookZr .sbz-chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:14px;}#storebookZr .sbz-chart-card{position:relative;min-height:300px;padding:14px;border:1px solid rgba(148,163,184,0.28);box-shadow:0 10px 26px rgba(15,23,42,0.12);}#storebookZr .sbz-chart-wrap{position:relative;height:245px;width:100%;}#storebookZr .sbz-applied-filters{align-items:center;gap:8px;flex-wrap:wrap;margin:-2px 0 12px 0;}#storebookZr .sbz-applied-label{font-size:0.72rem;color:var(--text-muted);font-weight:800;text-transform:uppercase;}#storebookZr .sbz-filter-chip{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(124,58,237,0.48);background:rgba(124,58,237,0.13);color:var(--text);border-radius:999px;padding:6px 10px;font-size:0.78rem;font-weight:750;cursor:pointer;}#storebookZr .sbz-chip-x{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,0.16);color:#fff;font-size:13px;line-height:1;font-weight:900;}#storebookZr #sbzTable{border:1px solid rgba(148,163,184,0.28);border-radius:8px;overflow:hidden;background:rgba(15,23,42,0.04);}#storebookZr #sbzTable th{cursor:pointer;text-align:left;padding:8px;border-bottom:1px solid rgba(148,163,184,0.25);font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;}#storebookZr #sbzTable td{padding:7px 8px;border-bottom:1px solid rgba(148,163,184,0.14);font-size:0.82rem;}';
  document.head.appendChild(style);
})();
(function sbzActivateHashPage() {
  if (window.location.hash !== "#storebookZr") return;
  window.addEventListener("load", () => window.setTimeout(() => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    document.querySelector('.nav-item[data-page="storebookZr"]')?.classList.add("active");
    document.getElementById("storebookZr")?.classList.add("active");
    updateStorebookZr();
  }, 200));
})();
