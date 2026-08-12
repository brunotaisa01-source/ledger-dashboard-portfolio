"use strict";
function parseActionDate(ad) {
  if (!ad || ad.trim() === "") return null;
  ad = ad.trim();
  if (ad.match(/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/)) {
    const parts = ad.split(/[-\/]/);
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  }
  if (ad.match(/^\d{4}-\d{2}-\d{2}$/)) return /* @__PURE__ */ new Date(ad + "T00:00:00");
  return new Date(ad);
}
function getWeekRange(weekISO) {
  const start = /* @__PURE__ */ new Date(weekISO + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
function isInWeek(actionDate, weekRange) {
  const d = parseActionDate(actionDate);
  if (!d || isNaN(d.getTime())) return false;
  return d >= weekRange.start && d <= weekRange.end;
}
function getProdDateRange() {
  if (prodDateFrom && prodDateTo) {
    return {
      start: /* @__PURE__ */ new Date(prodDateFrom + "T00:00:00"),
      end: /* @__PURE__ */ new Date(prodDateTo + "T23:59:59.999")
    };
  }
  return getWeekRange(currentWeek);
}
function clearProdDates() {
  prodDateFrom = "";
  prodDateTo = "";
  document.getElementById("prodDateFrom").value = "";
  document.getElementById("prodDateTo").value = "";
  update();
}
function updateProductivity(filtered, raw, prevRaw) {
  try {
    const weekRange = getProdDateRange();
    const data = filterDocsByBucket(detailRows(filtered), globalBucketFilter);
    let backlogDocs = 0;
    for (const row of data) {
      if (!matchesTeamView(row, prodTeamFilter || void 0)) continue;
      const hasAg = hasAging(row);
      if (hasAg) backlogDocs++;
    }
    const ownerMap = {};
    const workedMap = {};
    const workedDocRows = [];
    const passesWorkedCategory = (row) => {
      if (workedCategoryFilter !== "NOT_OVERDUE" && workedCategoryFilter !== "OVERDUE") return true;
      const isOverdueByAging = hasAging(row);
      return workedCategoryFilter === "NOT_OVERDUE" ? !isOverdueByAging : isOverdueByAging;
    };
    for (const row of data) {
      if (!matchesTeamView(row, prodTeamFilter || void 0)) continue;
      const owner = row.o;
      if (!owner) continue;
      if (!ownerMap[owner]) {
        ownerMap[owner] = {
          owner,
          portfolio_vendors: /* @__PURE__ */ new Set(),
          portfolio_amount: 0,
          portfolio_docs: 0,
          work_vendors: /* @__PURE__ */ new Set(),
          work_amount: 0,
          work_docs: 0
        };
      }
      const om = ownerMap[owner];
      if (row.s) om.portfolio_vendors.add(vendorKey(row));
      om.portfolio_amount += row.a || 0;
      om.portfolio_docs++;
      const isWorked = isInWeek(row.ad || "", weekRange);
      if (isWorked) {
        if (passesWorkedCategory(row)) {
          if (row.s) om.work_vendors.add(vendorKey(row));
          om.work_amount += row.a || 0;
          om.work_docs++;
          workedDocRows.push(row);
          const vk = vendorKey(row);
          if (!workedMap[vk]) {
            workedMap[vk] = {
              supplier: row.s || "",
              name: row.sn || "",
              owner: row.o || "",
              cc: row.cc || "",
              co: row.co || "",
              vc: row.vc || "",
              docs: 0,
              amount: 0,
              comments: /* @__PURE__ */ new Set()
            };
          }
          workedMap[vk].docs++;
          workedMap[vk].amount += row.a || 0;
          if (row.cm && row.cm.trim()) workedMap[vk].comments.add(row.cm.trim());
        }
      }
    }
    const prod = Object.values(ownerMap).map((o) => ({
      owner: o.owner,
      portfolio_vendors: o.portfolio_vendors.size,
      portfolio_amount: o.portfolio_amount,
      portfolio_docs: o.portfolio_docs,
      work_vendors: o.work_vendors.size,
      work_amount: o.work_amount,
      work_docs: o.work_docs,
      work_rate: o.portfolio_vendors.size > 0 ? (o.work_vendors.size / o.portfolio_vendors.size * 100).toFixed(1) : "0.0"
    })).sort((a, b) => b.work_vendors - a.work_vendors);
    const pw = getPrevWeek();
    const prevFilteredProd = prevRaw.length ? filterDocsByBucket(detailRows(applyFilters(prevRaw)), globalBucketFilter) : [];
    const prevWeekRange = pw ? getWeekRange(pw) : null;
    const prevProd = prevFilteredProd.length && prevWeekRange ? (() => {
      const pom = {};
      for (const row of prevFilteredProd) {
        if (!matchesTeamView(row, prodTeamFilter || void 0)) continue;
        const owner = row.o;
        if (!owner) continue;
        if (!pom[owner]) pom[owner] = { portfolio_vendors: /* @__PURE__ */ new Set(), work_vendors: /* @__PURE__ */ new Set(), work_docs: 0, work_amount: 0 };
        if (row.s) pom[owner].portfolio_vendors.add(vendorKey(row));
        if (isInWeek(row.ad || "", prevWeekRange) && passesWorkedCategory(row)) {
          if (row.s) pom[owner].work_vendors.add(vendorKey(row));
          pom[owner].work_docs++;
          pom[owner].work_amount += row.a || 0;
        }
      }
      return Object.values(pom);
    })() : null;
    const totalWorkVendors = prod.reduce((s, p) => s + p.work_vendors, 0);
    const totalWorkDocs = prod.reduce((s, p) => s + p.work_docs, 0);
    const totalWorkAmount = prod.reduce((s, p) => s + p.work_amount, 0);
    const totalPortfolioVendors = prod.reduce((s, p) => s + p.portfolio_vendors, 0);
    const overallWorkRate = totalPortfolioVendors > 0 ? totalWorkVendors / totalPortfolioVendors * 100 : 0;
    const activeOwners = prod.filter((p) => p.work_docs > 0).length;
    const prevWorkVendors = prevProd ? prevProd.reduce((s, p) => s + p.work_vendors.size, 0) : null;
    const prevWorkDocs = prevProd ? prevProd.reduce((s, p) => s + p.work_docs, 0) : null;
    const prevWorkAmount = prevProd ? prevProd.reduce((s, p) => s + p.work_amount, 0) : null;
    const prevActive = prevProd ? prevProd.filter((p) => p.work_docs > 0).length : null;
    let prevBacklogDocs = null;
    if (prevFilteredProd.length) {
      prevBacklogDocs = 0;
      for (const row of prevFilteredProd) {
        if (!matchesTeamView(row, prodTeamFilter || void 0)) continue;
        const hasAg = hasAging(row);
        if (hasAg) prevBacklogDocs++;
      }
    }
    const estWeeks = totalWorkDocs > 0 ? backlogDocs / totalWorkDocs : Infinity;
    const estWeeksLabel = estWeeks === Infinity ? "" : estWeeks.toFixed(1);
    const burnColor = estWeeks !== Infinity && estWeeks < 2 ? "#28A745" : estWeeks <= 4 ? "#FFC107" : "#DC3545";
    const prevEstWeeks = prevBacklogDocs !== null && prevWorkDocs !== null && prevWorkDocs > 0 ? prevBacklogDocs / prevWorkDocs : null;
    const burnDelta = (() => {
      if (prevEstWeeks === null || prevEstWeeks === Infinity || estWeeks === Infinity)
        return '<span class="kpi-delta neutral"> vs LW</span>';
      const diff = estWeeks - prevEstWeeks;
      const absDiff = Math.abs(diff);
      if (absDiff < 0.05) return '<span class="kpi-delta neutral"><i class="fa-solid fa-minus"></i> No change</span>';
      const isGood = diff < 0;
      const arrow = diff > 0 ? "fa-arrow-up" : "fa-arrow-down";
      const cls = isGood ? "down" : "up";
      return `<span class="kpi-delta ${cls}"><i class="fa-solid ${arrow}"></i> ${absDiff.toFixed(1)}w vs LW</span>`;
    })();
    const isValueMode = viewModeFilter === "VALUE";
    const isTx = viewModeFilter === "TRANSACTIONS";
    const dateLabel = prodDateFrom && prodDateTo ? "(" + prodDateFrom.split("-").reverse().join("/") + " - " + prodDateTo.split("-").reverse().join("/") + ")" : "(This Week)";
    document.getElementById("prod-kpis").innerHTML = `
        <div class="kpi-card" style="border-left-color: var(--accent); color: var(--accent)">
            <div class="kpi-label"><i class="fa-solid fa-${isValueMode ? "coins" : isTx ? "file-lines" : "users-gear"}"></i> ${isValueMode ? "Work Amount" : isTx ? "Docs Worked" : "Vendors Worked"} ${dateLabel}</div>
            <div class="kpi-value">${isValueMode ? fmt(totalWorkAmount) : isTx ? totalWorkDocs.toLocaleString() : totalWorkVendors}</div>
            ${deltaHtml(isValueMode ? Math.abs(totalWorkAmount) : isTx ? totalWorkDocs : totalWorkVendors, isValueMode ? prevWorkAmount !== null ? Math.abs(prevWorkAmount) : null : isTx ? prevWorkDocs : prevWorkVendors, false)}
        </div>
        <div class="kpi-card" style="border-left-color: var(--primary); color: var(--primary)">
            <div class="kpi-label"><i class="fa-solid fa-${isTx ? "coins" : "file-circle-check"}"></i> ${isTx ? "Amount Worked" : "Docs Touched"} ${dateLabel}</div>
            <div class="kpi-value">${isTx ? fmt(totalWorkAmount) : totalWorkDocs.toLocaleString()}</div>
            ${deltaHtml(isTx ? Math.abs(totalWorkAmount) : totalWorkDocs, isTx ? prevWorkAmount !== null ? Math.abs(prevWorkAmount) : null : prevWorkDocs, false)}
        </div>
        <div class="kpi-card" style="border-left-color: var(--orange); color: var(--orange)">
            <div class="kpi-label"><i class="fa-solid fa-gauge-high"></i> Work Rate</div>
            <div class="kpi-value">${overallWorkRate.toFixed(1)}%</div>
            ${deltaHtml(overallWorkRate, prevProd ? prevProd.reduce((s, p) => s + p.work_vendors.size, 0) / Math.max(1, prevProd.reduce((s, p) => s + p.portfolio_vendors.size, 0)) * 100 : null, false)}
        </div>
        <div class="kpi-card" style="border-left-color: #6F42C1; color: #6F42C1">
            <div class="kpi-label"><i class="fa-solid fa-user-tie"></i> Active Owners</div>
            <div class="kpi-value">${activeOwners}</div>
            ${deltaHtml(activeOwners, prevActive, false)}
        </div>
        <div class="kpi-card" style="border-left-color: ${burnColor}; color: ${burnColor}">
            <div class="kpi-label"><i class="fa-solid fa-hourglass-half"></i> Backlog Estimate</div>
            <div class="kpi-value">${estWeeksLabel === "" ? "" : "~" + estWeeksLabel + "w"}</div>
            <div style="font-size:0.68rem;color:var(--text-muted);margin-top:2px">${backlogDocs.toLocaleString()} overdue / ${totalWorkDocs.toLocaleString()} worked pw</div>
            ${burnDelta}
        </div>
    `;
    const prodTitle = document.getElementById("prodChartTitle");
    if (prodTitle) {
      if (prodDateFrom && prodDateTo) {
        const fmtProdDate = (d) => d.split("-").reverse().join("/");
        prodTitle.innerHTML = '<i class="fa-solid fa-users"></i> Work by Owner (' + fmtProdDate(prodDateFrom) + " - " + fmtProdDate(prodDateTo) + ")";
      } else {
        prodTitle.innerHTML = '<i class="fa-solid fa-users"></i> Work by Owner (This Week)';
      }
    }
    const chartData = prod.filter((p) => p.work_vendors > 0).slice(0, 15);
    if (charts.prodWork) charts.prodWork.destroy();
    charts.prodWork = new Chart(document.getElementById("prodWorkChart"), {
      type: "bar",
      data: {
        labels: chartData.map((p) => p.owner),
        datasets: [
          { label: "Vendors", data: chartData.map((p) => p.work_vendors), backgroundColor: "#028090", borderRadius: 4 },
          { label: "Docs", data: chartData.map((p) => p.work_docs), backgroundColor: "#02C39A", borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        indexAxis: "y",
        onClick: (e, els) => {
          if (els.length) filterByOwner(chartData[els[0].index].owner);
        },
        plugins: { legend: { position: "bottom" }, datalabels: { display: true, anchor: "end", align: "end", color: () => dlColor(), font: { weight: "bold", size: 10 }, formatter: (v) => v > 0 ? v : "" }, tooltip: { callbacks: { afterLabel: () => "Click to filter" } } },
        scales: { x: { display: false }, y: { grid: { display: false } } }
      }
    });
    if (charts.prodPie) charts.prodPie.destroy();
    const workedV = totalWorkVendors, notWorkedV = Math.max(0, totalPortfolioVendors - totalWorkVendors);
    charts.prodPie = new Chart(document.getElementById("prodPieChart"), {
      type: "doughnut",
      data: { labels: ["Worked This Week", "Not Worked"], datasets: [{ data: [workedV, notWorkedV], backgroundColor: ["#028090", "#E9ECEF"] }] },
      options: { responsive: true, plugins: { datalabels: { formatter: (v, ctx) => {
        const t = ctx.dataset.data.reduce((a, b) => a + b, 0);
        return t > 0 ? (v / t * 100).toFixed(0) + "%" : "";
      }, color: (ctx) => ctx.dataIndex === 0 ? "#fff" : "#666", font: { weight: "bold", size: 13 } }, legend: { position: "bottom" } } }
    });
    const allWorkRows = prod.filter((p) => p.work_docs > 0);
    const workRows = tableLimits.prod > 0 && tableLimits.prod < allWorkRows.length ? allWorkRows.slice(0, tableLimits.prod) : allWorkRows;
    document.getElementById("prodTable").innerHTML = workRows.length ? `
        <thead><tr><th>Owner</th><th>Vendors Worked</th><th>Docs Touched</th><th>Amount Worked</th><th>Portfolio Vendors</th><th>Work Rate</th></tr></thead>
        <tbody>${workRows.map((p) => {
      const rateColor = parseFloat(p.work_rate) >= 80 ? "var(--green)" : parseFloat(p.work_rate) >= 50 ? "var(--orange)" : "var(--red)";
      return `<tr>
                <td class="supplier-name clickable-owner" onclick="filterByOwner('${hesc(p.owner)}')">${hesc(p.owner)}</td>
                <td style="text-align:center; font-weight:700; font-family:'Space Mono',monospace">${p.work_vendors}</td>
                <td style="text-align:center; font-family:'Space Mono',monospace">${p.work_docs}</td>
                <td class="amount">${fmtFull(p.work_amount)}</td>
                <td style="text-align:center; color:var(--text-muted)">${p.portfolio_vendors}</td>
                <td style="text-align:center"><span style="display:inline-block; padding:3px 10px; border-radius:12px; font-weight:700; font-size:0.78rem; font-family:'Space Mono',monospace; background:${rateColor}22; color:${rateColor}">${p.work_rate}%</span></td>
            </tr>`;
    }).join("")}</tbody>
    ` : '<tr><td colspan="6" class="no-data">No work logged this week</td></tr>';
    if (isTx) {
      const sortedDocs = workedDocRows.sort((a, b) => Math.abs(b.a || 0) - Math.abs(a.a || 0));
      const wsSlice = paginateRows(sortedDocs, "workedSuppliers");
      document.getElementById("workedSuppliersTable").innerHTML = wsSlice.length ? `
            <thead><tr><th>Supplier #</th><th>Name</th><th>CC</th><th>Reference</th><th>Doc #</th><th>Doc Type</th><th>Amount</th><th>Owner</th><th>Category</th></tr></thead>
            <tbody>${wsSlice.map((d) => `<tr>
                <td>${hesc(d.s || "")}</td>
                <td class="supplier-name">${hesc(d.sn || "")}</td>
                <td>${hesc(d.cc || "")}</td>
                <td style="font-family:'Space Mono',monospace">${hesc(d.rn || "")}</td>
                <td style="font-family:'Space Mono',monospace">${hesc(d.dn || "")}</td>
                <td>${hesc(d.dt || "")}</td>
                <td class="amount">${fmtFull(d.a, d.cur)}</td>
                <td><strong class="clickable-owner" onclick="filterByOwner('${hesc(d.o)}')">${hesc(d.o || "-")}</strong></td>
                <td>${hesc(d.vc || "")}</td>
            </tr>`).join("")}</tbody>
        ` : '<tr><td colspan="9" class="no-data">No worked documents this week</td></tr>';
    } else {
      const bucketActive = globalBucketFilter.size > 0;
      const balOf = (s) => bucketActive ? sumBucketValues(s, globalBucketFilter, s.TotalAmount) : s.TotalAmount;
      const currAgg = aggregateSuppliers(filtered, prodTeamFilter || void 0);
      const currBalMap = {};
      currAgg.forEach((s) => {
        currBalMap[s.Supplier + "|" + (s.CompanyCode || "")] = balOf(s);
      });
      const prevAgg = prevRaw.length ? aggregateSuppliers(applyFilters(prevRaw), prodTeamFilter || void 0) : [];
      const prevBalMap = {};
      prevAgg.forEach((s) => {
        prevBalMap[s.Supplier + "|" + (s.CompanyCode || "")] = balOf(s);
      });
      const workedSuppliers = Object.entries(workedMap).map(([vk, s]) => {
        const currBal = currBalMap[vk] || 0;
        const prevBal = prevBalMap[vk] || 0;
        return { ...s, currBal, prevBal, change: currBal - prevBal };
      }).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
      const wsSlice = paginateRows(workedSuppliers, "workedSuppliers");
      document.getElementById("workedSuppliersTable").innerHTML = wsSlice.length ? `
            <thead><tr><th>Supplier #</th><th>Name</th><th>Owner</th><th>CC</th><th>Country</th><th>Category</th><th>Docs</th><th>Amount Worked</th><th>Change</th></tr></thead>
            <tbody>${wsSlice.map((s) => {
        const changeIcon = s.change > 0.5 ? '<i class="fa-solid fa-arrow-trend-up"></i>' : s.change < -0.5 ? '<i class="fa-solid fa-arrow-trend-down"></i>' : "";
        const changeCls = s.change > 0.5 ? "change-worse" : s.change < -0.5 ? "change-better" : "";
        return `<tr>
                    <td>${hesc(s.supplier)}</td>
                    <td class="supplier-name">${hesc(s.name)}</td>
                    <td>${hesc(s.owner)}</td>
                    <td>${hesc(s.cc)}</td>
                    <td>${hesc(s.co)}</td>
                    <td>${hesc(s.vc)}</td>
                    <td style="text-align:center;font-family:'Space Mono',monospace">${s.docs}</td>
                    <td class="amount">${fmtFull(s.amount)}</td>
                    <td class="${changeCls}" style="text-align:center;font-weight:700">${changeIcon} ${fmtFull(Math.abs(s.change))}</td>
                </tr>`;
      }).join("")}</tbody>
        ` : '<tr><td colspan="9" class="no-data">No worked suppliers this week</td></tr>';
    }
    renderPagination("workedSuppliers", "workedSuppliersPagination");
    renderProductivityTrend();
    renderProductivityScorecard();
    renderResolutionQuality();
  } catch (e) {
    console.error("updateProductivity error:", e);
  }
}
function prodNum(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function prodPct(num, den) {
  return den > 0 ? (num / den * 100).toFixed(1) + "%" : "0.0%";
}
let _productivityTrendCache = null;
async function _getProdTrend() {
  if (_productivityTrendCache !== null) return _productivityTrendCache;
  const b64 = await _loadCompressedDashboardChunk(
    "productivity_trend.js",
    "_PRODUCTIVITY_TREND_COMPRESSED",
    "productivity_trend_compressed"
  );
  if (!b64) {
    _productivityTrendCache = [];
    return [];
  }
  try {
    const parsed = await decompressBlob(b64);
    _productivityTrendCache = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("renderProductivityTrend: decompress failed", e);
    _productivityTrendCache = [];
  }
  return _productivityTrendCache;
}
async function renderProductivityTrend() {
  const canvas = document.getElementById("productivityWeeklyTrend");
  if (!canvas) return;
  const trend = await _getProdTrend();
  if (charts["productivityWeeklyTrend"]) {
    charts["productivityWeeklyTrend"].destroy();
    delete charts["productivityWeeklyTrend"];
  }
  if (!trend.length) return;
  const allWeeks = Array.from(new Set(trend.map((e) => e.week))).sort();
  let ownersToShow;
  if (ownerFilter.size === 1) {
    ownersToShow = Array.from(ownerFilter);
  } else {
    const totals = {};
    for (const e of trend) totals[e.owner] = (totals[e.owner] || 0) + e.actioned;
    ownersToShow = Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([o]) => o);
  }
  const lookup = {};
  for (const e of trend) {
    if (!lookup[e.owner]) lookup[e.owner] = {};
    lookup[e.owner][e.week] = e.actioned;
  }
  const PALETTE = [
    "#028090",
    "#1E2761",
    "#02C39A",
    "#F28B30",
    "#6F42C1",
    "#E63946",
    "#457B9D",
    "#2D6A4F",
    "#E9C46A",
    "#264653",
    "#F4A261",
    "#A8DADC",
    "#9B2226",
    "#606C38",
    "#BC6C25",
    "#8338EC",
    "#FF006E"
  ];
  const datasets = ownersToShow.map((owner, i) => {
    const color = PALETTE[i % PALETTE.length];
    return {
      label: owner,
      data: allWeeks.map((w) => lookup[owner]?.[w] ?? null),
      borderColor: color,
      backgroundColor: color + "20",
      fill: false,
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 5,
      pointBackgroundColor: color,
      borderWidth: 2
    };
  });
  const weekLabels = allWeeks.map((w) => formatDate(w));
  charts["productivityWeeklyTrend"] = new Chart(canvas, {
    type: "line",
    data: { labels: weekLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: ownersToShow.length > 1,
          position: "bottom",
          labels: { font: { size: 10 }, boxWidth: 12, padding: 8 }
        },
        datalabels: { display: false },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            label: (ctx) => ctx.parsed.y == null ? null : (ctx.dataset.label || "") + ": " + ctx.parsed.y.toLocaleString() + " docs"
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
let _productivityScorecardCache = null;
let _resolvedCarryoverCache = null;
let _resolvedFiltersReady = false;
let _resolvedFilterSignature = "";
async function _getProductivityScorecard() {
  if (_productivityScorecardCache !== null) return _productivityScorecardCache;
  const b64 = await _loadCompressedDashboardChunk(
    "productivity_scorecard.js",
    "_PRODUCTIVITY_SCORECARD_COMPRESSED",
    "productivity_scorecard_compressed"
  );
  if (!b64) {
    _productivityScorecardCache = [];
    return [];
  }
  try {
    const parsed = await decompressBlob(b64);
    _productivityScorecardCache = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("renderProductivityScorecard: decompress failed", e);
    _productivityScorecardCache = [];
  }
  return _productivityScorecardCache;
}
async function _getResolvedCarryover() {
  if (_resolvedCarryoverCache !== null) return _resolvedCarryoverCache;
  const b64 = await _loadCompressedDashboardChunk(
    "resolved_carryover.js",
    "_RESOLVED_CARRYOVER_COMPRESSED",
    "resolved_carryover_compressed"
  );
  if (!b64) {
    _resolvedCarryoverCache = { rows: [], trend: [], summary: {} };
    return _resolvedCarryoverCache;
  }
  try {
    const parsed = await decompressBlob(b64);
    _resolvedCarryoverCache = parsed && typeof parsed === "object" ? parsed : { rows: [], trend: [], summary: {} };
  } catch (e) {
    console.warn("renderResolutionQuality: decompress failed", e);
    _resolvedCarryoverCache = { rows: [], trend: [], summary: {} };
  }
  return _resolvedCarryoverCache;
}
async function renderProductivityScorecard() {
  const table = document.getElementById("productivityScorecardTable");
  const kpis = document.getElementById("productivityScorecardKpis");
  if (!table && !kpis) return;
  const allRows = await _getProductivityScorecard();
  const rows = allRows.filter((r) => !currentWeek || r.week === currentWeek).filter((r) => !prodTeamFilter || r.source === prodTeamFilter).filter((r) => ownerFilter.size === 0 || ownerFilter.has(r.owner)).sort((a, b) => prodNum(b.aged_items_cleared) - prodNum(a.aged_items_cleared) || prodNum(b.comments_updated) - prodNum(a.comments_updated));
  pageData["productivityScorecard"] = rows;
  const resolved = rows.reduce((s, r) => s + prodNum(r.aged_items_cleared), 0);
  const valueCleared = rows.reduce((s, r) => s + prodNum(r.value_cleared), 0);
  const reviews = rows.reduce((s, r) => s + prodNum(r.vendor_reviews_completed), 0);
  const comments = rows.reduce((s, r) => s + prodNum(r.comments_updated), 0);
  const blockers = rows.reduce((s, r) => s + prodNum(r.blockers_raised) + prodNum(r.rag_blocker), 0);
  const ragTotal = rows.reduce((s, r) => s + prodNum(r.rag_total), 0);
  const ragGreen = rows.reduce((s, r) => s + prodNum(r.rag_green), 0);
  if (kpis) {
    kpis.innerHTML = `
        <div class="kpi-card"><div class="kpi-label">Action-date Resolved</div><div class="kpi-value">${resolved.toLocaleString()}</div></div>
        <div class="kpi-card"><div class="kpi-label">Resolved Value</div><div class="kpi-value">${fmtFull(valueCleared)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Vendor Reviews</div><div class="kpi-value">${reviews.toLocaleString()}</div></div>
        <div class="kpi-card"><div class="kpi-label">Comments Updated</div><div class="kpi-value">${comments.toLocaleString()}</div></div>
        <div class="kpi-card"><div class="kpi-label">Green RAG</div><div class="kpi-value">${prodPct(ragGreen, ragTotal)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Blockers</div><div class="kpi-value">${blockers.toLocaleString()}</div></div>`;
  }
  if (table) {
    table.innerHTML = rows.length ? `
        <thead><tr><th>Owner</th><th>Week</th><th>Source</th><th>Resolved</th><th>Value</th><th>Reviews</th><th>Comments</th><th>Blockers</th><th>Green</th><th>Amber</th><th>Red</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
            <td class="supplier-name clickable-owner" onclick="filterByOwner('${hesc(r.owner)}')">${hesc(r.owner)}</td>
            <td>${formatDate(r.week)}</td><td>${hesc(r.source)}</td>
            <td style="text-align:center;font-family:'Space Mono',monospace">${prodNum(r.aged_items_cleared).toLocaleString()}</td>
            <td class="amount">${fmtFull(prodNum(r.value_cleared))}</td>
            <td style="text-align:center">${prodNum(r.vendor_reviews_completed).toLocaleString()}</td>
            <td style="text-align:center">${prodNum(r.comments_updated).toLocaleString()}</td>
            <td style="text-align:center">${(prodNum(r.blockers_raised) + prodNum(r.rag_blocker)).toLocaleString()}</td>
            <td style="text-align:center;color:var(--green)">${prodNum(r.rag_green).toLocaleString()}</td>
            <td style="text-align:center;color:var(--orange)">${prodNum(r.rag_amber).toLocaleString()}</td>
            <td style="text-align:center;color:var(--red)">${prodNum(r.rag_red).toLocaleString()}</td>
        </tr>`).join("")}</tbody>` : '<tr><td colspan="11" class="no-data">No productivity scorecard data for this selection</td></tr>';
  }
}
function _resolvedPairKey(row) {
  return `${row.rw}|${row.pw}`;
}
function _resolvedPairLabel(key) {
  const [rw, pw] = key.split("|");
  return `${formatDate(rw)} -> ${formatDate(pw)}`;
}
function _resolvedSourceMatches(source, row) {
  if (source === "all") return true;
  const values = [row.src, row.team, row.psrc, row.pteam].map((v) => (v || "").trim().toLowerCase()).filter(Boolean);
  if (source === "key") return values.includes("key");
  return values.includes("rol") || values.includes("ledger");
}
function _resolvedPairsFromSortedWeeks() {
  const weeks = Array.isArray(SORTED_WEEKS) ? SORTED_WEEKS.filter(Boolean) : [];
  const pairs = [];
  for (let i = 0; i < weeks.length - 1; i++) {
    pairs.push(`${weeks[i + 1]}|${weeks[i]}`);
  }
  return pairs;
}
function populateResolvedCarryoverFilters(payload) {
  const rows = payload.rows || [];
  const pairSelect = document.getElementById("resolvedCarryoverPair");
  if (pairSelect && !_resolvedFiltersReady) {
    const pairsByWeek = _resolvedPairsFromSortedWeeks();
    const rowPairs = Array.from(new Set(rows.map(_resolvedPairKey))).sort().reverse();
    const pairSet = new Set(pairsByWeek.length ? pairsByWeek : rowPairs);
    for (const pair of rowPairs) pairSet.add(pair);
    const pairs = Array.from(pairSet);
    const selected = pairSelect.value;
    pairSelect.innerHTML = pairs.map((p) => `<option value="${hesc(p)}">${hesc(_resolvedPairLabel(p))}</option>`).join("");
    if (pairs.length) pairSelect.value = selected && pairs.includes(selected) ? selected : pairs[0];
    pairSelect.onchange = () => {
      pageState.resolvedCarryover = 1;
      renderResolutionQuality();
    };
  }
  const ownerSelect = document.getElementById("resolvedCarryoverOwner");
  if (ownerSelect && !_resolvedFiltersReady) {
    const owners = Array.from(new Set(rows.map((r) => r.o).filter(Boolean))).sort();
    ownerSelect.innerHTML = '<option value="all" selected>All owners</option>' + owners.map((o) => `<option value="${hesc(o)}">${hesc(o)}</option>`).join("");
  }
  _resolvedFiltersReady = true;
}
async function renderResolutionQuality() {
  const table = document.getElementById("resolvedCarryoverTable");
  const kpis = document.getElementById("resolvedCarryoverKpis");
  if (!table && !kpis) return;
  const payload = await _getResolvedCarryover();
  populateResolvedCarryoverFilters(payload);
  const pair = document.getElementById("resolvedCarryoverPair")?.value || "";
  const mode = document.getElementById("resolvedCarryoverMode")?.value || "all";
  const source = document.getElementById("resolvedCarryoverSource")?.value || "all";
  const owner = document.getElementById("resolvedCarryoverOwner")?.value || "all";
  const confidence = document.getElementById("resolvedCarryoverConfidence")?.value || "all";
  const filterSignature = [pair, mode, source, owner, confidence].join("|");
  if (_resolvedFilterSignature && _resolvedFilterSignature !== filterSignature) pageState.resolvedCarryover = 1;
  _resolvedFilterSignature = filterSignature;
  const rows = (payload.rows || []).filter((r) => !pair || _resolvedPairKey(r) === pair).filter((r) => mode !== "actioned" || prodNum(r.act) === 1).filter((r) => _resolvedSourceMatches(source, r)).filter((r) => owner === "all" || r.o === owner).filter((r) => confidence === "all" || (r.conf || "").toLowerCase() === confidence).sort((a, b) => Math.abs(prodNum(b.a)) - Math.abs(prodNum(a.a)));
  const actioned = rows.reduce((s, r) => s + prodNum(r.act), 0);
  const total = rows.length;
  const high = rows.filter((r) => (r.conf || "").toLowerCase() === "high").length;
  const totalValue = rows.reduce((s, r) => s + Math.abs(prodNum(r.a)), 0);
  pageData["resolvedCarryover"] = rows;
  if (kpis) {
    kpis.innerHTML = `
        <div class="kpi-card"><div class="kpi-label">Carryover Rows</div><div class="kpi-value">${total.toLocaleString()}</div></div>
        <div class="kpi-card"><div class="kpi-label">Actioned In Week</div><div class="kpi-value">${actioned.toLocaleString()}</div></div>
        <div class="kpi-card"><div class="kpi-label">Actioned Rate</div><div class="kpi-value">${prodPct(actioned, total)}</div></div>
        <div class="kpi-card"><div class="kpi-label">High Confidence</div><div class="kpi-value">${prodPct(high, total)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Carryover Value</div><div class="kpi-value">${fmtFull(totalValue)}</div></div>`;
  }
  const perPage = tableLimits.resolvedCarryover || 10;
  const maxPage = Math.max(1, Math.ceil(rows.length / perPage));
  if ((pageState.resolvedCarryover || 1) > maxPage) pageState.resolvedCarryover = maxPage;
  const slice = paginateRows(rows, "resolvedCarryover");
  if (table) {
    table.innerHTML = slice.length ? `
        <thead><tr><th>Resolved Week</th><th>Present Week</th><th>Owner</th><th>Source</th><th>Supplier</th><th>Name</th><th>Doc</th><th>Reference</th><th>Status</th><th>Action Date</th><th>Amount</th><th>Confidence</th></tr></thead>
        <tbody>${slice.map((r) => `<tr>
            <td>${formatDate(r.rw)}</td><td>${formatDate(r.pw)}</td><td>${hesc(r.o)}</td><td>${hesc(r.src)}</td>
            <td>${hesc(r.s || "")}</td><td class="supplier-name">${hesc(r.sn || "")}</td><td>${hesc(r.dn || "")}</td><td>${hesc(r.rn || "")}</td>
            <td>${hesc(r.st || "")}</td><td>${hesc(r.ad || "")}</td><td class="amount">${fmtFull(prodNum(r.a), r.cur)}</td><td>${hesc(r.conf || "")}</td>
        </tr>`).join("")}</tbody>` : '<tr><td colspan="12" class="no-data">No resolution quality data for this selection</td></tr>';
  }
  renderPagination("resolvedCarryover", "resolvedCarryoverPagination");
  renderResolutionQualityCharts(rows, payload.trend || [], { mode, source, owner, confidence });
}
function _filteredResolvedTrendRate(trendRow, filters) {
  const breakdown = Array.isArray(trendRow.bd) ? trendRow.bd : [];
  const rows = breakdown.filter(
    (b) => _resolvedSourceMatches(filters.source, b) && (filters.owner === "all" || b.o === filters.owner) && (filters.confidence === "all" || (b.conf || "").toLowerCase() === filters.confidence)
  );
  const numeratorKey = filters.mode === "actioned" ? "ac" : "sc";
  const denominatorKey = filters.mode === "actioned" ? "ar" : "sr";
  const numerator = rows.reduce((s, b) => s + prodNum(b[numeratorKey]), 0);
  const denominator = rows.reduce((s, b) => s + prodNum(b[denominatorKey]), 0);
  return denominator ? Math.round(numerator / denominator * 1e3) / 10 : 0;
}
function renderResolutionQualityCharts(rows, trend, filters) {
  const ownerCanvas = document.getElementById("resolvedCarryoverOwnerChart");
  if (ownerCanvas) {
    if (charts["resolvedCarryoverOwnerChart"]) charts["resolvedCarryoverOwnerChart"].destroy();
    const ownerCounts = {};
    rows.forEach((r) => {
      ownerCounts[r.o || "Unknown"] = (ownerCounts[r.o || "Unknown"] || 0) + 1;
    });
    const top = Object.entries(ownerCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
    charts["resolvedCarryoverOwnerChart"] = new Chart(ownerCanvas, {
      type: "bar",
      data: { labels: top.map(([o]) => o), datasets: [{ label: "Carryover rows", data: top.map(([, v]) => v), backgroundColor: "#F28B30", borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: tickColor() } }, y: { beginAtZero: true, grid: { color: gridColor() }, ticks: { color: tickColor() } } } }
    });
  }
  const trendCanvas = document.getElementById("resolvedCarryoverTrendChart");
  if (trendCanvas) {
    if (charts["resolvedCarryoverTrendChart"]) charts["resolvedCarryoverTrendChart"].destroy();
    charts["resolvedCarryoverTrendChart"] = new Chart(trendCanvas, {
      type: "line",
      data: {
        labels: trend.map((t) => formatDate(t.rw)),
        datasets: [{ label: "Failed resolution rate", data: trend.map((t) => _filteredResolvedTrendRate(t, filters)), borderColor: "#DC3545", backgroundColor: "#DC354520", tension: 0.25, fill: true }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: tickColor() } }, y: { beginAtZero: true, max: 100, grid: { color: gridColor() }, ticks: { color: tickColor(), callback: (v) => v + "%" } } } }
    });
  }
}
