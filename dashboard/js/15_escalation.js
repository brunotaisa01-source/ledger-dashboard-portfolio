"use strict";
let escData = null;
const escCharts = {};
let escPage = 1;
let escSort = { col: "escalationDate", dir: "desc" };
let escPageSize = 25;
let escFilteredCache = [];
let escFilteredCacheReady = false;
let escFiltersWired = false;
let escDateDefaultsApplied = false;
let escXmsDefaultsApplied = false;
let escSupplierDrill = null;
let escChartDrill = null;
let escFilterTimer = null;
const ESC_AGING_BUCKETS = [
  { label: "0-2", min: 0, max: 2 },
  { label: "3-5", min: 3, max: 5 },
  { label: "6-10", min: 6, max: 10 },
  { label: "10+", min: 11, max: Number.POSITIVE_INFINITY }
];
const ESC_PRIORITY_ORDER = ["Critical", "High", "Medium", "Low"];
function escIsDark() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}
function escFmtDate(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return m[3] + "/" + m[2] + "/" + m[1];
}
function escEsc(v) {
  if (v == null) return "";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escFmtMoney(v) {
  if (v == null || typeof v === "number" && isNaN(v)) return "";
  const n = typeof v === "number" ? v : Number(v);
  if (isNaN(n)) return "";
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escBusdayCount(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = /* @__PURE__ */ new Date(startIso + "T00:00:00Z");
  const end = /* @__PURE__ */ new Date(endIso + "T00:00:00Z");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return null;
  let businessDays = 0;
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) businessDays += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Math.max(0, businessDays - 1);
}
function escWeekKey(iso) {
  if (!iso) return null;
  const d = /* @__PURE__ */ new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
function escCountry(row) {
  const explicit = String(row.country || "").trim();
  if (explicit) return explicit;
  const code = String(row.entityCode || "").trim().toUpperCase();
  const entity = String(row.entity || "").toLowerCase();
  const mailbox = String(row.mailbox || "").trim();
  if (code.startsWith("DE") || code.startsWith("1D")) return "Germany";
  if (code.startsWith("BE")) return "Belgium";
  if (code.startsWith("NL")) return "Netherlands";
  if (code.startsWith("GB")) return "UK";
  if (entity.indexOf("belgium") !== -1) return "Belgium";
  if (entity.indexOf("netherlands") !== -1) return "Netherlands";
  if (mailbox === "Germany") return "Germany";
  return "Unknown";
}
function escToNumber(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function escNormalizeFlags(v) {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string" && v.trim()) return v.split(",").map((x) => x.trim()).filter(Boolean);
  return [];
}
function escPick(r, shortKey, longKey) {
  return r[shortKey] ?? r[longKey] ?? null;
}
function escMapShortRow(r) {
  const resolvedDays = escToNumber(escPick(r, "dtrc", "daysToResolveCalc")) ?? escToNumber(escPick(r, "dtrs", "daysToResolve"));
  const isOpenRaw = escPick(r, "io", "isOpen");
  const isOpen = isOpenRaw === true || isOpenRaw === 1 || isOpenRaw === "1" ? 1 : 0;
  return {
    uniqueKey: String(escPick(r, "uk", "uniqueKey") || ""),
    vendorNo: escPick(r, "vn", "vendorNo"),
    vendorName: escPick(r, "vname", "vendorName"),
    entity: escPick(r, "ent", "entity"),
    entityCode: escPick(r, "ec", "entityCode"),
    mailbox: escPick(r, "mb", "mailbox"),
    category: escPick(r, "cat", "category"),
    fromEmail: r.fromEmail ?? null,
    reference: r.reference ?? null,
    docDate: r.docDate ?? null,
    invRef: r.invRef ?? null,
    actionType: escPick(r, "act", "actionType"),
    status: escPick(r, "st", "status"),
    isOpen,
    priority: escPick(r, "pri", "priority"),
    apOwner: escPick(r, "apo", "apOwner"),
    receivedDate: escPick(r, "rd", "receivedDate"),
    escalationDate: escPick(r, "ed", "escalationDate"),
    workingNotes: r.workingNotes ?? null,
    dateResolved: escPick(r, "dr", "dateResolved"),
    daysToResolve: resolvedDays,
    daysOpen: escToNumber(escPick(r, "do", "daysOpen")),
    value: escToNumber(escPick(r, "val", "value")),
    valueRaw: escPick(r, "vr", "valueRaw"),
    internetMsgId: r.internetMsgId ?? null,
    flags: escNormalizeFlags(escPick(r, "fl", "flags"))
  };
}
function escExtractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const obj = payload;
    if (Array.isArray(obj.rows)) return obj.rows;
    if (Array.isArray(obj.raw)) return obj.raw;
  }
  return null;
}
function escPostProcessRows(rows) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  rows.forEach((r) => {
    const openStart = r.escalationDate || r.receivedDate || "";
    if (r.daysOpen == null && r.isOpen === 1 && openStart) {
      r.daysOpen = escBusdayCount(openStart, today);
    }
    r.country = escCountry(r);
    if (!Array.isArray(r.flags)) r.flags = [];
  });
  return rows;
}
function escEffectiveDate(row) {
  return row.escalationDate || row.receivedDate || "";
}
async function loadEscalationData() {
  if (escData) return escData;
  const b64 = window.DASHBOARD_DATA?.escalation_compressed;
  if (!b64) {
    console.warn("Escalation data unavailable: missing DASHBOARD_DATA.escalation_compressed");
    escData = [];
    return escData;
  }
  try {
    const payload = await decompressBlob(b64);
    const rows = escExtractRows(payload);
    if (rows) {
      escData = escPostProcessRows(rows.map((r) => escMapShortRow(r)));
      return escData;
    }
    console.warn("Escalation data unavailable: compressed payload has no rows");
  } catch (e) {
    console.warn("Escalation decompress error:", e);
  }
  escData = [];
  return escData;
}
function escGetFilters() {
  const dateFrom = document.getElementById("escDateFrom")?.value || "";
  const dateTo = document.getElementById("escDateTo")?.value || "";
  const onlyOpen = document.getElementById("escOnlyOpen")?.checked === true;
  const vendorSearch = String(document.getElementById("escVendorSearch")?.value || "").trim().toLowerCase();
  return {
    dateFrom,
    dateTo,
    onlyOpen,
    statuses: xmsGetValues("xms_esc_status"),
    priorities: xmsGetValues("xms_esc_priority"),
    mailboxes: xmsGetValues("xms_esc_mailbox"),
    countries: xmsGetValues("xms_esc_country"),
    actionTypes: xmsGetValues("xms_esc_action"),
    categories: xmsGetValues("xms_esc_category"),
    entities: xmsGetValues("xms_esc_entity"),
    vendorSearch
  };
}
function escSupplierLabel(row) {
  const no = String(row.vendorNo || "").trim();
  const name = String(row.vendorName || "").trim();
  return name && name !== "#N/A" ? name : no && no !== "#N/A" ? no : "Missing supplier";
}
function escRankableSupplierLabel(row) {
  const no = String(row.vendorNo || "").trim();
  if (!no || no === "#N/A") return null;
  const name = String(row.vendorName || "").trim();
  return name && name !== "#N/A" ? name : no;
}
function escFilterRows(rows, f, ignoreOnlyOpen = false) {
  return rows.filter((r) => {
    if (!ignoreOnlyOpen && f.onlyOpen && r.isOpen !== 1) return false;
    if (escSupplierDrill && escSupplierLabel(r) !== escSupplierDrill) return false;
    if (escChartDrill && !escMatchesChartDrill(r, escChartDrill)) return false;
    if (f.dateFrom || f.dateTo) {
      const effectiveDate = escEffectiveDate(r);
      if (!effectiveDate) return false;
      if (f.dateFrom && effectiveDate < f.dateFrom) return false;
      if (f.dateTo && effectiveDate > f.dateTo) return false;
    }
    if (f.statuses.length && !f.statuses.includes(r.status || "")) return false;
    if (f.priorities.length && !f.priorities.includes(r.priority || "")) return false;
    if (f.mailboxes.length && !f.mailboxes.includes(r.mailbox || "Unknown")) return false;
    if (f.countries.length && !f.countries.includes(escCountry(r))) return false;
    if (f.actionTypes.length && !f.actionTypes.includes(r.actionType || "")) return false;
    if (f.categories.length && !f.categories.includes(r.category || "")) return false;
    if (f.entities.length && !f.entities.includes(r.entityCode || "")) return false;
    if (f.vendorSearch) {
      const v = String(r.vendorNo || "").toLowerCase();
      const n = String(r.vendorName || "").toLowerCase();
      if (!v.includes(f.vendorSearch) && !n.includes(f.vendorSearch)) return false;
    }
    return true;
  });
}
function escMatchesChartDrill(row, drill) {
  if (drill.kind === "aging") {
    const days = row.daysOpen;
    return row.isOpen === 1 && days != null && days >= drill.min && days <= drill.max;
  }
  if (drill.kind === "actionType") return (row.actionType || "") === drill.label;
  if (drill.kind === "entityCode") return (row.entityCode || "") === drill.label;
  return (row.mailbox || "Unknown") === drill.label;
}
function escChartDrillTitle(drill) {
  if (drill.kind === "aging") return "Aging: " + drill.label;
  if (drill.kind === "actionType") return "Action Type: " + drill.label;
  if (drill.kind === "entityCode") return "Entity: " + drill.label;
  return "Mailbox: " + drill.label;
}
function applyEscalationFilters(rows) {
  return escFilterRows(rows, escGetFilters(), false);
}
function escAverage(values) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}
function escKpiDayValue(daysMinusOne) {
  if (!Number.isFinite(daysMinusOne)) return null;
  return Math.max(1, daysMinusOne + 1);
}
function escMedian(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function computeEscalationKPIs(filteredRows, contextRows) {
  const open = filteredRows.filter((r) => r.isOpen === 1);
  const openDays = open.map((r) => escKpiDayValue(Number(r.daysOpen))).filter((v) => v != null);
  const closedDays = contextRows.filter((r) => r.isOpen === 0 && r.daysToResolve != null).map((r) => Number(r.daysToResolve)).map((v) => escKpiDayValue(v)).filter((v) => v != null);
  const supplierCounts = {};
  filteredRows.forEach((r) => {
    const label = escRankableSupplierLabel(r);
    if (!label) return;
    supplierCounts[label] = supplierCounts[label] || { name: label, count: 0 };
    supplierCounts[label].count += 1;
  });
  const topSupplier = Object.values(supplierCounts).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  })[0] || { name: "n/a", count: 0 };
  return {
    totalRows: filteredRows.length,
    openCount: open.length,
    avgDaysOpen: escAverage(openDays),
    avgResolveDays: escAverage(closedDays),
    resolvedCount: contextRows.filter((r) => r.isOpen === 0).length,
    topSupplierName: topSupplier.name,
    topSupplierCount: topSupplier.count
  };
}
function renderEscalationKPIs(kpis) {
  const el = document.getElementById("escKPIs");
  if (!el) return;
  const card = (label, value, sub, color, extra = "") => {
    return '<div class="esc-kpi-card' + extra + '" style="border-top-color:' + color + ';"><div class="esc-kpi-label">' + escEsc(label) + '</div><div class="esc-kpi-value" style="color:' + color + ';">' + escEsc(value) + '</div><div class="esc-kpi-sub">' + escEsc(sub || "") + "</div></div>";
  };
  el.innerHTML = card("Open Count", kpis.openCount, kpis.totalRows + " visible rows", "#F59E0B") + card("Avg Days Open", kpis.avgDaysOpen.toFixed(1), "open rows, elapsed business days", "#DC3545") + card("Avg Days to Resolve", kpis.avgResolveDays.toFixed(1), "closed rows, elapsed business days", "#3b82f6") + card("Resolved Count", kpis.resolvedCount, "closed rows in context", "#28A745") + card("Top Recurring Supplier", kpis.topSupplierName, kpis.topSupplierCount + " visible rows - click to drill", "#7C3AED", ' esc-kpi-clickable" id="escTopSupplierKpi" role="button" tabindex="0" title="Filter detail to this supplier');
  const top = document.getElementById("escTopSupplierKpi");
  if (top && kpis.topSupplierName !== "n/a") {
    top.addEventListener("click", () => escApplySupplierDrill(kpis.topSupplierName));
    top.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        escApplySupplierDrill(kpis.topSupplierName);
      }
    });
  }
}
function renderEscalationAppliedFilters() {
  const el = document.getElementById("escAppliedFilters");
  const detailChip = document.getElementById("escDetailFilterChip");
  const chips = [];
  if (escSupplierDrill) {
    chips.push('<button type="button" class="esc-filter-chip" data-esc-clear-drill="supplier" title="Clear supplier drill-through"><span>Supplier: ' + escEsc(escSupplierDrill) + '</span><span class="esc-chip-x" aria-hidden="true">&times;</span></button>');
  }
  if (escChartDrill) {
    chips.push('<button type="button" class="esc-filter-chip" data-esc-clear-drill="chart" title="Clear chart drill-through"><span>' + escEsc(escChartDrillTitle(escChartDrill)) + '</span><span class="esc-chip-x" aria-hidden="true">&times;</span></button>');
  }
  if (!chips.length) {
    if (el) {
      el.style.display = "none";
      el.innerHTML = "";
    }
    if (detailChip) detailChip.innerHTML = "";
    return;
  }
  if (el) {
    el.style.display = "flex";
    el.innerHTML = '<span class="esc-applied-label">Applied drill-through</span>' + chips.join("");
    el.querySelectorAll("[data-esc-clear-drill]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kind = btn.dataset.escClearDrill;
        if (kind === "supplier") escClearSupplierDrill();
        if (kind === "chart") escClearChartDrill();
      });
    });
  }
  if (detailChip) {
    detailChip.innerHTML = chips.join("").replace(/class="esc-filter-chip"/g, 'class="esc-filter-chip esc-filter-chip-compact"');
    detailChip.querySelectorAll("[data-esc-clear-drill]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kind = btn.dataset.escClearDrill;
        if (kind === "supplier") escClearSupplierDrill();
        if (kind === "chart") escClearChartDrill();
      });
    });
  }
}
function escApplySupplierDrill(label) {
  escSupplierDrill = label;
  const vendorEl = document.getElementById("escVendorSearch");
  if (vendorEl) vendorEl.value = "";
  escPage = 1;
  updateEscalation();
  window.setTimeout(() => document.getElementById("escDetailCard")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
}
function escClearSupplierDrill() {
  escSupplierDrill = null;
  escPage = 1;
  updateEscalation();
}
function escApplyChartDrill(drill) {
  escChartDrill = drill;
  escPage = 1;
  updateEscalation();
  window.setTimeout(() => document.getElementById("escDetailCard")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
}
function escClearChartDrill() {
  escChartDrill = null;
  escPage = 1;
  updateEscalation();
}
function escDestroy(key) {
  if (escCharts[key]) {
    try {
      escCharts[key].destroy();
    } catch (_e) {
    }
    delete escCharts[key];
  }
}
function escAxisColors() {
  return escIsDark() ? { tick: "#94a3b8", grid: "rgba(148,163,184,0.15)" } : { tick: "#475569", grid: "rgba(100,116,139,0.15)" };
}
function renderEscalationAgingChart(rows) {
  escDestroy("aging");
  const canvas = document.getElementById("escalationAgingChart");
  if (!canvas) return;
  const open = rows.filter((r) => r.isOpen === 1 && r.daysOpen != null);
  const counts = ESC_AGING_BUCKETS.map((b) => open.filter((r) => r.daysOpen >= b.min && r.daysOpen <= b.max).length);
  const colors = ["#28A745", "#F59E0B", "#FB923C", "#DC3545"];
  const ax = escAxisColors();
  escCharts.aging = new Chart(canvas, {
    type: "bar",
    data: {
      labels: ESC_AGING_BUCKETS.map((b) => b.label + " bd"),
      datasets: [{ label: "Open", data: counts, backgroundColor: colors, borderRadius: 4 }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        const idx = elements && elements[0] ? elements[0].index : -1;
        const bucket = ESC_AGING_BUCKETS[idx];
        if (bucket) escApplyChartDrill({ kind: "aging", label: bucket.label + " bd", min: bucket.min, max: bucket.max });
      },
      plugins: {
        legend: { display: false },
        datalabels: { font: { weight: "700" }, color: "#fff", formatter: (v) => v > 0 ? v : "" }
      },
      scales: {
        x: { ticks: { color: ax.tick }, grid: { color: ax.grid } },
        y: { ticks: { color: ax.tick }, grid: { display: false } }
      }
    }
  });
}
function renderEscalationTrendChart(rows) {
  escDestroy("trend");
  const canvas = document.getElementById("escalationTrendChart");
  if (!canvas) return;
  const today = /* @__PURE__ */ new Date();
  const cutoff = new Date(today);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const created = {};
  const resolved = {};
  rows.forEach((r) => {
    if (r.escalationDate && r.escalationDate >= cutoffIso) {
      const wk = escWeekKey(r.escalationDate);
      if (wk) created[wk] = (created[wk] || 0) + 1;
    }
    if (r.dateResolved && r.dateResolved >= cutoffIso) {
      const wk = escWeekKey(r.dateResolved);
      if (wk) resolved[wk] = (resolved[wk] || 0) + 1;
    }
  });
  const labels = Array.from(new Set(Object.keys(created).concat(Object.keys(resolved)))).sort();
  const ax = escAxisColors();
  escCharts.trend = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Created",
          data: labels.map((l) => created[l] || 0),
          borderColor: "#F59E0B",
          backgroundColor: "rgba(245,158,11,0.12)",
          fill: true,
          tension: 0.3,
          pointRadius: 3
        },
        {
          label: "Resolved",
          data: labels.map((l) => resolved[l] || 0),
          borderColor: "#28A745",
          backgroundColor: "rgba(40,167,69,0.08)",
          fill: false,
          tension: 0.3,
          pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: ax.tick, usePointStyle: true, boxWidth: 8 } },
        datalabels: { display: false }
      },
      scales: {
        x: { ticks: { color: ax.tick, maxRotation: 45, minRotation: 30 }, grid: { color: ax.grid } },
        y: { beginAtZero: true, ticks: { color: ax.tick, precision: 0 }, grid: { color: ax.grid } }
      }
    }
  });
}
function renderEscalationTopSupplierChart(rows) {
  escDestroy("topSupplier");
  const canvas = document.getElementById("escalationTopSupplierChart");
  if (!canvas) return;
  const counts = {};
  rows.forEach((r) => {
    const label = escRankableSupplierLabel(r);
    if (!label) return;
    counts[label] = counts[label] || { label, count: 0 };
    counts[label].count += 1;
  });
  const sorted = Object.values(counts).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label);
  }).slice(0, 10);
  const labels = sorted.map((s) => s.label);
  const values = sorted.map((s) => s.count);
  const ax = escAxisColors();
  escCharts.topSupplier = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Rows", data: values, backgroundColor: "#7C3AED", borderRadius: 4 }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        const idx = elements && elements[0] ? elements[0].index : -1;
        if (idx >= 0 && labels[idx]) escApplySupplierDrill(labels[idx]);
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => String(ctx.parsed?.x || 0) + " rows" } },
        datalabels: { font: { weight: "700", size: 11 }, color: "#fff", formatter: (v) => v > 0 ? v : "" }
      },
      scales: {
        x: { ticks: { color: ax.tick, precision: 0 }, grid: { color: ax.grid }, beginAtZero: true },
        y: { ticks: { color: ax.tick, font: { size: 10 } }, grid: { display: false } }
      }
    }
  });
}
function renderEscalationCategoryChart(rows, key, canvasId, chartKey, drillKind) {
  escDestroy(chartKey);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const counts = {};
  rows.forEach((r) => {
    const v = r[key] || "";
    if (!v) return;
    counts[v] = (counts[v] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const labels = sorted.map((e) => e[0]);
  const values = sorted.map((e) => e[1]);
  const ax = escAxisColors();
  escCharts[chartKey] = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Count", data: values, backgroundColor: "#3b82f6", borderRadius: 4 }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        const idx = elements && elements[0] ? elements[0].index : -1;
        if (idx >= 0 && labels[idx]) escApplyChartDrill({ kind: drillKind, label: labels[idx] });
      },
      plugins: {
        legend: { display: false },
        datalabels: { font: { weight: "700", size: 11 }, color: "#fff", formatter: (v) => v > 0 ? v : "" }
      },
      scales: {
        x: { ticks: { color: ax.tick, precision: 0 }, grid: { color: ax.grid } },
        y: { ticks: { color: ax.tick, font: { size: 11 } }, grid: { display: false } }
      }
    }
  });
}
function renderEscalationMailboxChart(rows) {
  escDestroy("mailbox");
  const canvas = document.getElementById("escalationMailboxChart");
  if (!canvas) return;
  const counts = {};
  rows.forEach((r) => {
    const v = r.mailbox || "Unknown";
    counts[v] = (counts[v] || 0) + 1;
  });
  const order = ["Germany", "Benelux", "UK", "ERP3", "Unknown"];
  const labels = order.filter((l) => counts[l] != null);
  Object.keys(counts).forEach((k) => {
    if (!labels.includes(k)) labels.push(k);
  });
  const values = labels.map((l) => counts[l] || 0);
  const palette = ["#3b82f6", "#28A745", "#F59E0B", "#DC3545", "#94a3b8", "#A855F7"];
  const ax = escAxisColors();
  escCharts.mailbox = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Count",
        data: values,
        backgroundColor: labels.map((_l, i) => palette[i % palette.length]),
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        const idx = elements && elements[0] ? elements[0].index : -1;
        if (idx >= 0 && labels[idx]) escApplyChartDrill({ kind: "mailbox", label: labels[idx] });
      },
      plugins: {
        legend: { display: false },
        datalabels: { font: { weight: "700" }, color: "#fff", formatter: (v) => v > 0 ? v : "" }
      },
      scales: {
        x: { ticks: { color: ax.tick }, grid: { display: false } },
        y: { ticks: { color: ax.tick, precision: 0 }, grid: { color: ax.grid }, beginAtZero: true }
      }
    }
  });
}
function renderEscalationCharts(rows) {
  renderEscalationAgingChart(rows);
  renderEscalationTrendChart(rows);
  renderEscalationTopSupplierChart(rows);
  renderEscalationCategoryChart(rows, "actionType", "escalationActionTypeChart", "actionType", "actionType");
  renderEscalationCategoryChart(rows, "entityCode", "escalationEntityChart", "entity", "entityCode");
  renderEscalationMailboxChart(rows);
}
const ESC_TABLE_COLS = [
  { key: "escalationDate", label: "Esc Date", fmt: (_v, r) => escFmtDate(escEffectiveDate(r)) },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "mailbox", label: "Mailbox" },
  { key: "country", label: "Country", fmt: (_v, r) => escCountry(r) },
  { key: "vendorNo", label: "Vendor #" },
  { key: "vendorName", label: "Vendor Name" },
  { key: "entity", label: "Entity" },
  { key: "actionType", label: "Action Type" },
  { key: "category", label: "Category" },
  { key: "value", label: "Value", fmt: (v, r) => r.valueRaw ? r.valueRaw : escFmtMoney(v) },
  { key: "daysOpen", label: "Days Open", fmt: (v) => v == null ? "" : String(v) },
  { key: "daysToResolve", label: "Days Resolve", fmt: (v) => v == null ? "" : String(v) },
  { key: "apOwner", label: "AP Owner" },
  { key: "dateResolved", label: "Resolved", fmt: (v) => escFmtDate(v) },
  { key: "reference", label: "Reference" }
];
function escSortRows(rows) {
  const col = escSort.col;
  const dir = escSort.dir === "desc" ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const av = a[col];
    const bv = b[col];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}
function escRowClass(row) {
  const flags = row.flags || [];
  if (flags.indexOf("stale_open") !== -1) return "esc-row-stale";
  if (flags.indexOf("vendor_na") !== -1) return "esc-row-vendor-na";
  return "";
}
function renderEscalationTable(rows) {
  const table = document.getElementById("escTable");
  const countEl = document.getElementById("escRowCount");
  const pagEl = document.getElementById("escPagination");
  if (!table) return;
  const sorted = escSortRows(rows);
  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / escPageSize));
  if (escPage > pageCount) escPage = pageCount;
  if (escPage < 1) escPage = 1;
  const startIdx = (escPage - 1) * escPageSize;
  const slice = sorted.slice(startIdx, startIdx + escPageSize);
  const head = "<thead><tr>" + ESC_TABLE_COLS.map((c) => {
    const arrow = c.key === escSort.col ? escSort.dir === "asc" ? " a2" : " a14" : "";
    return '<th data-sort="' + escEsc(c.key) + '" style="cursor:pointer;text-align:left;padding:8px;border-bottom:1px solid rgba(255,255,255,0.1);font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px;">' + escEsc(c.label) + arrow + "</th>";
  }).join("") + "</tr></thead>";
  const body = "<tbody>" + slice.map((r) => {
    const cls = escRowClass(r);
    const tds = ESC_TABLE_COLS.map((c) => {
      const raw = r[c.key];
      const display = c.fmt ? c.fmt(raw, r) : raw == null ? "" : raw;
      return '<td style="padding:7px 8px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.82rem;">' + escEsc(display) + "</td>";
    }).join("");
    return '<tr class="' + cls + '">' + tds + "</tr>";
  }).join("") + "</tbody>";
  table.innerHTML = head + body;
  table.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-sort") || "";
      if (escSort.col === col) {
        escSort.dir = escSort.dir === "asc" ? "desc" : "asc";
      } else {
        escSort.col = col;
        escSort.dir = "asc";
      }
      renderEscalationTable(rows);
    });
  });
  if (countEl) countEl.textContent = "(" + total + " rows)";
  if (pagEl) {
    let html = "";
    html += "<button " + (escPage === 1 ? "disabled" : "") + ' onclick="escGotoPage(' + (escPage - 1) + ')" style="padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:var(--text);cursor:pointer;' + (escPage === 1 ? "opacity:0.5;cursor:not-allowed;" : "") + '">a1 Prev</button>';
    html += '<span style="font-size:0.85rem;color:var(--text-muted);">Page ' + escPage + " / " + pageCount + "</span>";
    html += "<button " + (escPage === pageCount ? "disabled" : "") + ' onclick="escGotoPage(' + (escPage + 1) + ')" style="padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:var(--text);cursor:pointer;' + (escPage === pageCount ? "opacity:0.5;cursor:not-allowed;" : "") + '">Next ao</button>';
    pagEl.innerHTML = html;
  }
}
function escGotoPage(p) {
  escPage = p;
  renderEscalationTable(escFilteredCache);
}
function exportEscalationCSV() {
  const rows = escFilteredCacheReady ? escFilteredCache : escData || [];
  const sorted = escSortRows(rows);
  const headers = ESC_TABLE_COLS.map((c) => c.label);
  const escapeCell = (v) => {
    if (v == null) return "";
    const s = String(v);
    if (s.indexOf(",") !== -1 || s.indexOf('"') !== -1 || s.indexOf("\n") !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [headers.map(escapeCell).join(",")];
  sorted.forEach((r) => {
    const cells = ESC_TABLE_COLS.map((c) => {
      const raw = r[c.key];
      return escapeCell(c.fmt ? c.fmt(raw, r) : raw);
    });
    lines.push(cells.join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "escalations_" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
function populateEscalationFilters(allRows) {
  const uniq = (arr) => Array.from(new Set(arr.filter((v) => Boolean(v))));
  const xmsIds = ["xms_esc_status", "xms_esc_priority", "xms_esc_mailbox", "xms_esc_country", "xms_esc_action", "xms_esc_category", "xms_esc_entity"];
  const statuses = uniq(allRows.map((r) => r.status));
  const priorities = uniq(allRows.map((r) => r.priority)).sort((a, b) => {
    const ai = ESC_PRIORITY_ORDER.indexOf(a);
    const bi = ESC_PRIORITY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  const mailboxes = uniq(allRows.map((r) => r.mailbox || "Unknown")).sort();
  const countries = uniq(allRows.map((r) => escCountry(r)).filter((c) => c !== "Unknown")).sort();
  const actions = uniq(allRows.map((r) => r.actionType)).sort();
  const categories = uniq(allRows.map((r) => r.category)).sort();
  const entities = uniq(allRows.map((r) => r.entityCode)).sort();
  xmsPopulate("xms_esc_status", statuses);
  xmsPopulate("xms_esc_priority", priorities);
  xmsPopulate("xms_esc_mailbox", mailboxes);
  xmsPopulate("xms_esc_country", countries);
  xmsPopulate("xms_esc_action", actions);
  xmsPopulate("xms_esc_category", categories);
  xmsPopulate("xms_esc_entity", entities);
  if (!escXmsDefaultsApplied) {
    xmsIds.forEach((id) => {
      const panel = document.getElementById(id + "_panel");
      if (panel) {
        panel.classList.remove("open");
        panel.querySelectorAll("input").forEach((cb) => {
          cb.checked = false;
        });
      }
      escSyncXmsLabel(id);
    });
    escXmsDefaultsApplied = true;
  }
  const dates = allRows.map((r) => escEffectiveDate(r)).filter(Boolean).sort();
  if (dates.length) {
    const fromEl = document.getElementById("escDateFrom");
    const toEl = document.getElementById("escDateTo");
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (fromEl) {
      fromEl.min = dates[0];
      fromEl.max = today;
    }
    if (toEl) {
      toEl.min = dates[0];
      toEl.max = today;
    }
    if (!escDateDefaultsApplied) {
      if (fromEl && !fromEl.value) fromEl.value = dates[0];
      if (toEl && !toEl.value) toEl.value = today;
      escDateDefaultsApplied = true;
    }
  }
}
function escTriggerFilters() {
  if (escFilterTimer) clearTimeout(escFilterTimer);
  escFilterTimer = setTimeout(() => {
    escPage = 1;
    updateEscalation();
  }, 120);
}
function escSyncXmsLabel(id) {
  const vals = xmsGetValues(id);
  const btn = document.querySelector("#" + id + " .xms-label");
  if (!btn) return;
  const wrap = document.getElementById(id);
  const allLabel = wrap?.dataset.all || "All";
  if (vals.length === 0) btn.textContent = allLabel;
  else if (vals.length <= 2) btn.textContent = vals.join(", ");
  else btn.textContent = vals.length + " selected";
}
function escPatchXmsUpdate() {
  const w = window;
  if (w.__escXmsPatched || typeof w.xmsUpdate !== "function") return;
  const original = w.xmsUpdate;
  w.xmsUpdate = (id) => {
    if (id.indexOf("xms_esc_") === 0) {
      escSyncXmsLabel(id);
      escTriggerFilters();
      return;
    }
    original(id);
  };
  w.__escXmsPatched = true;
}
function escWireFilters() {
  if (escFiltersWired) return;
  escFiltersWired = true;
  escPatchXmsUpdate();
  ["escDateFrom", "escDateTo", "escVendorSearch"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => {
      if (id === "escVendorSearch") escSupplierDrill = null;
      escTriggerFilters();
    });
  });
  const onlyOpen = document.getElementById("escOnlyOpen");
  if (onlyOpen) onlyOpen.addEventListener("change", escTriggerFilters);
  const sizeSel = document.getElementById("escPageSize");
  if (sizeSel) sizeSel.addEventListener("change", () => {
    escPageSize = parseInt(sizeSel.value, 10) || 25;
    escPage = 1;
    renderEscalationTable(escFilteredCache);
  });
  const reset = document.getElementById("escResetBtn");
  if (reset) reset.addEventListener("click", async () => {
    const onlyOpenEl = document.getElementById("escOnlyOpen");
    if (onlyOpenEl) onlyOpenEl.checked = true;
    const all = await loadEscalationData();
    const dates = all.map((r) => r.escalationDate || "").filter(Boolean).sort();
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const fromEl = document.getElementById("escDateFrom");
    const toEl = document.getElementById("escDateTo");
    if (fromEl) fromEl.value = dates[0] || "";
    if (toEl) toEl.value = today;
    const vendorEl = document.getElementById("escVendorSearch");
    if (vendorEl) vendorEl.value = "";
    escSupplierDrill = null;
    escChartDrill = null;
    ["xms_esc_status", "xms_esc_priority", "xms_esc_mailbox", "xms_esc_country", "xms_esc_action", "xms_esc_category", "xms_esc_entity"].forEach((id) => {
      const panel = document.getElementById(id + "_panel");
      if (panel) {
        panel.classList.remove("open");
        panel.querySelectorAll("input").forEach((cb) => {
          cb.checked = false;
        });
      }
      escSyncXmsLabel(id);
    });
    escPage = 1;
    updateEscalation();
  });
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.tagName === "INPUT" && t.type === "checkbox") {
      const wrap = t.closest(".xms-wrap");
      if (wrap && wrap.id && wrap.id.indexOf("xms_esc_") === 0) {
        if (wrap.id === "xms_esc_status" && String(t.value).toLowerCase() === "closed" && t.checked) {
          const onlyOpenEl = document.getElementById("escOnlyOpen");
          if (onlyOpenEl) onlyOpenEl.checked = false;
        }
        escSyncXmsLabel(wrap.id);
        escTriggerFilters();
      }
    }
  });
}
async function updateEscalation() {
  const all = await loadEscalationData();
  const noData = document.getElementById("escNoData");
  if (!all || !all.length) {
    if (noData) noData.style.display = "block";
    return;
  }
  if (noData) noData.style.display = "none";
  populateEscalationFilters(all);
  escWireFilters();
  const filters = escGetFilters();
  const filtered = escFilterRows(all, filters, false);
  const contextRows = escFilterRows(all, filters, true);
  escFilteredCache = filtered;
  escFilteredCacheReady = true;
  const kpis = computeEscalationKPIs(filtered, contextRows);
  renderEscalationAppliedFilters();
  renderEscalationKPIs(kpis);
  renderEscalationAgingChart(filtered);
  renderEscalationTrendChart(contextRows);
  renderEscalationTopSupplierChart(filtered);
  renderEscalationCategoryChart(filtered, "actionType", "escalationActionTypeChart", "actionType", "actionType");
  renderEscalationCategoryChart(filtered, "entityCode", "escalationEntityChart", "entity", "entityCode");
  renderEscalationMailboxChart(filtered);
  renderEscalationTable(filtered);
}
(function escInjectCss() {
  if (document.getElementById("escInlineCss")) return;
  const style = document.createElement("style");
  style.id = "escInlineCss";
  style.textContent = '.esc-row-stale { background:rgba(220,53,69,0.18) !important; }.esc-row-stale:hover { background:rgba(220,53,69,0.28) !important; }.esc-row-vendor-na { background:rgba(245,158,11,0.055) !important; box-shadow:inset 3px 0 0 rgba(245,158,11,0.75); }.esc-row-vendor-na:hover { background:rgba(245,158,11,0.11) !important; }#escTable th[data-sort]:hover { color:var(--accent); }#xms_esc_status .xms-panel.open, #xms_esc_priority .xms-panel.open, #xms_esc_mailbox .xms-panel.open, #xms_esc_country .xms-panel.open, #xms_esc_action .xms-panel.open, #xms_esc_category .xms-panel.open, #xms_esc_entity .xms-panel.open { display:block !important; }#escalation .xms-panel label { display:flex; gap:6px; align-items:center; padding:3px 0; cursor:pointer; }#escalation .esc-filter-bar { display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end;margin-bottom:14px; }#escalation .esc-filter-field label, #escalation .esc-filter-field .esc-filter-label { display:block;font-size:0.72rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:4px; }#escalation .esc-filter-control, #escalation .xms-btn { width:100%;min-height:34px;padding:7px 9px;border-radius:7px;border:1px solid rgba(148,163,184,0.34);background:#fff;color:#16245c;font-size:0.82rem; }[data-theme="dark"] #escalation .esc-filter-control, [data-theme="dark"] #escalation .xms-btn { background:rgba(15,23,42,0.72);color:var(--text);border-color:rgba(148,163,184,0.22); }#escalation .xms-wrap { position:relative; }#escalation .xms-panel { position:absolute;z-index:40;width:100%;background:var(--card-bg,#0f172a);border:1px solid rgba(148,163,184,0.28);border-radius:7px;margin-top:3px;max-height:190px;overflow-y:auto;display:none;padding:6px 9px;font-size:0.8rem;box-shadow:0 14px 32px rgba(15,23,42,0.22); }#escalation .esc-kpi-card { background:linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.025));border:1px solid rgba(148,163,184,0.18);border-top:3px solid;border-radius:8px;padding:13px;min-width:0; }#escalation .esc-kpi-label { font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;font-weight:800; }#escalation .esc-kpi-value { font-size:clamp(1.05rem,1.4vw,1.55rem);font-weight:850;margin-top:3px;white-space:normal;overflow-wrap:anywhere;line-height:1.1; }#escalation .esc-kpi-sub { font-size:0.72rem;color:var(--text-muted);margin-top:5px; }#escalation .esc-kpi-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px; }#escalation .esc-applied-filters { align-items:center;gap:8px;flex-wrap:wrap;margin:-2px 0 12px 0; }#escalation .esc-applied-label { font-size:0.72rem;color:var(--text-muted);font-weight:800;text-transform:uppercase; }#escalation .esc-filter-chip { display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(124,58,237,0.48);background:rgba(124,58,237,0.13);color:var(--text);border-radius:999px;padding:6px 10px;font-size:0.78rem;font-weight:750;cursor:pointer; }#escalation .esc-filter-chip:hover { background:rgba(124,58,237,0.22);border-color:rgba(124,58,237,0.72); }#escalation .esc-filter-chip-compact { margin-left:8px;padding:4px 8px;font-size:0.72rem;vertical-align:middle; }#escalation .esc-chip-x { display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,0.16);color:#fff;font-size:13px;line-height:1;font-weight:900; }#escalation .esc-chart-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:14px; }#escalation .esc-chart-grid-main { grid-template-columns:repeat(2,minmax(0,1fr)); }#escalation .esc-trend-wide { grid-column:1 / -1;order:-1;min-height:340px; }#escalation .esc-trend-wide .esc-chart-wrap { height:290px; }#escalation .chart-card { background:linear-gradient(180deg,rgba(30,41,59,0.62),rgba(15,23,42,0.48));border:1px solid rgba(148,163,184,0.16);border-radius:8px;box-shadow:0 14px 32px rgba(2,6,23,0.12); }#escalation .esc-chart-card { position:relative;min-height:280px;padding:14px; }#escalation .esc-chart-wrap { position:relative;height:230px;width:100%; }#escalation .esc-kpi-clickable { cursor:pointer;transition:transform 0.12s ease,border-color 0.12s ease,background 0.12s ease; }#escalation .esc-kpi-clickable:hover, #escalation .esc-kpi-clickable:focus { transform:translateY(-1px);border-color:rgba(124,58,237,0.55);outline:none;background:rgba(124,58,237,0.09); }#escalation #escalationAgingChart, #escalation #escalationTopSupplierChart, #escalation #escalationActionTypeChart, #escalation #escalationEntityChart, #escalation #escalationMailboxChart { cursor:pointer; }@media (max-width: 900px) { #escalation .esc-chart-grid-main { grid-template-columns:1fr; } #escalation .esc-trend-wide { grid-column:auto; } }';
  document.head.appendChild(style);
})();
(function escActivateHashPage() {
  if (window.location.hash !== "#escalation") return;
  window.addEventListener("load", () => window.setTimeout(() => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    document.querySelector('.nav-item[data-page="escalation"]')?.classList.add("active");
    document.getElementById("escalation")?.classList.add("active");
    updateEscalation();
  }, 200));
})();
