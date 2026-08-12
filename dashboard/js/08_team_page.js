"use strict";
async function updateTeamPage(teamId, filtered, raw, prevRaw) {
  try {
    const cfg = TEAM_CONFIG[teamId];
    if (!cfg) return;
    const tid = teamId.toLowerCase();
    const kpis = computeKPIs(filtered, teamId);
    const prevFiltered = prevRaw.length ? applyFilters(prevRaw) : [];
    const prevKpis = prevFiltered.length ? computeKPIs(prevFiltered, teamId) : null;
    const otpData = computeOTP(filtered, teamId);
    const prevOtp = prevFiltered.length ? computeOTP(prevFiltered, teamId) : null;
    const kpiContainer = document.getElementById(tid + "-kpis");
    if (kpiContainer) {
      kpiContainer.innerHTML = renderTeamKPIs(teamId, cfg, kpis, prevKpis, prevFiltered, otpData, prevOtp);
    }
    renderAgingChart(tid + "AgingChart", tid, cfg, kpis);
    renderPieChart(tid + "PieChart", tid, cfg, kpis);
    if (!document.getElementById(tid + "PieChart") && document.getElementById(tid + "OverduePie")) {
      renderPieChart(tid + "OverduePie", tid, cfg, kpis);
    }
    const ownerData = computeAgingByOwner(filtered, teamId);
    renderOwnerAgingChart(tid + "OwnerAgingChart", tid, cfg, ownerData);
    const isTx = viewModeFilter === "TRANSACTIONS";
    if (isTx) {
      renderDocTable(tid, cfg, filtered);
    } else {
      const suppliers = aggregateSuppliers(filtered, teamId);
      renderTeamTable(tid, cfg, suppliers, prevFiltered);
    }
    for (const extra of cfg.extras) {
      if (extra === "trendChart" && typeof renderROLTrend === "function") await renderROLTrend(tid, filtered, [tid.toUpperCase()]);
      if (extra === "rootCauseChart" && typeof renderRootCause === "function") renderRootCause(tid, filtered);
    }
  } catch (e) {
    console.error("updateTeamPage error:", e);
  }
}
function renderTeamKPIs(teamId, cfg, kpis, prevKpis, prevFiltered, otpData, prevOtp) {
  const isValueMode = viewModeFilter === "VALUE";
  const isTx = viewModeFilter === "TRANSACTIONS";
  const avgDays = avgDaysOverdue(kpis, teamId);
  const prevAvgDays = prevKpis ? avgDaysOverdue(prevKpis, teamId) : null;
  const kpi1Val = bucketKPIValue(kpis);
  const kpi1Prev = prevKpis ? bucketKPIValue(prevKpis) : null;
  const kpi1Fmt = bucketKPIFmt(kpis);
  const kpi1Title = bucketKPITitle(kpis);
  const kpi1Label = isValueMode ? "Total Balance" : isTx ? "Total Transactions" : "Total Suppliers";
  const kpi1Icon = isTx ? cfg.kpi1Icons.TRANSACTIONS : isValueMode ? cfg.kpi1Icons.VALUE : cfg.kpi1Icons.SUPPLIERS;
  let kpi2Val, kpi2Prev, kpi2Fmt, kpi2Title;
  let kpi2KeyVal = cfg.kpi2Key.VALUE;
  if (cfg.kpi2CompositeDocKeys && isTx) {
    kpi2Val = cfg.kpi2CompositeDocKeys.reduce((s, k) => s + (kpis[k] || 0), 0);
    kpi2Prev = prevKpis ? cfg.kpi2CompositeDocKeys.reduce((s, k) => s + (prevKpis[k] || 0), 0) : null;
    kpi2Fmt = kpi2Val.toLocaleString();
    kpi2Title = kpi2Val + " docs";
  } else if (cfg.kpi2CompositeSupplierFields && !isValueMode && !isTx) {
    const fields = cfg.kpi2CompositeSupplierFields;
    const getCount = (fil) => aggregateSuppliers(fil, teamId).filter((s) => fields.some((f) => Number(s[f] || 0) > 0)).length;
    const suppliers = aggregateSuppliers(prevFiltered || [], teamId);
    kpi2Val = 0;
  }
  if (kpi2Val === void 0) {
    kpi2KeyVal = isValueMode ? cfg.kpi2Key.VALUE : isTx ? cfg.kpi2Key.TRANSACTIONS : cfg.kpi2Key.SUPPLIERS;
    kpi2Val = bucketKPIFieldValue(kpis, kpi2KeyVal);
    kpi2Prev = prevKpis ? bucketKPIFieldValue(prevKpis, kpi2KeyVal) : null;
    kpi2Fmt = isValueMode ? fmt(kpi2Val) : kpi2Val;
    kpi2Title = isValueMode ? fmtExact(kpi2Val) : kpi2Val + (isTx ? " docs" : " items");
  }
  const kpi2Label = isValueMode ? cfg.kpi2Label.VALUE : isTx ? cfg.kpi2Label.TRANSACTIONS : cfg.kpi2Label.SUPPLIERS;
  const kpi2Icon = isTx ? cfg.kpi2Icon.TRANSACTIONS : isValueMode ? cfg.kpi2Icon.VALUE : cfg.kpi2Icon.SUPPLIERS;
  let kpi3Html = "";
  if (cfg.hasCriticalPct) {
    kpi3Html = `
            <div class="kpi-card" style="border-left-color: ${cfg.criticalColor}; color: ${cfg.criticalColor}" title="${(kpis[cfg.criticalKey] || 0).toFixed(2)}%">
                <div class="kpi-label"><i class="fa-solid fa-${cfg.criticalIcon}"></i> ${teamId}  ${cfg.criticalLabel}</div>
                <div class="kpi-value">${pct(kpis[cfg.criticalKey] || 0)}</div>
                ${deltaHtml(kpis[cfg.criticalKey] || 0, prevKpis ? prevKpis[cfg.criticalKey] : null, true, "")}
            </div>
        `;
  } else {
    let kpi3Val, kpi3Prev, kpi3Fmt, kpi3Title;
    if (isValueMode) {
      kpi3Val = bucketKPIFieldValue(kpis, cfg.criticalKey);
      kpi3Prev = prevKpis ? bucketKPIFieldValue(prevKpis, cfg.criticalKey) : null;
      kpi3Fmt = fmt(kpi3Val);
      kpi3Title = fmtExact(kpi3Val);
    } else if (isTx) {
      kpi3Val = bucketKPIFieldValue(kpis, cfg.criticalDocKey);
      kpi3Prev = prevKpis ? bucketKPIFieldValue(prevKpis, cfg.criticalDocKey) : null;
      kpi3Fmt = kpi3Val;
      kpi3Title = kpi3Val + " docs";
    } else {
      const countKey = cfg.criticalKey + "_count";
      kpi3Val = bucketKPIFieldValue(kpis, countKey);
      kpi3Prev = prevKpis ? bucketKPIFieldValue(prevKpis, countKey) : null;
      kpi3Fmt = kpi3Val;
      kpi3Title = kpi3Val + " suppliers";
    }
    kpi3Html = `
            <div class="kpi-card" style="border-left-color: ${cfg.criticalColor}; color: ${cfg.criticalColor}" title="${kpi3Title}">
                <div class="kpi-label"><i class="fa-solid fa-${cfg.criticalIcon}"></i> ${teamId}  ${cfg.criticalLabel}</div>
                <div class="kpi-value">${kpi3Fmt}</div>
                ${deltaHtml(kpi3Val, kpi3Prev, true, "")}
            </div>
        `;
  }
  const otpColor = otpData.otp >= 70 ? "var(--green)" : otpData.otp >= 50 ? "var(--orange)" : "var(--red)";
  const otpTooltip = `${otpData.onTime} on-time / ${otpData.late} late${otpData.hasEstimated ? " (includes estimated due dates)" : ""}`;
  return `
        <div class="kpi-card" style="border-left-color: ${cfg.color}; color: ${cfg.color}" title="${kpi1Title}">
            <div class="kpi-label"><i class="fa-solid fa-${kpi1Icon}"></i> ${teamId}  ${kpi1Label}</div>
            <div class="kpi-value">${kpi1Fmt}</div>
            ${deltaHtml(kpi1Val, kpi1Prev, true, "")}
        </div>
        <div class="kpi-card" style="border-left-color: ${cfg.kpi2Color}; color: ${cfg.kpi2Color}" title="${kpi2Title}">
            <div class="kpi-label"><i class="fa-solid fa-${kpi2Icon}"></i> ${teamId}  ${kpi2Label}</div>
            <div class="kpi-value">${kpi2Fmt}</div>
            ${deltaHtml(kpi2Val, kpi2Prev, true, "")}
        </div>
        ${kpi3Html}
        <div class="kpi-card" style="border-left-color: var(--primary); color: var(--primary)" title="${avgDays.toFixed(2)} days">
            <div class="kpi-label"><i class="fa-solid fa-hourglass-half"></i> ${teamId}  Avg Days Overdue</div>
            <div class="kpi-value">${avgDays.toFixed(0)} days</div>
            ${deltaHtml(avgDays, prevAvgDays, true, "")}
        </div>
        <div class="kpi-card" style="border-left-color: ${otpColor}; color: ${otpColor}" title="${otpTooltip}">
            <div class="kpi-label"><i class="fa-solid fa-clock"></i> ${teamId}  On-Time %${otpData.hasEstimated ? ' <i class="fa-solid fa-circle-info" style="font-size:0.7rem;opacity:0.6" title="Includes estimated due dates (Doc Date + 30d)"></i>' : ""}</div>
            <div class="kpi-value">${otpData.otp.toFixed(1)}%</div>
            ${deltaHtml(otpData.otp, prevOtp?.otp, false, "%")}
        </div>
    `;
}
function renderAgingChart(canvasId, tid, cfg, kpis) {
  const isValueMode = viewModeFilter === "VALUE";
  const isTx = viewModeFilter === "TRANSACTIONS";
  const chartData = cfg.agingBuckets.map((_, i) => {
    const bucket = cfg.agingBuckets[i].replace(" Days", "");
    if (globalBucketFilter.size > 0 && !globalBucketFilter.has("ALL_OVERDUE") && !globalBucketFilter.has(bucket)) return 0;
    const k = isValueMode ? cfg.agingKeys[i] : isTx ? cfg.agingDocKeys[i] : cfg.agingCountKeys[i];
    return Math.abs(kpis[k] || 0);
  });
  const label = isValueMode ? "Amount" : isTx ? "Documents" : "Suppliers";
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (charts[tid + "Aging"]) charts[tid + "Aging"].destroy();
  if (charts[tid]) charts[tid].destroy();
  const chartOpts = {
    type: "bar",
    data: { labels: cfg.agingBuckets, datasets: [{ label, data: chartData, backgroundColor: cfg.agingColors, borderRadius: 6 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: cfg.chartAxis,
      plugins: { legend: { display: false } }
    }
  };
  if (cfg.chartAxis === "y") {
    chartOpts.options.layout = { padding: { right: 80 } };
    chartOpts.options.plugins.datalabels = { display: true, anchor: "end", align: "end", formatter: (v) => isValueMode ? fmt(v) : v, color: () => dlColor(), font: { weight: "bold", size: 11 } };
    chartOpts.options.scales = { x: { ticks: { callback: (v) => isValueMode ? fmt(v) : v } }, y: { grid: { display: false } } };
  } else {
    chartOpts.options.layout = { padding: { top: 25 } };
    chartOpts.options.plugins.datalabels = dlConfigBar;
    chartOpts.options.scales = { y: { ticks: { callback: (v) => isValueMode ? fmt(v) : v } } };
  }
  charts[tid + "Aging"] = new Chart(canvas, chartOpts);
  charts[tid] = charts[tid + "Aging"];
}
function renderPieChart(canvasId, tid, cfg, kpis) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const overdueTotal = kpis.currentDocs + kpis.overdueDocs;
  const overduePct = overdueTotal > 0 ? kpis.overdueDocs / overdueTotal * 100 : 0;
  const pctColor = overduePct > 50 ? "#DC3545" : overduePct > 30 ? "#E6800A" : "#28A745";
  if (charts[tid + "Pie"]) charts[tid + "Pie"].destroy();
  charts[tid + "Pie"] = new Chart(canvas, {
    type: "doughnut",
    data: { labels: ["Current", "Overdue"], datasets: [{ data: [kpis.currentDocs, kpis.overdueDocs], backgroundColor: cfg.pieColors }] },
    options: { responsive: true, cutout: "65%", plugins: { datalabels: dlConfigPie, legend: { position: "bottom" } } },
    plugins: [{
      id: tid + "Center",
      beforeDraw(chart) {
        const { ctx, chartArea: { left, right, top, bottom } } = chart;
        const cx = (left + right) / 2, cy = (top + bottom) / 2;
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "bold 22px Inter, sans-serif";
        ctx.fillStyle = pctColor;
        ctx.fillText(overduePct.toFixed(1) + "%", cx, cy - 5);
        ctx.font = "10px Inter, sans-serif";
        ctx.fillStyle = "#999";
        ctx.fillText("overdue", cx, cy + 14);
        ctx.restore();
      }
    }]
  });
}
function renderOwnerAgingChart(canvasId, tid, cfg, ownerAging) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const labels = ownerAging.map((o) => o.owner);
  const palette = cfg.ownerAgingPalette || DEFAULT_OWNER_AGING_PALETTE;
  if (charts[tid + "OwnerAging"]) charts[tid + "OwnerAging"].destroy();
  charts[tid + "OwnerAging"] = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: OWNER_AGING_LABELS.map((label, idx) => ({
        label,
        data: ownerAging.map((o) => o[OWNER_AGING_DATA_KEYS[idx]]),
        backgroundColor: palette[idx],
        borderRadius: 2
      }))
    },
    options: {
      responsive: true,
      indexAxis: "y",
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, padding: 8, font: { size: 10, weight: "600" }, usePointStyle: true, pointStyle: "rectRounded" } },
        datalabels: { display: false },
        tooltip: { mode: "index", intersect: false, callbacks: { label: (ctx) => " " + ctx.dataset.label + ": " + fmt(ctx.parsed.x), footer: (items) => "Total: " + fmt(items.reduce((s, i) => s + i.parsed.x, 0)) } }
      },
      scales: {
        x: { stacked: true, ticks: { callback: (v) => fmt(v), font: { size: 10 } }, grid: { color: gridColor() } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11, weight: "600" } } }
      },
      onClick: (e, els) => {
        if (els.length) {
          const idx = els[0].index;
          filterByOwner(labels[idx]);
        }
      }
    }
  });
}
function renderDocTable(tid, cfg, filtered) {
  let docs = getDocumentRows(filtered, tid.toUpperCase());
  const btFilter = window[cfg.balanceTypeVar];
  if (btFilter === "CREDIT") docs = docs.filter((d) => (d.a || 0) < 0);
  else if (btFilter === "DEBIT") docs = docs.filter((d) => (d.a || 0) > 0);
  docs = paginateRows(docs, tid);
  const thead = `<tr><th>Supplier #</th><th>Name</th><th>CC</th><th>Reference</th><th>Doc #</th><th>Doc Type</th><th>Amount</th><th>Owner</th>${cfg.tableHasQueryType ? "<th>Query Type</th>" : "<th>Status</th>"}</tr>`;
  const tbody = docs.length ? docs.map((d) => `<tr>
        <td class="supplier-name">${hesc(d.s)}</td>
        <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis" title="${hesc(d.cm || "")}">${hesc(d.sn)}</td>
        <td><strong class="clickable-owner" onclick="filterByCompany('${hesc(d.cc)}')">${hesc(d.cc)}</strong></td>
        <td style="font-family:'Space Mono',monospace">${hesc(d.rn || "")}</td>
        <td style="font-family:'Space Mono',monospace">${hesc(d.dn)}</td>
        <td>${hesc(d.dt || "")}</td>
        <td class="amount">${fmtFull(d.a || 0, d.cur)}</td>
        <td><strong class="clickable-owner" onclick="filterByOwner('${hesc(d.o)}')">${hesc(d.o || "-")}</strong></td>
        <td>${cfg.tableHasQueryType ? hesc(d.qt || "-") : hesc(d.st || "-")}</td>
    </tr>`).join("") : `<tr><td colspan="${cfg.tableCols}" class="no-data">No documents found</td></tr>`;
  const el = document.getElementById(tid + "Table");
  if (el) el.innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
  renderPagination(tid, tid + "Pagination");
}
function renderTeamTable(tid, cfg, suppliers, prevFiltered) {
  const teamId = tid.toUpperCase();
  const isValueMode = viewModeFilter === "VALUE";
  const btFilter = window[cfg.balanceTypeVar];
  let criticalSuppliers = suppliers;
  if (btFilter === "CREDIT") {
    criticalSuppliers = criticalSuppliers.filter((s) => s.TotalAmount < 0);
  } else if (btFilter === "DEBIT") {
    criticalSuppliers = criticalSuppliers.filter((s) => s.TotalAmount > 0);
  }
  if (globalBucketFilter.size) {
    criticalSuppliers = filterByBucket(criticalSuppliers, globalBucketFilter);
  }
  const prevSuppliers = prevFiltered.length ? aggregateSuppliers(prevFiltered, teamId) : [];
  const prevMap = new Map(prevSuppliers.map((p) => [p.Supplier + "|" + (p.CompanyCode || ""), p]));
  let criticalCmp = criticalSuppliers.map((curr) => {
    const prev = prevMap.get(curr.Supplier + "|" + (curr.CompanyCode || ""));
    let currDefaultVal = 0, prevDefaultVal = 0;
    if (cfg.defaultBucketField) {
      currDefaultVal = Number(curr[cfg.defaultBucketField] || 0);
      prevDefaultVal = prev ? Number(prev[cfg.defaultBucketField] || 0) : 0;
    } else if (cfg.defaultBucketCalc && cfg.defaultBucketCalc === "aged_120_plus") {
      currDefaultVal = curr.Aged_180_plus + curr.Aged_121_180;
      prevDefaultVal = prev ? prev.Aged_180_plus + prev.Aged_121_180 : 0;
    }
    const currBucketValue = sumBucketValues(curr, globalBucketFilter, currDefaultVal);
    const prevBucketValue = prev ? sumBucketValues(prev, globalBucketFilter, prevDefaultVal) : 0;
    return {
      ...curr,
      currCritical: currBucketValue,
      curr_docs: curr.doc_count,
      prevCritical: prevBucketValue,
      change_value: currBucketValue - prevBucketValue,
      change_vol: (curr.doc_count || curr.TotalVol || 0) - (prev ? prev.doc_count || prev.TotalVol || 0 : 0),
      isNew: !prev,
      isWorse: currBucketValue > prevBucketValue
    };
  });
  const priorityFilterValue = document.getElementById(cfg.priorityFilterId)?.value || "";
  const bucketActive = globalBucketFilter.size > 0;
  const sortGetter = bucketActive ? (r) => Math.abs(r.currCritical || 0) : void 0;
  if (priorityFilterValue) {
    criticalCmp = criticalCmp.filter((s) => s.Priority === priorityFilterValue);
    if (sortGetter) criticalCmp.sort((a, b) => sortGetter(b) - sortGetter(a));
  } else {
    criticalCmp = topNByPriority(criticalCmp, -1, sortGetter);
  }
  criticalCmp = paginateRows(criticalCmp, tid);
  const thead = `<tr>
        <th>Supplier #</th>
        <th>Name</th>
        <th>Owner</th>
        <th>Priority</th>
        ${cfg.tableHasQueryType ? "<th>Query Type</th>" : ""}
        <th>${isValueMode ? "Total Balance" : "Total Vol"}</th>
        <th>${isValueMode ? "Total Vol" : "Total Balance"}</th>
        <th>Change</th>
        <th>Status</th>
        <th>Company</th>
    </tr>`;
  const tbody = criticalCmp.length ? criticalCmp.map((s) => {
    const bc = s.Priority === "HIGH" ? "badge-high" : s.Priority === "MEDIUM" ? "badge-medium" : "badge-low";
    const changeVal = isValueMode ? s.change_value : s.change_vol;
    const changeIcon = s.isNew ? '<i class="fa-solid fa-star"></i>' : changeVal > 0 ? '<i class="fa-solid fa-arrow-trend-up"></i>' : changeVal < 0 ? '<i class="fa-solid fa-arrow-trend-down"></i>' : "";
    const changeCls = s.isNew ? "change-new" : changeVal > 0 ? "change-worse" : changeVal < 0 ? "change-better" : "";
    const changeDisplay = isValueMode ? fmtFull(Math.abs(changeVal), s.Currency) : Math.abs(changeVal);
    const dispBal = bucketActive ? s.currCritical || 0 : s.TotalAmount || 0;
    const dispVol = bucketActive ? sumBucketDocs(s, globalBucketFilter, s.doc_count || s.TotalVol || 0) : s.doc_count || s.TotalVol || 0;
    const primaryVal = isValueMode ? fmtFull(dispBal, s.Currency) : dispVol;
    const secondaryVal = isValueMode ? dispVol : fmtFull(dispBal, s.Currency);
    return `<tr style="background: ${s.isNew ? "rgba(255,165,0,0.03)" : changeVal > 0 ? "rgba(220,53,69,0.03)" : "transparent"}">
            <td class="supplier-name">${hesc(s.SupplierNumber)}</td>
            <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis" title="${hesc(s.Comment || "")}">${hesc(s.SupplierName)}</td>
            <td><strong class="clickable-owner" onclick="filterByOwner('${hesc(s.Owner)}')">${hesc(s.Owner || "-")}</strong></td>
            <td><span class="badge ${bc}">${hesc(s.Priority)}</span></td>
            ${cfg.tableHasQueryType ? `<td>${hesc(s.QueryType || "-")}</td>` : ""}
            <td class="amount critical"><strong>${primaryVal}</strong></td>
            <td class="amount" style="opacity:0.7">${secondaryVal}</td>
            <td class="${changeCls}" style="text-align:center; font-weight:700">${changeIcon} ${s.isNew ? "New" : changeDisplay}</td>
            <td>${hesc(s.Status || "-")}</td>
            <td><strong class="clickable-owner" onclick="filterByCompany('${hesc(s.CompanyCode)}')">${hesc(s.CompanyCode)}</strong></td>
        </tr>`;
  }).join("") : `<tr><td colspan="${cfg.tableCols}" class="no-data">No critical ${teamId} suppliers</td></tr>`;
  const el = document.getElementById(tid + "Table");
  if (el) el.innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
  renderPagination(tid, tid + "Pagination");
}
