"use strict";
async function update() {
  if (!_paginating) {
    pageState.overview = 1;
    pageState.key = 1;
    pageState.movement = 1;
    pageState.rol = 1;
    pageState.workedSuppliers = 1;
    pageState.resolvedCarryover = 1;
  }
  showLoading(true);
  try {
    const weekData = await getWeekData(currentWeek);
    const raw = weekData.raw || [];
    const vcWrap = document.getElementById("vendorCategoryWrap");
    if (vcWrap) {
      const weekVCs = [...new Set(raw.map((r) => r.vc).filter(Boolean))];
      weekVCs.sort();
      const dd = vcWrap.querySelector(".multi-select-dropdown");
      if (dd) dd.innerHTML = '<div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllVendorCategory();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearVendorCategory();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>' + weekVCs.map((vc) => `<label><input type="checkbox" value="${hesc(vc)}" onchange="toggleVendorCategory(this)"${vendorCategoryFilter.has(vc) ? " checked" : ""}> ${hesc(vc)}</label>`).join("");
      for (const v of vendorCategoryFilter) {
        if (!weekVCs.includes(v)) vendorCategoryFilter.delete(v);
      }
      const disp = vcWrap.querySelector(".multi-select-display");
      if (disp) disp.textContent = vendorCategoryFilter.size === 0 ? "All Categories" : [...vendorCategoryFilter].join(", ");
    }
    const pbWrap = document.getElementById("paymentBlockWrap");
    if (pbWrap) {
      const weekPBs = [...new Set(raw.map((r) => r.pb).filter(Boolean))];
      weekPBs.sort();
      const pbDd = pbWrap.querySelector(".multi-select-dropdown");
      if (pbDd) pbDd.innerHTML = '<div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllPaymentBlock();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearPaymentBlock();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>' + weekPBs.map((pb) => `<label><input type="checkbox" value="${hesc(pb)}" onchange="togglePaymentBlock(this)"${paymentBlockFilter.has(pb) ? " checked" : ""}> ${hesc(pb)}</label>`).join("");
      for (const v of paymentBlockFilter) {
        if (!weekPBs.includes(v)) paymentBlockFilter.delete(v);
      }
      const pbDisp = pbWrap.querySelector(".multi-select-display");
      if (pbDisp) pbDisp.textContent = paymentBlockFilter.size === 0 ? "All" : [...paymentBlockFilter].join(", ");
    }
    const filtered = applyFilters(raw);
    const pw = getPrevWeek();
    const prevRaw = pw ? (await getWeekData(pw)).raw || [] : [];
    const activePage = document.querySelector(".page.active");
    const activeId = activePage ? activePage.id : "overview";
    if (activeId === "overview") {
      updateOverview(filtered, raw, prevRaw);
      await updateMovement();
    } else if (activeId === "key") {
      updateKey(filtered, raw, prevRaw);
    } else if (activeId === "rol") {
      updateROL(filtered, raw, prevRaw);
    } else if (activeId === "productivity") {
      updateProductivity(filtered, raw, prevRaw);
    }
    if (activeId === "overview") scheduleTrendUpdate();
    const notice = document.getElementById("trendFilterNotice");
    if (notice) notice.style.display = globalBucketFilter.size > 0 || supplierSearchFilter ? "block" : "none";
  } finally {
    showLoading(false);
  }
}
function updateOverview(filtered, raw, prevRaw) {
  let ovFiltered = filtered;
  let ovPrevRaw = prevRaw;
  if (overviewTeamFilter === "KEY") {
    ovFiltered = teamViewRows(filtered, "KEY");
    ovPrevRaw = teamViewRows(prevRaw, "KEY");
  } else if (overviewTeamFilter === "ROL") {
    ovFiltered = teamViewRows(filtered, "ROL");
    ovPrevRaw = teamViewRows(prevRaw, "ROL");
  }
  const prevFiltered = ovPrevRaw.length ? applyFilters(ovPrevRaw) : [];
  const kpis = computeKPIs(ovFiltered);
  const prevKpis = prevFiltered.length ? computeKPIs(prevFiltered) : null;
  const isValueMode = viewModeFilter === "VALUE";
  const isTx = viewModeFilter === "TRANSACTIONS";
  const kv = (kp) => bucketKPIValue(kp);
  const kvFmt = (kp) => bucketKPIFmt(kp);
  const kvTitle = (kp) => bucketKPITitle(kp);
  const volLabel = isTx ? "Transactions" : "Suppliers";
  let teamCardsHtml = "";
  for (const [teamId, cfg] of Object.entries(TEAM_CONFIG)) {
    const teamKpis = computeKPIs(ovFiltered, teamId);
    const prevTeamKpis = prevFiltered.length ? computeKPIs(prevFiltered, teamId) : null;
    const shortName = cfg.label.replace(" Team", "");
    const icon = (cfg.overviewIcons || {})[viewModeFilter] || cfg.icon;
    teamCardsHtml += `
        <div class="kpi-card" style="border-left-color: ${cfg.color}; color: ${cfg.color}" title="${kvTitle(teamKpis)}">
            <div class="kpi-label"><i class="fa-solid fa-${icon}"></i> ${isValueMode ? shortName + " Balance" : shortName + " " + volLabel}</div>
            <div class="kpi-value">${kvFmt(teamKpis)}</div>
            ${deltaHtml(kv(teamKpis), prevTeamKpis ? kv(prevTeamKpis) : null, true)}
        </div>`;
  }
  const _t30 = /* @__PURE__ */ new Date();
  _t30.setHours(0, 0, 0, 0);
  const _in30 = new Date(_t30.getTime() + 30 * 864e5);
  let _dueVal = 0, _dueDocs = 0;
  const _dueSupps = /* @__PURE__ */ new Set();
  const ovDetailRows = filterDocsByBucket(detailRows(ovFiltered), globalBucketFilter);
  for (const r of ovDetailRows) {
    if (!r.nd) continue;
    const p = r.nd.split("-");
    if (p.length !== 3) continue;
    const nd = new Date(+p[2], +p[1] - 1, +p[0]);
    if (isNaN(nd.getTime()) || nd < _t30 || nd > _in30) continue;
    _dueVal += Math.abs(r.a || 0);
    _dueDocs++;
    if (r.s) _dueSupps.add(vendorKey(r));
  }
  const overdueCardHtml = (() => {
    const ov = isValueMode ? kpis.overdueValue : kpis.overdueDocs;
    const cur = isValueMode ? kpis.currentValue : kpis.currentDocs;
    const tot = Math.abs(ov) + Math.abs(cur);
    const pctVal = tot ? (Math.abs(ov) / tot * 100).toFixed(1) : "0.0";
    const f = (v) => isValueMode ? fmt(Math.abs(v)) : Math.abs(v).toLocaleString();
    const prevOv = prevKpis ? isValueMode ? prevKpis.overdueValue : prevKpis.overdueDocs : null;
    const prevCur = prevKpis ? isValueMode ? prevKpis.currentValue : prevKpis.currentDocs : null;
    const prevTot = prevOv !== null && prevCur !== null ? Math.abs(prevOv) + Math.abs(prevCur) : null;
    const prevPctVal = prevTot && prevOv !== null ? (Math.abs(prevOv) / prevTot * 100).toFixed(1) : null;
    const pp = prevPctVal !== null ? (parseFloat(pctVal) - parseFloat(prevPctVal)).toFixed(1) : null;
    const ppDelta = pp !== null ? `<span class="kpi-delta ${parseFloat(pp) > 0.05 ? "up" : parseFloat(pp) < -0.05 ? "down" : "neutral"}"><i class="fa-solid fa-${parseFloat(pp) > 0 ? "arrow-up" : parseFloat(pp) < 0 ? "arrow-down" : "minus"}"></i> ${Math.abs(parseFloat(pp))}% vs LW</span>` : '<span class="kpi-delta neutral"> vs LW</span>';
    return `<div class="kpi-card" style="border-left-color: var(--orange); color: var(--orange)" title="${f(ov)} / ${f(tot)}">
            <div class="kpi-label"><i class="fa-solid fa-file-circle-exclamation"></i> Overdue Rate</div>
            <div style="display:flex;align-items:baseline;gap:0.4rem"><span class="kpi-value" style="margin:0">${pctVal}%</span><span style="font-size:0.82rem;color:var(--text-muted)">${f(ov)} / ${f(tot)}</span></div>
            ${ppDelta}
        </div>`;
  })();
  document.getElementById("overview-kpis").innerHTML = `
        <div class="kpi-card" style="border-left-color: var(--primary); color: var(--primary)" title="${kvTitle(kpis)}">
            <div class="kpi-label"><i class="fa-solid fa-${isValueMode ? "wallet" : isTx ? "file-lines" : "users"}"></i> ${isValueMode ? "Total AP Balance" : "Total " + volLabel}</div>
            <div class="kpi-value">${kvFmt(kpis)}</div>
            ${deltaHtml(kv(kpis), prevKpis ? kv(prevKpis) : null, true)}
        </div>
        ${teamCardsHtml}
        ${overdueCardHtml}
        <div class="kpi-card" style="border-left-color: #17A2B8; color: #17A2B8" title="${fmtExact(_dueVal)} (${_dueDocs.toLocaleString()} docs, ${_dueSupps.size} suppliers)">
            <div class="kpi-label"><i class="fa-solid fa-hourglass-half"></i> Due in 30 Days</div>
            <div class="kpi-value">${isValueMode ? fmt(_dueVal) : isTx ? _dueDocs.toLocaleString() : _dueSupps.size}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">${isValueMode ? _dueDocs.toLocaleString() + " docs" : fmt(_dueVal)}</div>
        </div>
    `;
  const qtDist = {};
  for (const r of ovDetailRows) {
    const qt = r.qt;
    if (!qt) continue;
    if (!qtDist[qt]) qtDist[qt] = { suppliers: /* @__PURE__ */ new Set(), value: 0, docs: 0 };
    qtDist[qt].suppliers.add(vendorKey(r));
    qtDist[qt].value += Math.abs(r.a || 0);
    qtDist[qt].docs++;
  }
  const isTxQT = viewModeFilter === "TRANSACTIONS";
  const qtArr = Object.entries(qtDist).map(([k, v]) => ({ type: k, count: v.suppliers.size, value: v.value, docs: v.docs })).sort((a, b) => isValueMode ? Math.abs(b.value) - Math.abs(a.value) : isTxQT ? b.docs - a.docs : b.count - a.count);
  const qtPalette = ["#028090", "#02C39A", "#28A745", "#FFC107", "#FF6B35", "#DC3545", "#6F42C1", "#1E2761", "#17A2B8", "#E83E8C", "#20C997", "#6610F2"];
  const qtColors = qtArr.map((_, i) => qtPalette[i % qtPalette.length]);
  const qtCanvas = document.getElementById("queryTypeChart");
  if (charts.overviewQT) charts.overviewQT.destroy();
  if (qtCanvas) {
    charts.overviewQT = new Chart(qtCanvas, {
      type: "bar",
      data: {
        labels: qtArr.map((q) => q.type.length > 16 ? q.type.slice(0, 14) + ".." : q.type),
        datasets: [{
          label: isValueMode ? "Balance" : isTxQT ? "Transactions" : "Suppliers",
          data: qtArr.map((q) => isValueMode ? q.value : isTxQT ? q.docs : q.count),
          backgroundColor: qtColors,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        onClick: (e, els) => {
          if (els.length) {
            const qt = qtArr[els[0].index].type;
            queryTypeFilter.clear();
            queryTypeFilter.add(qt);
            document.querySelectorAll('#queryTypeWrap input[type="checkbox"]').forEach((cb) => {
              cb.checked = cb.value === qt;
            });
            const qtDisp = document.querySelector("#queryTypeWrap .multi-select-display");
            if (qtDisp) qtDisp.textContent = qt;
            update();
          }
        },
        plugins: {
          legend: { display: false },
          datalabels: dlConfigBar
        },
        scales: {
          y: { ticks: { callback: (v) => isValueMode ? fmt(v) : v.toLocaleString() } }
        }
      }
    });
  }
  const ents = computeEntities(ovFiltered).slice(0, 6);
  if (charts.entity) charts.entity.destroy();
  charts.entity = new Chart(document.getElementById("entityChart"), {
    type: "doughnut",
    // FIX: Use TotalVol when in VOLUME mode
    data: { labels: ents.map((e) => e.CompanyCode), datasets: [{ data: ents.map((e) => isValueMode ? Math.abs(e.TotalBalance) : e.TotalVol), backgroundColor: ["#028090", "#00A896", "#02C39A", "#28A745", "#FFC107", "#FF6B35"] }] },
    options: { responsive: true, plugins: { datalabels: dlConfigPie, legend: { position: "bottom" } } }
  });
  if (isTx) {
    let docs = getDocumentRows(ovFiltered, overviewTableTeamFilter || void 0);
    if (topSupplierBalanceType === "CREDIT") docs = docs.filter((d) => (d.a || 0) < 0);
    else if (topSupplierBalanceType === "DEBIT") docs = docs.filter((d) => (d.a || 0) > 0);
    docs = paginateRows(docs, "overview");
    document.getElementById("overviewTable").innerHTML = docs.length ? `
            <thead><tr><th>Supplier #</th><th>Name</th><th>CC</th><th>Reference</th><th>Doc #</th><th>Doc Type</th><th>Amount</th><th>Owner</th><th>Team</th></tr></thead>
            <tbody>${docs.map((d) => `<tr>
                    <td class="supplier-name">${hesc(d.s)}</td>
                    <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis">${hesc(d.sn)}</td>
                    <td>${hesc(d.cc)}</td>
                    <td style="font-family:'Space Mono',monospace">${hesc(d.rn || "")}</td>
                    <td style="font-family:'Space Mono',monospace">${hesc(d.dn)}</td>
                    <td>${hesc(d.dt || "")}</td>
                    <td class="amount">${fmtFull(d.a || 0, d.cur)}</td>
                    <td><strong class="clickable-owner" onclick="filterByOwner('${hesc(d.o)}')">${hesc(d.o || "-")}</strong></td>
                    <td><span class="badge badge-${(d.sh || "").toLowerCase()}">${hesc(d.sh)}</span></td>
                </tr>`).join("")}</tbody>
        ` : '<tr><td colspan="9" class="no-data">No data</td></tr>';
    renderPagination("overview", "overviewPagination");
    return;
  }
  let suppliers = aggregateSuppliers(ovFiltered, overviewTableTeamFilter || void 0);
  if (topSupplierBalanceType === "CREDIT") {
    suppliers = suppliers.filter((s) => s.TotalAmount < 0);
  } else if (topSupplierBalanceType === "DEBIT") {
    suppliers = suppliers.filter((s) => s.TotalAmount > 0);
  }
  suppliers = suppliers.map((s) => ({
    ...s,
    riskTier: creditRiskTier(s.TotalAmount)
  }));
  suppliers = filterByBucket(suppliers, globalBucketFilter);
  const bucketActive = globalBucketFilter.size > 0;
  const dispBalance = (s) => bucketActive ? sumBucketValues(s, globalBucketFilter, s.TotalAmount) : s.TotalAmount;
  const dispOverdue = (s) => bucketActive ? sumBucketValues(s, globalBucketFilter, s.total_overdue || 0) : s.total_overdue || 0;
  const dispDocs = (s) => bucketActive ? sumBucketDocs(s, globalBucketFilter, s.doc_count || s.TotalVol || 0) : s.doc_count || s.TotalVol || 0;
  const dispOverdueDocs = (s) => bucketActive ? sumBucketDocs(s, globalBucketFilter, s.overdueDocs || 0) : s.overdueDocs || 0;
  if (isValueMode) {
    suppliers.sort((a, b) => Math.abs(dispBalance(b)) - Math.abs(dispBalance(a)));
  } else {
    suppliers.sort((a, b) => dispDocs(b) - dispDocs(a));
  }
  suppliers = paginateRows(suppliers, "overview");
  document.getElementById("overviewTable").innerHTML = suppliers.length ? `
        <thead><tr><th>Supplier #</th><th>Name</th><th>Owner</th><th>Team</th><th>${isValueMode ? "Balance" : "Docs"}</th><th>${isValueMode ? "Overdue" : "Docs Overdue"}</th><th>Company</th><th>Country</th></tr></thead>
        <tbody>${suppliers.map((s) => `<tr>
            <td class="supplier-name">${hesc(s.SupplierNumber)}</td>
            <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis">${hesc(s.SupplierName)}</td>
            <td><strong class="clickable-owner" onclick="filterByOwner('${hesc(s.Owner)}')">${hesc(s.Owner || "-")}</strong></td>
            <td><span class="badge badge-${hesc(s.Sheet).toLowerCase()}">${hesc(s.Sheet)}</span></td>
            <td class="amount">${isValueMode ? fmtFull(dispBalance(s), s.Currency) : dispDocs(s)}</td>
            <td class="amount">${isValueMode ? fmtFull(dispOverdue(s), s.Currency) : dispOverdueDocs(s)}</td>
            <td>${hesc(s.CompanyCode)}</td>
            <td>${hesc(s.Country || "-")}</td>
        </tr>`).join("")}</tbody>
    ` : '<tr><td colspan="8" class="no-data">No data</td></tr>';
  renderPagination("overview", "overviewPagination");
}
