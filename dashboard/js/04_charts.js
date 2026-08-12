"use strict";
function isDark() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}
function dlColor() {
  return isDark() ? "#e2e8f0" : "#1E2761";
}
function gridColor() {
  return isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
}
function tickColor() {
  return isDark() ? "#94a3b8" : "#666";
}
function applyChartDefaults() {
  const d = isDark();
  Chart.defaults.color = d ? "#94a3b8" : "#666";
  Chart.defaults.borderColor = d ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.1)";
  Chart.defaults.scale.grid.color = d ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
}
applyChartDefaults();
const dlConfigBar = { display: true, anchor: "end", align: "end", formatter: (v) => fmt(v), color: () => dlColor(), font: { weight: "bold", size: 10 } };
const dlConfigBarInside = { display: true, anchor: "center", align: "center", color: "#fff", font: { weight: "bold", size: 11 }, formatter: (v) => v > 0 ? v : "" };
const dlConfigPie = { display: true, formatter: (value, ctx) => {
  const total = ctx.dataset.data.reduce((a, b) => a + Math.abs(b), 0);
  return total > 0 ? (Math.abs(value) / total * 100).toFixed(0) + "%" : "";
}, color: "#fff", font: { weight: "bold", size: 11 } };
const dlConfigDoughnut = { display: true, anchor: "center", align: "center", formatter: (v) => Math.abs(v).toLocaleString(), color: "#fff", font: { weight: "bold", size: 10 } };
function _renderTrendChart(weekLabels, dataTotal, dataROL, dataKey, isValueMode, isTx) {
  const vLabel = isTx ? "Transactions" : "Suppliers";
  const trendLabel = document.getElementById("trendModeLabel");
  if (trendLabel) trendLabel.textContent = isValueMode ? "Balance" : isTx ? "Transaction" : "Volume";
  const trendCtx = document.getElementById("trendLineChart").getContext("2d");
  const gTotal = trendCtx.createLinearGradient(0, 0, 0, 350);
  gTotal.addColorStop(0, "rgba(2,128,144,0.3)");
  gTotal.addColorStop(1, "rgba(2,128,144,0.02)");
  const gROL = trendCtx.createLinearGradient(0, 0, 0, 350);
  gROL.addColorStop(0, "rgba(2,128,144,0.2)");
  gROL.addColorStop(1, "rgba(2,128,144,0.02)");
  const gKey = trendCtx.createLinearGradient(0, 0, 0, 350);
  gKey.addColorStop(0, "rgba(111,66,193,0.2)");
  gKey.addColorStop(1, "rgba(111,66,193,0.02)");
  if (charts.trendLine) charts.trendLine.destroy();
  charts.trendLine = new Chart(document.getElementById("trendLineChart"), {
    type: "line",
    data: {
      labels: weekLabels,
      datasets: [
        { label: isValueMode ? "Total AP Balance" : "Total " + vLabel, data: dataTotal, borderColor: "#028090", backgroundColor: gTotal, fill: true, tension: 0.35, pointRadius: 5, pointHoverRadius: 8, pointBackgroundColor: "#028090", pointBorderColor: "#fff", pointBorderWidth: 2, borderWidth: 3, order: 0 },
        { label: isValueMode ? "ROL Balance" : "ROL " + vLabel, data: dataROL, borderColor: "#028090", backgroundColor: gROL, fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: "#028090", pointBorderColor: "#fff", pointBorderWidth: 1.5, borderWidth: 2, order: 1 },
        { label: isValueMode ? "Key Balance" : "Key " + vLabel, data: dataKey, borderColor: "#6F42C1", backgroundColor: gKey, fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: "#6F42C1", pointBorderColor: "#fff", pointBorderWidth: 1.5, borderWidth: 2, order: 2 }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, padding: 15, font: { size: 11, weight: "600" }, usePointStyle: true, pointStyle: "circle" } },
        datalabels: { display: false },
        tooltip: { mode: "index", intersect: false, backgroundColor: "rgba(30,39,97,0.92)", titleFont: { weight: "700" }, bodyFont: { family: "'Space Mono', monospace", size: 12 }, padding: 12, cornerRadius: 8, callbacks: { label: (ctx) => " " + ctx.dataset.label + ": " + (isValueMode ? fmt(ctx.parsed.y) : ctx.parsed.y.toLocaleString()) } }
      },
      scales: {
        y: { grid: { color: gridColor(), drawBorder: false }, ticks: { callback: (v) => isValueMode ? fmt(v) : v.toLocaleString(), font: { size: 10 }, padding: 8 }, border: { display: false } },
        x: { grid: { display: false }, ticks: { font: { size: 10, weight: "500" }, maxRotation: 0 }, border: { display: false } }
      }
    }
  });
}
async function _updateTrendFromRaw() {
  const cube = YEAR_TREND_CUBE || await ensureTrendCube();
  if (!cube) return;
  const weeks = cube.weeks;
  const nw = weeks.length;
  const isValueMode = viewModeFilter === "VALUE";
  const isTx = viewModeFilter === "TRANSACTIONS";
  const trendTotal = new Array(nw).fill(0);
  const trendROL = new Array(nw).fill(0);
  const trendKey = new Array(nw).fill(0);
  const volTotal = new Array(nw).fill(0);
  const volROL = new Array(nw).fill(0);
  const volKey = new Array(nw).fill(0);
  const docTotal = new Array(nw).fill(0);
  const docROL = new Array(nw).fill(0);
  const docKey = new Array(nw).fill(0);
  const allWeekData = await Promise.all(weeks.slice(0, nw).map((w) => getWeekData(w)));
  const bucketActive = globalBucketFilter.size > 0;
  for (let i = 0; i < nw; i++) {
    const weekData = allWeekData[i];
    const raw = weekData.raw || [];
    const filtered = applyFilters(raw);
    const headers = headerRows(filtered);
    for (const h of headers) {
      const tv = bucketActive ? sumRowBuckets(h, globalBucketFilter, h.tv || 0) : h.tv || 0;
      const sv = 1;
      const sh = (h.sh || "").toUpperCase();
      trendTotal[i] += tv;
      volTotal[i] += sv;
      if (sh === "ROL") {
        trendROL[i] += tv;
        volROL[i] += sv;
      } else if (sh === "KEY") {
        trendKey[i] += tv;
        volKey[i] += sv;
      }
    }
    if (bucketActive) {
      const scopedDocs = filterDocsByBucket(detailRows(filtered), globalBucketFilter);
      for (const d of scopedDocs) {
        const sh = (d.sh || "").toUpperCase();
        docTotal[i] += 1;
        if (sh === "ROL") docROL[i] += 1;
        else if (sh === "KEY") docKey[i] += 1;
      }
    } else {
      for (const h of headers) {
        const dv = h.vv || 0;
        const sh = (h.sh || "").toUpperCase();
        docTotal[i] += dv;
        if (sh === "ROL") docROL[i] += dv;
        else if (sh === "KEY") docKey[i] += dv;
      }
    }
  }
  const dataTotal = isValueMode ? trendTotal : isTx ? docTotal : volTotal;
  const dataROL = isValueMode ? trendROL : isTx ? docROL : volROL;
  const dataKey = isValueMode ? trendKey : isTx ? docKey : volKey;
  const weekLabels = weeks.map((w) => formatDate(w));
  _renderTrendChart(weekLabels, dataTotal, dataROL, dataKey, isValueMode, isTx);
}
let _trendUpdateTimer = null;
let _trendUpdateToken = 0;
function scheduleTrendUpdate(delay = 80) {
  const token = ++_trendUpdateToken;
  if (_trendUpdateTimer) clearTimeout(_trendUpdateTimer);
  _trendUpdateTimer = setTimeout(() => {
    if (token !== _trendUpdateToken) return;
    updateTrendFromCube().catch((err) => console.error("Trend update failed:", err));
  }, delay);
}
async function updateTrendFromCube() {
  if (globalBucketFilter.size > 0 || supplierSearchFilter) {
    await _updateTrendFromRaw();
    return;
  }
  const cube = YEAR_TREND_CUBE || await ensureTrendCube();
  if (!cube) return;
  const combos = cube.combos;
  const weeks = cube.weeks;
  const nw = weeks.length;
  const isValueMode = viewModeFilter === "VALUE";
  const trendTotal = new Array(nw).fill(0);
  const trendROL = new Array(nw).fill(0);
  const trendKey = new Array(nw).fill(0);
  const volTotal = new Array(nw).fill(0);
  const volROL = new Array(nw).fill(0);
  const volKey = new Array(nw).fill(0);
  const docTotal = new Array(nw).fill(0);
  const docROL = new Array(nw).fill(0);
  const docKey = new Array(nw).fill(0);
  for (const c of combos) {
    if (countryFilter.size > 0 && !countryFilter.has(c.co)) continue;
    if (companyFilter.size > 0 && !companyFilter.has(c.cc)) continue;
    if (statusFilter.size > 0 && !statusFilter.has(c.st)) continue;
    if (queryTypeFilter.size > 0 && !queryTypeFilter.has(c.qt)) continue;
    if (ownerFilter.size > 0 && !ownerFilter.has(c.ow)) continue;
    if (balanceTypeFilter.size > 0 && !balanceTypeFilter.has(c.bal)) continue;
    if (vendorCategoryFilter.size > 0 && !vendorCategoryFilter.has(c.vc || "")) continue;
    if (paymentBlockFilter.size > 0 && !paymentBlockFilter.has(c.pb || "")) continue;
    if (paymentBlockFilter.size === 0 && (c.pb || "") !== "") continue;
    if (supplierSearchFilter) continue;
    if (docCategoryFilter.size === 0) {
      if (c.dc !== "") continue;
    } else {
      if (!docCategoryFilter.has(c.dc)) continue;
    }
    const tv = c.tv;
    const sv = c.sv;
    const dv = c.dv;
    const sh = c.sh.toUpperCase();
    for (let i = 0; i < nw; i++) {
      trendTotal[i] += tv[i];
      volTotal[i] += sv[i];
      docTotal[i] += dv[i];
      if (sh === "ROL") {
        trendROL[i] += tv[i];
        volROL[i] += sv[i];
        docROL[i] += dv[i];
      } else if (sh === "KEY") {
        trendKey[i] += tv[i];
        volKey[i] += sv[i];
        docKey[i] += dv[i];
      }
    }
  }
  const isTx = viewModeFilter === "TRANSACTIONS";
  const dataTotal = isValueMode ? trendTotal : isTx ? docTotal : volTotal;
  const dataROL = isValueMode ? trendROL : isTx ? docROL : volROL;
  const dataKey = isValueMode ? trendKey : isTx ? docKey : volKey;
  const weekLabels = weeks.map((w) => formatDate(w));
  _renderTrendChart(weekLabels, dataTotal, dataROL, dataKey, isValueMode, isTx);
}
