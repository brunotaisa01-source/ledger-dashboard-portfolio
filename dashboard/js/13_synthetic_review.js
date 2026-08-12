"use strict";
function xmsToggle(id) {
  const panel = document.getElementById(id + "_panel");
  if (!panel) return;
  document.querySelectorAll(".xms-panel.open").forEach((p) => {
    if (p.id !== id + "_panel") p.classList.remove("open");
  });
  panel.classList.toggle("open");
}
function xmsGetValues(id) {
  const panel = document.getElementById(id + "_panel");
  if (!panel) return [];
  return [...panel.querySelectorAll("input:checked")].map((i) => i.value);
}
function xmsPopulate(id, values) {
  const panel = document.getElementById(id + "_panel");
  if (!panel) return;
  const checked = new Set(xmsGetValues(id));
  const links = `<div style="display:flex;gap:0.5rem;padding:0.3rem 0;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="xmsSelectAll('${id}');return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="xmsReset('${id}');xmsUpdate('${id}');return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>`;
  panel.innerHTML = links + values.map(
    (v) => `<label><input type="checkbox" value="${hesc(v)}" ${checked.has(v) ? "checked" : ""} onchange="xmsUpdate('${id}')">${hesc(v)}</label>`
  ).join("");
}
function xmsSelectAll(id) {
  const panel = document.getElementById(id + "_panel");
  if (!panel) return;
  panel.querySelectorAll("input").forEach((i) => i.checked = true);
  xmsUpdate(id);
}
function xmsUpdate(id) {
  const vals = xmsGetValues(id);
  const btn = document.querySelector("#" + id + " .xms-label");
  if (btn) {
    const allLabel = btn.dataset.all || "All";
    if (vals.length === 0) btn.textContent = allLabel;
    else if (vals.length <= 2) btn.textContent = vals.join(", ");
    else btn.textContent = vals.length + " selected";
  }
  if (id === "xms_nostmt_bucket") {
    pageState.stmtNoStmt = 1;
    if (stmtCoverageCache) renderNoStmtTable(stmtCoverageCache.uncoveredSuppliers);
    return;
  }
  if (id.startsWith("sms_")) {
    pageState.stmt = 1;
    updateStatement();
  } else {
    pageState.synthetic_review = 1;
    pageState.synthetic_reviewDupes = 1;
    pageState.synthetic_reviewErrors = 1;
    updateSyntheticReview();
  }
}
function xmsReset(id) {
  const panel = document.getElementById(id + "_panel");
  if (panel) panel.querySelectorAll("input").forEach((i) => i.checked = false);
  const btn = document.querySelector("#" + id + " .xms-label");
  if (btn) btn.textContent = btn.dataset.all || "All";
}
document.addEventListener("click", (e) => {
  if (!e.target?.closest(".xms")) document.querySelectorAll(".xms-panel.open").forEach((p) => p.classList.remove("open"));
});
async function loadSyntheticReviewData() {
  if (synthetic_reviewData) return synthetic_reviewData;
  if (typeof SYNTHETIC_REVIEW_COMPRESSED === "undefined" || !SYNTHETIC_REVIEW_COMPRESSED) return null;
  try {
    synthetic_reviewData = await decompressBlob(SYNTHETIC_REVIEW_COMPRESSED);
    return synthetic_reviewData;
  } catch (e) {
    console.error("SyntheticReview decompress error:", e);
    return null;
  }
}
function applySyntheticReviewFilters(rows) {
  const df = document.getElementById("synthetic_reviewDateFrom")?.value || "";
  const dt = document.getElementById("synthetic_reviewDateTo")?.value || "";
  const sf = xmsGetValues("xms_source");
  const rf = xmsGetValues("xms_risk");
  const rc = xmsGetValues("xms_recovery");
  const tm = xmsGetValues("xms_team");
  const ow = xmsGetValues("xms_owner");
  const ct = xmsGetValues("xms_country");
  const cc = xmsGetValues("xms_cc");
  const sl = xmsGetValues("xms_cat");
  return rows.filter((r) => {
    if (df && r.sd < df) return false;
    if (dt && r.sd > dt) return false;
    if (sf.length && !sf.includes(String(r.st))) return false;
    if (rf.length && !rf.includes(String(r.rk))) return false;
    if (rc.length && !rc.includes(String(r.rs))) return false;
    if (tm.length && !tm.includes(String(r.tm))) return false;
    if (ow.length && !ow.includes(String(r.o))) return false;
    if (ct.length && !ct.includes(synthetic_reviewCleanCountry(r.reg))) return false;
    if (cc.length && !cc.includes(String(r.dr))) return false;
    if (sl.length && !sl.includes(String(r.cat))) return false;
    return true;
  });
}
function computeSyntheticReviewKPIs(rows) {
  let total = 0, errors = 0, totalAmt = 0, highRisk = 0, highAmt = 0, vendors = /* @__PURE__ */ new Set();
  const pairIds = /* @__PURE__ */ new Set();
  rows.forEach((r) => {
    total++;
    const amt = parseFloat(r.amt) || 0;
    totalAmt += amt;
    if (r.st === "Invoice Error") errors++;
    else if (r.pid) pairIds.add(r.pid);
    if (r.rk === "High") {
      highRisk++;
      highAmt += amt;
    }
    if (r.ur) vendors.add(r.ur);
  });
  return { total, errors, dupes: pairIds.size, totalAmt, highRisk, highAmt, vendors: vendors.size };
}
function populateSyntheticReviewFilters(allRows) {
  const dates = [...new Set(allRows.map((r) => r.sd))].sort().reverse();
  const recoveries = [...new Set(allRows.map((r) => r.rs || "").filter(Boolean))].sort();
  const owners = [...new Set(allRows.map((r) => r.o || "").filter(Boolean))].sort();
  const countries = [...new Set(allRows.map((r) => synthetic_reviewCleanCountry(r.reg)).filter(Boolean))].sort();
  const companyCodes = [...new Set(allRows.map((r) => r.dr || "").filter(Boolean))].sort();
  const categories = [...new Set(allRows.map((r) => r.cat || "").filter(Boolean))].sort();
  xmsPopulate("xms_recovery", recoveries);
  xmsPopulate("xms_owner", owners);
  xmsPopulate("xms_country", countries);
  xmsPopulate("xms_cc", companyCodes);
  xmsPopulate("xms_cat", categories);
  const fromEl = document.getElementById("synthetic_reviewDateFrom");
  const toEl = document.getElementById("synthetic_reviewDateTo");
  if (dates.length > 0) {
    const minDate = dates[dates.length - 1];
    const maxDate = dates[0];
    if (fromEl) {
      fromEl.min = minDate;
      fromEl.max = maxDate;
      if (!fromEl.value) fromEl.value = maxDate;
    }
    if (toEl) {
      toEl.min = minDate;
      toEl.max = maxDate;
      if (!toEl.value) toEl.value = maxDate;
    }
  }
}
async function updateSyntheticReview() {
  const data = await loadSyntheticReviewData();
  const noDataEl = document.getElementById("synthetic_reviewNoData");
  const kpiEl = document.getElementById("synthetic_review-kpis");
  if (!data || !data.rows || data.rows.length === 0) {
    if (noDataEl) noDataEl.style.display = "block";
    if (kpiEl) kpiEl.innerHTML = "";
    return;
  }
  if (noDataEl) noDataEl.style.display = "none";
  populateSyntheticReviewFilters(data.rows);
  const filtered = applySyntheticReviewFilters(data.rows);
  const kpis = computeSyntheticReviewKPIs(filtered);
  if (kpiEl) {
    kpiEl.innerHTML = `
            <div class="kpi-card" style="border-left: 4px solid #3b82f6"><div class="kpi-label">Total Items</div><div class="kpi-value" style="color:#3b82f6">${kpis.total.toLocaleString()}</div></div>
            <div class="kpi-card" style="border-left: 4px solid var(--red)"><div class="kpi-label">Invoice Errors</div><div class="kpi-value" style="color:var(--red)">${kpis.errors.toLocaleString()}</div></div>
            <div class="kpi-card" style="border-left: 4px solid var(--orange)"><div class="kpi-label">Duplicate Pairs</div><div class="kpi-value" style="color:var(--orange)">${kpis.dupes.toLocaleString()}</div></div>
            <div class="kpi-card" style="border-left: 4px solid var(--primary)"><div class="kpi-label">Value at Risk</div><div class="kpi-value" style="color:var(--primary)">${fmt(kpis.totalAmt)}</div></div>
            <div class="kpi-card" style="border-left: 4px solid #DC3545"><div class="kpi-label">High Risk</div><div class="kpi-value" style="color:#DC3545">${kpis.highRisk.toLocaleString()}</div></div>
            <div class="kpi-card" style="border-left: 4px solid var(--green)"><div class="kpi-label">Unique Vendors</div><div class="kpi-value" style="color:var(--green)">${kpis.vendors.toLocaleString()}</div></div>
        `;
  }
  renderSyntheticReviewCharts(filtered, 0);
  try {
    renderSyntheticReviewTable(filtered);
  } catch (e) {
    console.warn("SyntheticReview table:", e);
  }
}
function renderSyntheticReviewCharts(filtered, attempt) {
  const testCanvas = document.getElementById("synthetic_reviewOwnerChart");
  if (!testCanvas || testCanvas.offsetWidth === 0 || testCanvas.offsetHeight === 0) {
    if (attempt < 8) {
      setTimeout(() => renderSyntheticReviewCharts(filtered, attempt + 1), 250);
    }
    return;
  }
  Object.values(synthetic_reviewCharts).forEach((c) => {
    try {
      c.destroy();
    } catch (e) {
    }
  });
  synthetic_reviewCharts = {};
  try {
    renderSyntheticReviewOwnerChart(filtered);
  } catch (e) {
    console.warn("SyntheticReview owner chart:", e);
  }
  try {
    renderSyntheticReviewRiskChart(filtered);
  } catch (e) {
    console.warn("SyntheticReview risk chart:", e);
  }
  try {
    renderSyntheticReviewClassChart(filtered);
  } catch (e) {
    console.warn("SyntheticReview class chart:", e);
  }
  try {
    renderSyntheticReviewRegionChart(filtered);
  } catch (e) {
    console.warn("SyntheticReview region chart:", e);
  }
  try {
    renderSyntheticReviewWeeklyTrendChart();
  } catch (e) {
    console.warn("SyntheticReview weekly trend chart:", e);
  }
}
function renderSyntheticReviewOwnerChart(rows) {
  const counts = {};
  rows.forEach((r) => {
    const o = r.o || "Unassigned";
    counts[o] = (counts[o] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const labels = sorted.map((s) => s[0]);
  const values = sorted.map((s) => s[1]);
  const colors = ["#1e40af", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#0ea5e9", "#06b6d4", "#14b8a6", "#10b981", "#22c55e"];
  if (synthetic_reviewCharts.owner) synthetic_reviewCharts.owner.destroy();
  synthetic_reviewCharts.owner = new Chart(document.getElementById("synthetic_reviewOwnerChart"), {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: colors.slice(0, values.length), borderRadius: 4, maxBarThickness: 22, categoryPercentage: 0.8, barPercentage: 0.85 }] },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: { anchor: "end", align: "end", font: { weight: "700", size: 11 }, color: dlColor() } },
      scales: { x: { grid: { display: false }, beginAtZero: true, ticks: { color: tickColor() } }, y: { grid: { display: false }, ticks: { font: { size: 11, weight: "600" }, color: tickColor() } } }
    }
  });
}
function renderSyntheticReviewRiskChart(rows) {
  const counts = { High: 0, Medium: 0, Low: 0 };
  rows.forEach((r) => {
    const rk = r.rk || "";
    if (counts[rk] !== void 0) counts[rk]++;
  });
  const labels = Object.keys(counts);
  const values = Object.values(counts);
  const colors = ["#DC3545", "#FFC107", "#28A745"];
  if (synthetic_reviewCharts.risk) synthetic_reviewCharts.risk.destroy();
  synthetic_reviewCharts.risk = new Chart(document.getElementById("synthetic_reviewRiskChart"), {
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
function renderSyntheticReviewClassChart(rows) {
  const counts = {};
  rows.forEach((r) => {
    const cls = r.et || r.cls || "Unknown";
    counts[cls] = (counts[cls] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const labels = sorted.map((s) => s[0].length > 25 ? s[0].substring(0, 22) + "..." : s[0]);
  const values = sorted.map((s) => s[1]);
  const palette = ["#1e40af", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#028090", "#2E7D32", "#F59E0B", "#E53E3E", "#805AD5"];
  if (synthetic_reviewCharts.cls) synthetic_reviewCharts.cls.destroy();
  synthetic_reviewCharts.cls = new Chart(document.getElementById("synthetic_reviewClassChart"), {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: palette.slice(0, values.length), borderRadius: 6 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: { anchor: "end", align: "end", font: { weight: "700", size: 11 }, color: dlColor() } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 }, color: tickColor() } }, y: { grid: { display: true, color: gridColor() }, beginAtZero: true, ticks: { color: tickColor() } } }
    }
  });
}
function renderSyntheticReviewRegionChart(rows) {
  const counts = {};
  rows.forEach((r) => {
    const reg = synthetic_reviewCleanCountry(r.reg) || "Unknown";
    counts[reg] = (counts[reg] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map((s) => s[0]);
  const values = sorted.map((s) => s[1]);
  const palette = ["#1e40af", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#028090", "#2E7D32", "#F59E0B"];
  if (synthetic_reviewCharts.region) synthetic_reviewCharts.region.destroy();
  synthetic_reviewCharts.region = new Chart(document.getElementById("synthetic_reviewRegionChart"), {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: palette.slice(0, values.length), borderRadius: 6, barThickness: 30 }] },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: { anchor: "end", align: "end", font: { weight: "700", size: 11 }, color: dlColor() } },
      scales: { x: { grid: { display: false }, beginAtZero: true, ticks: { color: tickColor() } }, y: { grid: { display: false }, ticks: { font: { size: 11, weight: "600" }, color: tickColor() } } }
    }
  });
}
function synthetic_reviewCleanCountry(reg) {
  return (reg || "").replace(/^Synthetic Services\s*/i, "").trim() || reg || "";
}
function synthetic_reviewDupeRowHtml(r, pairBg) {
  const teamBadge = teamBadgeHtml(r.tm || "");
  const rk = r.rk || "";
  const rc = rk === "High" ? "#DC3545" : rk === "Medium" ? "#FFC107" : "#28A745";
  const rt = rk === "Medium" ? "#333" : "#fff";
  const riskBadge = rk ? `<span style="background:${rc};color:${rt};padding:2px 6px;border-radius:4px;font-size:0.75rem;font-weight:600">${rk}</span>` : "";
  const bgStyle = pairBg ? ` style="background:${pairBg}"` : "";
  return `<tr${bgStyle}>
        <td style="font-weight:600">${hesc(r.o || "")}</td>
        <td>${hesc(r.pid || "")}</td>
        <td>${hesc(r.cat || "")}</td>
        <td>${hesc(synthetic_reviewCleanCountry(r.reg))}</td>
        <td>${hesc(r.dr || "")}</td>
        <td title="${hesc(r.vname || "")}">${hesc((r.vname || "").substring(0, 30))}</td>
        <td>${hesc(r.vn || "")}</td>
        <td>${hesc(r.ino || "")}</td>
        <td>${hesc(r.id || "")}</td>
        <td>${hesc(r.cd || "")}</td>
        <td style="text-align:right;font-weight:600">${fmt(parseFloat(String(r.amt)) || 0)}</td>
        <td>${hesc(r.cur || "")}</td>
        <td>${hesc(r.dt || "")}</td>
        <td title="${hesc(r.cls || "")}">${hesc((r.cls || "").substring(0, 25))}</td>
        <td>${teamBadge}</td>
        <td>${hesc(r.rs || "")} ${riskBadge}</td>
        <td style="text-align:center">${hesc(String(r.age ?? ""))}</td>
    </tr>`;
}
function synthetic_reviewErrorRowHtml(r) {
  const teamBadge = teamBadgeHtml(r.tm || "");
  const rk = r.rk || "";
  const rc = rk === "High" ? "#DC3545" : rk === "Medium" ? "#FFC107" : "#28A745";
  const rt = rk === "Medium" ? "#333" : "#fff";
  const riskBadge = rk ? `<span style="background:${rc};color:${rt};padding:2px 6px;border-radius:4px;font-size:0.75rem;font-weight:600">${rk}</span>` : "";
  return `<tr>
        <td style="font-weight:600">${hesc(r.o || "")}</td>
        <td>${hesc(r.cat || "")}</td>
        <td>${hesc(synthetic_reviewCleanCountry(r.reg))}</td>
        <td>${hesc(r.dr || "")}</td>
        <td title="${hesc(r.vname || "")}">${hesc((r.vname || "").substring(0, 30))}</td>
        <td>${hesc(r.vn || "")}</td>
        <td>${hesc(r.ino || "")}</td>
        <td>${hesc(r.id || "")}</td>
        <td>${hesc(r.cd || "")}</td>
        <td style="text-align:right;font-weight:600">${fmt(parseFloat(String(r.amt)) || 0)}</td>
        <td>${hesc(r.cur || "")}</td>
        <td>${hesc(r.dt || "")}</td>
        <td title="${hesc(r.et || r.cls || "")}">${hesc((r.et || r.cls || "").substring(0, 25))}</td>
        <td>${teamBadge}</td>
        <td>${hesc(r.rs || "")} ${riskBadge}</td>
        <td style="text-align:center">${hesc(String(r.age ?? ""))}</td>
    </tr>`;
}
function renderSyntheticReviewTable(rows) {
  const dupes = rows.filter((r) => r.st === "Duplicate Invoice");
  const errors = rows.filter((r) => r.st === "Invoice Error").sort((a, b) => (parseFloat(String(b.amt)) || 0) - (parseFloat(String(a.amt)) || 0));
  const pairGroups = {};
  dupes.forEach((r) => {
    const pid = r.pid || "no_pair";
    if (!pairGroups[pid]) pairGroups[pid] = [];
    pairGroups[pid].push(r);
  });
  const sortedDupes = Object.values(pairGroups).sort((a, b) => {
    const aMax = Math.max(...a.map((r) => parseFloat(String(r.amt)) || 0));
    const bMax = Math.max(...b.map((r) => parseFloat(String(r.amt)) || 0));
    return bMax - aMax;
  }).flat();
  const dupeTbl = document.getElementById("synthetic_reviewDupesTable");
  const dupeContainer = document.getElementById("synthetic_reviewDupesContainer");
  if (dupeTbl) {
    if (sortedDupes.length === 0) {
      if (dupeContainer) dupeContainer.style.display = "none";
    } else {
      if (dupeContainer) dupeContainer.style.display = "";
      const dupePaged = paginateRows(sortedDupes, "synthetic_reviewDupes");
      let lastPid = null;
      let pairIdx = 0;
      const pairColors = ["rgba(13,110,253,0.04)", "rgba(13,110,253,0.09)"];
      const dupeBody = dupePaged.map((r) => {
        let bg = "";
        if (r.pid) {
          if (r.pid !== lastPid) {
            lastPid = r.pid;
            pairIdx++;
          }
          bg = pairColors[pairIdx % 2];
        }
        return synthetic_reviewDupeRowHtml(r, bg);
      }).join("");
      dupeTbl.innerHTML = `<thead><tr>
                <th>Owner</th><th>Pair ID</th><th>Category</th><th>Country</th><th>Company</th>
                <th>Vendor Name</th><th>Vendor No</th><th>Invoice No</th><th>Invoice Date</th><th>Closed Date</th>
                <th style="text-align:right">Amount</th><th>Currency</th><th>Doc Type</th><th>Classification</th>
                <th>Team</th><th>Recovery</th><th>Age</th>
            </tr></thead><tbody>${dupeBody}</tbody>`;
      renderPagination("synthetic_reviewDupes", "synthetic_reviewDupesPagination");
    }
  }
  const errTbl = document.getElementById("synthetic_reviewErrorsTable");
  const errContainer = document.getElementById("synthetic_reviewErrorsContainer");
  if (errTbl) {
    if (errors.length === 0) {
      if (errContainer) errContainer.style.display = "none";
    } else {
      if (errContainer) errContainer.style.display = "";
      const errPaged = paginateRows(errors, "synthetic_reviewErrors");
      const errBody = errPaged.map((r) => synthetic_reviewErrorRowHtml(r)).join("");
      errTbl.innerHTML = `<thead><tr>
                <th>Owner</th><th>Category</th><th>Country</th><th>Company</th>
                <th>Vendor Name</th><th>Vendor No</th><th>Invoice No</th><th>Invoice Date</th><th>Closed Date</th>
                <th style="text-align:right">Amount</th><th>Currency</th><th>Doc Type</th><th>Classification</th>
                <th>Team</th><th>Recovery</th><th>Age</th>
            </tr></thead><tbody>${errBody}</tbody>`;
      renderPagination("synthetic_reviewErrors", "synthetic_reviewErrorsPagination");
    }
  }
}
function exportSyntheticReviewTableCSV(type) {
  if (!synthetic_reviewData || !synthetic_reviewData.rows) return;
  const filtered = applySyntheticReviewFilters(synthetic_reviewData.rows);
  const isDupes = type === "dupes";
  const rows = filtered.filter((r) => isDupes ? r.st === "Duplicate Invoice" : r.st === "Invoice Error");
  const dupeHeaders = ["Snapshot Date", "Owner", "Pair ID", "Category", "Country", "Division", "Company Code", "Vendor Name", "Vendor No", "Invoice No", "Internal Ref", "Invoice Date", "Posted Date", "Identified Date", "Closed Date", "Amount", "Amount Base", "Currency", "Doc Type", "Classification", "Reason", "Team", "Recovery Status", "Assigned User", "Risk", "Value Flag", "Age", "Deleted", "Has Attachment", "Comments", "Unique Ref", "System"];
  const errHeaders = ["Snapshot Date", "Owner", "Category", "Country", "Division", "Company Code", "Vendor Name", "Vendor No", "Invoice No", "Internal Ref", "Invoice Date", "Posted Date", "Identified Date", "Closed Date", "Amount", "Amount Base", "Currency", "Doc Type", "Error Type", "Classification", "Reason", "Team", "Recovery Status", "Assigned User", "Risk", "Age", "Deleted", "Has Attachment", "Comments", "Unique Ref", "System"];
  const headers = isDupes ? dupeHeaders : errHeaders;
  function getVal(r, h) {
    const m = {
      "Snapshot Date": r.sd || "",
      "Owner": r.o || "",
      "Pair ID": r.pid || "",
      "Category": r.cat || "",
      "Country": synthetic_reviewCleanCountry(r.reg),
      "Division": r["div"] || "",
      "Company Code": r.dr || "",
      "Vendor Name": r.vname || "",
      "Vendor No": r.vn || "",
      "Invoice No": r.ino || "",
      "Internal Ref": r.iref || "",
      "Invoice Date": r.id || "",
      "Posted Date": r.pd || "",
      "Identified Date": r.idd || "",
      "Closed Date": r.cd || "",
      "Amount": r.amt || "",
      "Amount Base": r.amtb || "",
      "Currency": r.cur || "",
      "Doc Type": r.dt || "",
      "Error Type": r.et || "",
      "Classification": r.cls || "",
      "Reason": r.rsn || "",
      "Team": r.tm || "",
      "Recovery Status": r.rs || "",
      "Assigned User": r.au || "",
      "Risk": r.rk || "",
      "Value Flag": r.vf || "",
      "Age": r.age || "",
      "Deleted": r["del"] || "",
      "Has Attachment": r.att || "",
      "Comments": r.cmt || "",
      "Unique Ref": r.ur || "",
      "System": r.sys || ""
    };
    return m[h] ?? "";
  }
  let csv = headers.map((h) => '"' + h + '"').join(",") + "\n";
  rows.forEach((r) => {
    csv += headers.map((h) => '"' + String(getVal(r, h)).replace(/"/g, '""') + '"').join(",") + "\n";
  });
  const dfrom = document.getElementById("synthetic_reviewDateFrom")?.value || "";
  const dto = document.getElementById("synthetic_reviewDateTo")?.value || "";
  const dateSuffix = dfrom && dto ? `${dfrom}_to_${dto}` : dfrom || dto || "all";
  const prefix = isDupes ? "synthetic_review_duplicates" : "synthetic_review_errors";
  downloadCSV(csv, `${prefix}_${dateSuffix}.csv`);
}
function changeSyntheticReviewTableSize(key, n) {
  tableLimits[key] = n;
  pageState[key] = 1;
  if (synthetic_reviewData && synthetic_reviewData.rows) {
    const filtered = applySyntheticReviewFilters(synthetic_reviewData.rows);
    renderSyntheticReviewTable(filtered);
  }
}
function resetSyntheticReviewFilters() {
  const fromEl = document.getElementById("synthetic_reviewDateFrom");
  const toEl = document.getElementById("synthetic_reviewDateTo");
  if (fromEl) fromEl.value = "";
  if (toEl) toEl.value = "";
  ["xms_source", "xms_risk", "xms_recovery", "xms_team", "xms_owner", "xms_country", "xms_cc", "xms_cat"].forEach((id) => xmsReset(id));
  pageState.synthetic_review = 1;
  pageState.synthetic_reviewDupes = 1;
  pageState.synthetic_reviewErrors = 1;
  updateSyntheticReview();
}
function renderSyntheticReviewWeeklyTrendChart() {
  const canvas = document.getElementById("synthetic_reviewWeeklyTrendChart");
  if (!canvas) return;
  if (synthetic_reviewCharts["weeklyTrend"]) {
    synthetic_reviewCharts["weeklyTrend"].destroy();
    delete synthetic_reviewCharts["weeklyTrend"];
  }
  const trend = synthetic_reviewData?.synthetic_review_weekly_trend || [];
  if (!trend.length) return;
  const slice = trend.slice(-12);
  const labels = slice.map((e) => formatDate(e.week));
  const mkDataset = (label, data, color) => ({
    label,
    data,
    borderColor: color,
    backgroundColor: color + "20",
    fill: false,
    tension: 0.3,
    pointRadius: 3,
    pointHoverRadius: 5,
    pointBackgroundColor: color,
    borderWidth: 2
  });
  const datasets = [
    mkDataset("Invoices", slice.map((e) => e.invoices), "#0ea5e9"),
    mkDataset("Errors", slice.map((e) => e.errors), "#DC3545"),
    mkDataset("Duplicates", slice.map((e) => e.duplicates), "#1e40af")
  ];
  synthetic_reviewCharts["weeklyTrend"] = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, position: "bottom" },
        datalabels: { display: false },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            label: (ctx) => (ctx.dataset.label || "") + ": " + ctx.parsed.y.toLocaleString()
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 9, weight: "600" }, color: tickColor(), maxRotation: 45 }
        },
        y: {
          grid: { color: gridColor() },
          ticks: {
            callback: (v) => v.toLocaleString(),
            font: { size: 9 },
            color: tickColor()
          },
          beginAtZero: true
        }
      }
    }
  });
}
