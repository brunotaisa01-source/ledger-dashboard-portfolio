"use strict";
async function loadStatementData() {
  if (stmtData) return stmtData;
  if (typeof STATEMENT_COMPRESSED === "undefined" || !STATEMENT_COMPRESSED) return null;
  try {
    stmtData = await decompressBlob(STATEMENT_COMPRESSED);
    return stmtData;
  } catch (e) {
    console.error("Statement decompress error:", e);
    return null;
  }
}
function applyStatementFilters(rows) {
  const df = document.getElementById("stmtDateFrom")?.value || "";
  const dt = document.getElementById("stmtDateTo")?.value || "";
  const cty = document.getElementById("stmtCountry")?.value || "";
  const rs = document.getElementById("stmtRecStatus")?.value || "";
  const tm = document.getElementById("stmtTeam")?.value || "";
  const ow = document.getElementById("stmtOwner")?.value || "";
  const vc = document.getElementById("stmtCategoryFilter")?.value || "";
  const cc = xmsGetValues("sms_cc");
  return rows.filter((r) => {
    if (df && (r.ld || "") < df) return false;
    if (dt && (r.ld || "") > dt) return false;
    if (cty && (r.cty || "") !== cty) return false;
    if (rs && (r.rs || "") !== rs) return false;
    if (tm && (r.tm || "") !== tm) return false;
    if (ow && (r.au || "") !== ow) return false;
    if (vc) {
      const rowVc = (r.vc || "").trim() || "Uncategorised";
      if (rowVc !== vc) return false;
    }
    if (cc.length && !cc.some((c) => (r.cc || "").includes(c))) return false;
    return true;
  });
}
function computeStatementKPIs(rows) {
  let total = 0, unreconciled = 0, ledgerBal = 0, stmtBal = 0, diff = 0, actionsPending = 0;
  rows.forEach((r) => {
    total++;
    if ((r.rs || "").toLowerCase() !== "reconciled") unreconciled++;
    ledgerBal += parseFloat(String(r.lb)) || 0;
    stmtBal += parseFloat(String(r.sb)) || 0;
    diff += parseFloat(String(r.dif)) || 0;
    actionsPending += parseInt(String(r.ap)) || 0;
  });
  const unreconciledPct = total > 0 ? (unreconciled / total * 100).toFixed(1) : "0.0";
  return { total, unreconciled, unreconciledPct, ledgerBal, stmtBal, diff, actionsPending };
}
function populateStatementFilters(allRows) {
  const dates = [...new Set(allRows.map((r) => r.ld || "").filter(Boolean))].sort();
  const countries = [...new Set(allRows.map((r) => r.cty || "").filter(Boolean))].sort();
  const owners = [...new Set(allRows.map((r) => r.au || "").filter(Boolean))].sort();
  const categories = [...new Set(allRows.map((r) => (r.vc || "").trim() || "Uncategorised"))].sort();
  const companyCodes = [...new Set(allRows.flatMap((r) => (r.cc || "").split("; ").map((s) => s.trim()).filter(Boolean)))].sort();
  const ctyEl = document.getElementById("stmtCountry");
  if (ctyEl) {
    const cur = ctyEl.value;
    ctyEl.innerHTML = '<option value="">All Countries</option>' + countries.map((c) => `<option value="${hesc(c)}"${c === cur ? " selected" : ""}>${hesc(c)}</option>`).join("");
  }
  const owEl = document.getElementById("stmtOwner");
  if (owEl) {
    const cur = owEl.value;
    owEl.innerHTML = '<option value="">All Owners</option>' + owners.map((o) => `<option value="${hesc(o)}"${o === cur ? " selected" : ""}>${hesc(o)}</option>`).join("");
  }
  const vcEl = document.getElementById("stmtCategoryFilter");
  if (vcEl) {
    const cur = vcEl.value;
    vcEl.innerHTML = '<option value="">All Categories</option>' + categories.map((c) => `<option value="${hesc(c)}"${c === cur ? " selected" : ""}>${hesc(c)}</option>`).join("");
  }
  xmsPopulate("sms_cc", companyCodes);
  const fromEl = document.getElementById("stmtDateFrom");
  const toEl = document.getElementById("stmtDateTo");
  if (dates.length > 0) {
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];
    if (fromEl) {
      fromEl.min = minDate;
      fromEl.max = maxDate;
    }
    if (toEl) {
      toEl.min = minDate;
      toEl.max = maxDate;
    }
  }
}
function normalizeVendorNo(v) {
  if (!v) return "";
  return String(v).replace(/\.0$/, "").replace(/^0+/, "") || "0";
}
function getStmtFilters() {
  return {
    country: document.getElementById("stmtCountry")?.value || "",
    team: document.getElementById("stmtTeam")?.value || "",
    owner: document.getElementById("stmtOwner")?.value || "",
    companyCodes: xmsGetValues("sms_cc")
  };
}
function buildOverdueSupplierMap(cubeRows, filters) {
  const headers = cubeRows.filter((r) => (String(r.rl) || "").toLowerCase() === "header");
  const filtered = headers.filter((r) => {
    if (filters.country && (r.co || "") !== filters.country) return false;
    if (filters.team) {
      const sh = (String(r.sh) || "").toUpperCase();
      const ft = filters.team.toUpperCase();
      if (sh !== ft) return false;
    }
    if (filters.owner && (r.o || "") !== filters.owner) return false;
    if (filters.companyCodes.length && !filters.companyCodes.includes(String(r.cc || ""))) return false;
    return true;
  });
  const overdue = filtered.filter((r) => {
    return (r.a030 || 0) !== 0 || (r.a3160 || 0) !== 0 || (r.a6190 || 0) !== 0 || (r.a91120 || 0) !== 0 || (r.a121180 || 0) !== 0 || (r.a180 || 0) !== 0;
  });
  const map = {};
  for (const r of overdue) {
    const normS = normalizeVendorNo(String(r.s));
    const key = normS + "|" + (r.cc || "");
    if (!map[key]) {
      map[key] = {
        s: String(r.s),
        sn: String(r.sn || ""),
        cc: String(r.cc || ""),
        co: String(r.co || ""),
        o: String(r.o || ""),
        sh: String(r.sh || ""),
        sheets: /* @__PURE__ */ new Set(),
        overdueValue: 0,
        normKey: key,
        buckets: /* @__PURE__ */ new Set(),
        cm: String(r.cm || "")
      };
    }
    map[key].sheets.add(String(r.sh || ""));
    if ((r.a030 || 0) !== 0) map[key].buckets.add("0-30");
    if ((r.a3160 || 0) !== 0) map[key].buckets.add("31-60");
    if ((r.a6190 || 0) !== 0) map[key].buckets.add("61-90");
    if ((r.a91120 || 0) !== 0) map[key].buckets.add("91-120");
    if ((r.a121180 || 0) !== 0) map[key].buckets.add("121-180");
    if ((r.a180 || 0) !== 0) map[key].buckets.add("180+");
    map[key].overdueValue += Math.abs(Number(r.a030) || 0) + Math.abs(Number(r.a3160) || 0) + Math.abs(Number(r.a6190) || 0) + Math.abs(Number(r.a91120) || 0) + Math.abs(Number(r.a121180) || 0) + Math.abs(Number(r.a180) || 0);
  }
  return map;
}
function buildStatementCoverageSet(stmtRows) {
  const covered = /* @__PURE__ */ new Set();
  for (const r of stmtRows) {
    const vendorNos = (r.vnos || "").split(";").map((v) => v.trim()).filter(Boolean);
    const ccSet = new Set((r.cc || "").split(";").map((c) => c.trim()).filter(Boolean));
    if (r.pcc) ccSet.add(r.pcc);
    for (const vn of vendorNos) {
      const normVn = normalizeVendorNo(vn);
      for (const cc of ccSet) {
        covered.add(normVn + "|" + cc);
      }
    }
  }
  return covered;
}
function computeStatementCoverage(cubeRows, stmtAllRows, filters) {
  const overdueMap = buildOverdueSupplierMap(cubeRows, filters);
  const filteredStmt = applyStatementFilters(stmtAllRows);
  const coverageSet = buildStatementCoverageSet(filteredStmt);
  const covered = [];
  const uncovered = [];
  for (const [key, supplier] of Object.entries(overdueMap)) {
    if (coverageSet.has(key)) {
      covered.push(supplier);
    } else {
      uncovered.push(supplier);
    }
  }
  uncovered.sort((a, b) => Math.abs(b.overdueValue) - Math.abs(a.overdueValue));
  const total = covered.length + uncovered.length;
  return {
    totalOverdue: total,
    totalOverdueSuppliers: total,
    coveredCount: covered.length,
    coveredSuppliers: covered.length,
    uncoveredCount: uncovered.length,
    coveragePct: total > 0 ? (covered.length / total * 100).toFixed(1) : "0.0",
    coveredValue: covered.reduce((s, r) => s + r.overdueValue, 0),
    uncoveredValue: uncovered.reduce((s, r) => s + r.overdueValue, 0),
    uncoveredSuppliers: uncovered
  };
}
function renderStmtCoverageChart(coverage) {
  if (stmtCharts.coverage) {
    try {
      stmtCharts.coverage.destroy();
    } catch (e) {
    }
  }
  const canvas = document.getElementById("stmtCoverageChart");
  if (!canvas) return;
  const labels = ["With Statement", "Without Statement"];
  const values = [coverage.coveredCount, coverage.uncoveredCount];
  const colors = ["#28A745", "#F59E0B"];
  stmtCharts.coverage = new Chart(canvas, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: isDark() ? "#1e293b" : "#fff" }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 12 }, color: isDark() ? "#94a3b8" : "#64748b" } },
        datalabels: {
          font: { weight: "700", size: 14 },
          color: "#fff",
          formatter: (v) => v > 0 ? v : ""
        }
      }
    }
  });
}
function renderStmtCoverageKPIs(coverage) {
  const el = document.getElementById("stmtCoverageKPIs");
  if (!el) return;
  const uncPct = (100 - parseFloat(coverage.coveragePct)).toFixed(1);
  el.innerHTML = `
        <div style="background:rgba(59,130,246,0.08);border-radius:12px;padding:16px;border-left:4px solid #3b82f6;">
            <div style="font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Total Overdue Suppliers</div>
            <div style="font-size:1.8rem;font-weight:800;color:#3b82f6;">${coverage.totalOverdue}</div>
        </div>
        <div style="background:rgba(40,167,69,0.08);border-radius:12px;padding:16px;border-left:4px solid #28A745;">
            <div style="font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Covered (With Statement)</div>
            <div style="font-size:1.8rem;font-weight:800;color:#28A745;">${coverage.coveredCount} <small style="font-size:0.55em;opacity:0.7">(${coverage.coveragePct}%)</small></div>
            <div style="font-size:0.8rem;color:var(--text-muted);">Value: ${fmt(coverage.coveredValue)}</div>
        </div>
        <div style="background:rgba(245,158,11,0.08);border-radius:12px;padding:16px;border-left:4px solid #F59E0B;">
            <div style="font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Uncovered (No Statement)</div>
            <div style="font-size:1.8rem;font-weight:800;color:#F59E0B;">${coverage.uncoveredCount} <small style="font-size:0.55em;opacity:0.7">(${uncPct}%)</small></div>
            <div style="font-size:0.8rem;color:var(--text-muted);">Value: ${fmt(coverage.uncoveredValue)}</div>
        </div>
    `;
}
function filterNoStmtByBucket(suppliers) {
  const bucketFilter = xmsGetValues("xms_nostmt_bucket");
  if (!bucketFilter.length) return suppliers;
  return suppliers.filter((r) => bucketFilter.some((b) => r.buckets.has(b)));
}
function renderNoStmtTable(suppliers) {
  const tbl = document.getElementById("stmtNoStmtTable");
  const container = document.getElementById("stmtNoStmtContainer");
  if (!tbl) return;
  if (!suppliers || suppliers.length === 0) {
    if (container) container.style.display = "none";
    return;
  }
  if (container) container.style.display = "";
  const filtered = filterNoStmtByBucket(suppliers);
  pageData.stmtNoStmt = filtered;
  if (filtered.length === 0) {
    tbl.innerHTML = '<thead><tr><th colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);font-weight:400;">No suppliers match the selected bucket filter</th></tr></thead>';
    document.getElementById("stmtNoStmtPagination").innerHTML = "";
    return;
  }
  const paged = paginateRows(filtered, "stmtNoStmt");
  const body = paged.map((r) => {
    const sheetBadges = [...r.sheets].map((sh) => {
      const bg = sh === "Key" ? "#E8F5E9" : sh === "ROL" ? "#E3F2FD" : "#FFF3E0";
      const fg = sh === "Key" ? "#2E7D32" : sh === "ROL" ? "#1565C0" : "#E65100";
      return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:4px;font-size:0.8rem;font-weight:600">${sh}</span>`;
    }).join(" ");
    const bucketBadges = [...r.buckets].map((b) => {
      return `<span style="background:rgba(220,53,69,0.1);color:#DC3545;padding:2px 6px;border-radius:4px;font-size:0.75rem;font-weight:600">${b}</span>`;
    }).join(" ");
    return `<tr>
            <td style="font-weight:600">${hesc(r.s)}</td>
            <td class="supplier-name">${hesc(r.sn || "")}</td>
            <td>${hesc(r.cc || "")}</td>
            <td>${hesc(r.co || "")}</td>
            <td>${hesc(r.o || "")}</td>
            <td style="text-align:right;font-weight:600;color:#DC3545">${fmt(r.overdueValue)}</td>
            <td>${bucketBadges}</td>
            <td>${sheetBadges}</td>
        </tr>`;
  }).join("");
  tbl.innerHTML = `<thead><tr>
        <th>Supplier No</th><th>Supplier Name</th><th>Company Code</th><th>Country</th>
        <th>Owner</th><th style="text-align:right">Overdue Value</th><th>Aging Buckets</th><th>Sheet</th>
    </tr></thead><tbody>${body}</tbody>`;
  renderPagination("stmtNoStmt", "stmtNoStmtPagination");
}
function changeNoStmtTableSize(n) {
  tableLimits.stmtNoStmt = n;
  pageState.stmtNoStmt = 1;
  if (stmtCoverageCache) renderNoStmtTable(stmtCoverageCache.uncoveredSuppliers);
}
function exportNoStmtCSV() {
  if (!stmtCoverageCache || !stmtCoverageCache.uncoveredSuppliers.length) return;
  const rows = filterNoStmtByBucket(stmtCoverageCache.uncoveredSuppliers);
  if (!rows.length) return;
  const headers = ["Supplier No", "Supplier Name", "Company Code", "Country", "Owner", "Overdue Value", "Aging Buckets", "Sheet(s)", "Comment"];
  let csv = "\uFEFF" + headers.map((h) => '"' + h + '"').join(",") + "\r\n";
  rows.forEach((r) => {
    csv += `"${r.s}","${(r.sn || "").replace(/"/g, '""')}","${r.cc}","${r.co}","${r.o}","${r.overdueValue.toFixed(2)}","${[...r.buckets].join(", ")}","${[...r.sheets].join(", ")}","${(r.cm || "").replace(/"/g, '""')}"\r
`;
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "suppliers_without_statement.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}
async function updateStatement() {
  const data = await loadStatementData();
  const noDataEl = document.getElementById("stmtNoData");
  const kpiEl = document.getElementById("stmt-kpis");
  if (!data || !data.rows || data.rows.length === 0) {
    if (noDataEl) noDataEl.style.display = "block";
    if (kpiEl) kpiEl.innerHTML = "";
    return;
  }
  if (noDataEl) noDataEl.style.display = "none";
  populateStatementFilters(data.rows);
  const filtered = applyStatementFilters(data.rows);
  const kpis = computeStatementKPIs(filtered);
  if (kpiEl) {
    kpiEl.innerHTML = `
            <div class="kpi-card" style="border-left: 4px solid #3b82f6"><div class="kpi-label">Statements Received</div><div class="kpi-value" style="color:#3b82f6">${kpis.total.toLocaleString()}</div></div>
            <div class="kpi-card" style="border-left: 4px solid var(--orange)"><div class="kpi-label">Unreconciled</div><div class="kpi-value" style="color:var(--orange)">${kpis.unreconciled.toLocaleString()}<small style="font-size:0.6em;opacity:0.7"> (${kpis.unreconciledPct}%)</small></div></div>
            <div class="kpi-card" style="border-left: 4px solid var(--primary)"><div class="kpi-label">Ledger Balance</div><div class="kpi-value" style="color:var(--primary)">${fmt(kpis.ledgerBal)}</div></div>
            <div class="kpi-card" style="border-left: 4px solid #2563eb"><div class="kpi-label">Statement Balance</div><div class="kpi-value" style="color:#2563eb">${fmt(kpis.stmtBal)}</div></div>
            <div class="kpi-card" style="border-left: 4px solid var(--red)"><div class="kpi-label">Difference</div><div class="kpi-value" style="color:var(--red)">${fmt(kpis.diff)}</div></div>
            <div class="kpi-card" style="border-left: 4px solid var(--green)"><div class="kpi-label">Actions Pending</div><div class="kpi-value" style="color:var(--green)">${kpis.actionsPending.toLocaleString()}</div></div>
        `;
  }
  renderStatementCharts(filtered, 0);
  try {
    renderStatementTable(filtered);
  } catch (e) {
    console.warn("Statement table:", e);
  }
  try {
    const weekData = await getWeekData(SORTED_WEEKS[0]);
    const cubeRows = weekData.raw || [];
    if (cubeRows.length > 0 && data.rows.length > 0) {
      const stmtFilters = getStmtFilters();
      const coverage = computeStatementCoverage(cubeRows, data.rows, stmtFilters);
      stmtCoverageCache = coverage;
      document.getElementById("stmtCoverageSection").style.display = "";
      renderStmtCoverageChart(coverage);
      renderStmtCoverageKPIs(coverage);
      pageState.stmtNoStmt = 1;
      renderNoStmtTable(coverage.uncoveredSuppliers);
    } else {
      document.getElementById("stmtCoverageSection").style.display = "none";
      document.getElementById("stmtNoStmtContainer").style.display = "none";
    }
  } catch (e) {
    console.warn("Statement coverage:", e);
  }
}
function renderStatementCharts(filtered, attempt) {
  const testCanvas = document.getElementById("stmtStatusChart");
  if (!testCanvas || testCanvas.offsetWidth === 0 || testCanvas.offsetHeight === 0) {
    if (attempt < 8) {
      setTimeout(() => renderStatementCharts(filtered, attempt + 1), 250);
    }
    return;
  }
  ["status", "country", "owner", "diff"].forEach((key) => {
    if (stmtCharts[key]) {
      try {
        stmtCharts[key].destroy();
      } catch (e) {
      }
      delete stmtCharts[key];
    }
  });
  try {
    renderStmtStatusChart(filtered);
  } catch (e) {
    console.warn("Stmt status chart:", e);
  }
  try {
    renderStmtCountryChart(filtered);
  } catch (e) {
    console.warn("Stmt country chart:", e);
  }
  try {
    renderStmtOwnerChart(filtered);
  } catch (e) {
    console.warn("Stmt owner chart:", e);
  }
  try {
    renderStmtDiffChart(filtered);
  } catch (e) {
    console.warn("Stmt diff chart:", e);
  }
}
function renderStmtStatusChart(rows) {
  const counts = { Reconciled: 0, Unreconciled: 0 };
  rows.forEach((r) => {
    if ((r.rs || "").toLowerCase() === "reconciled") counts.Reconciled++;
    else counts.Unreconciled++;
  });
  const labels = Object.keys(counts);
  const values = Object.values(counts);
  const colors = ["#28A745", "#FFC107"];
  if (stmtCharts.status) stmtCharts.status.destroy();
  stmtCharts.status = new Chart(document.getElementById("stmtStatusChart"), {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: isDark() ? "#1e293b" : "#fff" }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "55%",
      plugins: { legend: { position: "bottom", labels: { font: { size: 12 }, color: dlColor() } }, datalabels: { font: { weight: "700", size: 13 }, color: "#fff", formatter: (v, ctx) => v > 0 ? v : "" } }
    }
  });
}
function renderStmtCountryChart(rows) {
  const counts = {};
  rows.forEach((r) => {
    const c = r.cty || "Unknown";
    counts[c] = (counts[c] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map((s) => s[0]);
  const values = sorted.map((s) => s[1]);
  const palette = ["#1e40af", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#028090", "#2E7D32", "#F59E0B"];
  if (stmtCharts.country) stmtCharts.country.destroy();
  stmtCharts.country = new Chart(document.getElementById("stmtCountryChart"), {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: palette.slice(0, values.length), borderRadius: 6, barThickness: 30 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: { anchor: "end", align: "end", font: { weight: "700", size: 11 }, color: dlColor() } },
      scales: { x: { grid: { display: false }, ticks: { color: tickColor() } }, y: { grid: { display: true, color: gridColor() }, beginAtZero: true, ticks: { color: tickColor() } } }
    }
  });
}
function renderStmtOwnerChart(rows) {
  const agg = {};
  rows.forEach((r) => {
    const o = r.au || r.o || "Unassigned";
    if (!agg[o]) agg[o] = { recs: 0, actions: 0 };
    agg[o].recs += 1;
    agg[o].actions += parseInt(String(r.ap)) || 0;
  });
  const sorted = Object.entries(agg).sort((a, b) => b[1].recs - a[1].recs).slice(0, 10);
  const labels = sorted.map((s) => s[0]);
  const recs = sorted.map((s) => s[1].recs);
  const actions = sorted.map((s) => s[1].actions);
  if (stmtCharts.owner) stmtCharts.owner.destroy();
  stmtCharts.owner = new Chart(document.getElementById("stmtOwnerChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Recs", data: recs, backgroundColor: "#1e40af", borderRadius: 4, maxBarThickness: 18 },
        { label: "Actions Pending", data: actions, backgroundColor: "#f59e0b", borderRadius: 4, maxBarThickness: 18 }
      ]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "top", labels: { boxWidth: 12, font: { size: 11 }, color: tickColor() } },
        datalabels: { anchor: "end", align: "end", font: { weight: "700", size: 11 }, color: dlColor() }
      },
      scales: {
        x: { grid: { display: false }, beginAtZero: true, ticks: { color: tickColor() } },
        y: { grid: { display: false }, ticks: { font: { size: 11, weight: "600" }, color: tickColor() } }
      }
    }
  });
}
function renderStmtDiffChart(rows) {
  const diffs = {};
  rows.forEach((r) => {
    const c = r.cty || "Unknown";
    diffs[c] = (diffs[c] || 0) + (parseFloat(String(r.dif)) || 0);
  });
  const sorted = Object.entries(diffs).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const labels = sorted.map((s) => s[0]);
  const values = sorted.map((s) => s[1]);
  const colors = values.map((v) => v >= 0 ? "#3b82f6" : "#DC3545");
  if (stmtCharts.diff) stmtCharts.diff.destroy();
  stmtCharts.diff = new Chart(document.getElementById("stmtDiffChart"), {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 6, barThickness: 30 }] },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: { anchor: "end", align: "end", font: { weight: "700", size: 11 }, color: dlColor(), formatter: (v) => fmt(v) } },
      scales: { x: { grid: { display: false }, ticks: { color: tickColor(), callback: (v) => fmt(v) } }, y: { grid: { display: false }, ticks: { font: { size: 11, weight: "600" }, color: tickColor() } } }
    }
  });
}
function renderStatementTable(rows) {
  const tbl = document.getElementById("stmtTable");
  const container = document.getElementById("stmtTableContainer");
  if (!tbl) return;
  if (rows.length === 0) {
    if (container) container.style.display = "none";
    return;
  }
  if (container) container.style.display = "";
  const sorted = [...rows].sort((a, b) => Math.abs(parseFloat(String(b.dif)) || 0) - Math.abs(parseFloat(String(a.dif)) || 0));
  const paged = paginateRows(sorted, "stmt");
  const body = paged.map((r) => {
    const teamBadge = teamBadgeHtml(r.tm || "");
    const isRecon = (r.rs || "").toLowerCase() === "reconciled";
    const statusBadge = statusBadgeHtml(r.rs || "", isRecon);
    const diffVal = parseFloat(String(r.dif)) || 0;
    return `<tr>
            <td>${hesc(r.rid || "")}</td>
            <td>${statusBadge}</td>
            <td title="${hesc(r.vn || "")}">${hesc((r.vn || "").substring(0, 30))}</td>
            <td>${hesc(r.cty || "")}</td>
            <td>${hesc(r.pcc || "")}</td>
            <td>${hesc(r.ld || "")}</td>
            <td style="text-align:right;font-weight:600">${fmt(parseFloat(String(r.lb)) || 0)}</td>
            <td style="text-align:right;font-weight:600">${fmt(parseFloat(String(r.sb)) || 0)}</td>
            <td style="text-align:right;font-weight:600;color:${diffVal !== 0 ? "#DC3545" : "inherit"}">${fmt(diffVal)}</td>
            <td style="text-align:center">${r.li || 0}</td>
            <td style="text-align:center">${r.ap || 0}</td>
            <td style="font-weight:600">${hesc(r.au || r.o || "")}</td>
            <td>${teamBadge}</td>
        </tr>`;
  }).join("");
  tbl.innerHTML = `<thead><tr>
        <th>Rec ID</th><th>Status</th><th>Vendor</th><th>Country</th><th>CoCo</th>
        <th>Ledger Date</th><th style="text-align:right">Ledger Bal</th><th style="text-align:right">Stmt Bal</th><th style="text-align:right">Difference</th>
        <th style="text-align:center">Lines</th><th style="text-align:center">Actions</th><th>Assigned User</th><th>Team</th>
    </tr></thead><tbody>${body}</tbody>`;
  renderPagination("stmt", "stmtPagination");
}
function exportStatementCSV() {
  if (!stmtData || !stmtData.rows) return;
  const filtered = applyStatementFilters(stmtData.rows);
  const headers = ["Snapshot Date", "Rec ID", "Rec Status", "Vendor Names", "Vendor Nos", "Country", "Primary Company Code", "Company Codes", "Ledger Date", "Created Date", "Reconciled Date", "Ledger Balance", "Statement Balance", "Difference", "Line Items", "Actions Pending", "Statement Type", "Reconciled By", "Assigned User", "Category", "Owner", "Team", "Problem Invoices", "Copy Requested", "Request Copy", "Investigate", "Unposted", "All Rec Comments"];
  function getVal(r, h) {
    const m = {
      "Snapshot Date": r.sd || "",
      "Rec ID": r.rid || "",
      "Rec Status": r.rs || "",
      "Vendor Names": r.vn || "",
      "Vendor Nos": r.vnos || "",
      "Country": r.cty || "",
      "Primary Company Code": r.pcc || "",
      "Company Codes": r.cc || "",
      "Ledger Date": r.ld || "",
      "Created Date": r.crd || "",
      "Reconciled Date": r.rcd || "",
      "Ledger Balance": r.lb || "",
      "Statement Balance": r.sb || "",
      "Difference": r.dif || "",
      "Line Items": r.li || "",
      "Actions Pending": r.ap || "",
      "Statement Type": r.stt || "",
      "Reconciled By": r.rb || "",
      "Assigned User": r.au || "",
      "Category": r.cat || "",
      "Owner": r.o || "",
      "Team": r.tm || "",
      "Problem Invoices": r.pi || "",
      "Copy Requested": r.cr || "",
      "Request Copy": r.rc || "",
      "Investigate": r.inv || "",
      "Unposted": r.up || "",
      "All Rec Comments": r.cmt || ""
    };
    return m[h] ?? "";
  }
  let csv = headers.map((h) => '"' + h + '"').join(",") + "\n";
  filtered.forEach((r) => {
    csv += headers.map((h) => '"' + String(getVal(r, h)).replace(/"/g, '""') + '"').join(",") + "\n";
  });
  const dfrom = document.getElementById("stmtDateFrom")?.value || "";
  const dto = document.getElementById("stmtDateTo")?.value || "";
  const dateSuffix = dfrom && dto ? `${dfrom}_to_${dto}` : dfrom || dto || "all";
  downloadCSV(csv, `statement_reconciliation_${dateSuffix}.csv`);
}
function changeStatementTableSize(key, n) {
  tableLimits[key] = n;
  pageState[key] = 1;
  if (stmtData && stmtData.rows) {
    const filtered = applyStatementFilters(stmtData.rows);
    renderStatementTable(filtered);
  }
}
function resetStatementFilters() {
  const fromEl = document.getElementById("stmtDateFrom");
  const toEl = document.getElementById("stmtDateTo");
  if (fromEl) fromEl.value = "";
  if (toEl) toEl.value = "";
  const ctyEl = document.getElementById("stmtCountry");
  const rsEl = document.getElementById("stmtRecStatus");
  const tmEl = document.getElementById("stmtTeam");
  const owEl = document.getElementById("stmtOwner");
  const vcEl = document.getElementById("stmtCategoryFilter");
  if (ctyEl) ctyEl.value = "";
  if (rsEl) rsEl.value = "";
  if (tmEl) tmEl.value = "";
  if (owEl) owEl.value = "";
  if (vcEl) vcEl.value = "";
  xmsReset("sms_cc");
  xmsReset("xms_nostmt_bucket");
  pageState.stmt = 1;
  pageState.stmtNoStmt = 1;
  stmtCoverageCache = null;
  updateStatement();
}
