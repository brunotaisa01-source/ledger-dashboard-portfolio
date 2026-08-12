"use strict";
let _overdueOwnerCompForCSV = [];
let _overdueOwnerCompCurrentLabel = "Current";
let _overdueOwnerCompOlderLabel = "Older";
async function updateOverdueInsights() {
  showLoading(true);
  try {
    let filterTeam2 = function(rows) {
      if (!overdueTeamFilter.size) return rows;
      return rows.filter((r) => [...overdueTeamFilter].some((team) => matchesTeamView(r, team)));
    }, applyCountrySlice2 = function(rows) {
      if (!overdueCountrySlice) return rows;
      return rows.filter((r) => r.co === overdueCountrySlice);
    }, applyCompanyFilter2 = function(rows) {
      if (overdueCompanyFilter.size === 0) return rows;
      return rows.filter((r) => overdueCompanyFilter.has(r.cc || ""));
    }, aggregateByOwner2 = function(rows) {
      const owners = {};
      for (const row of rows) {
        const owner = row.o;
        if (!owner) continue;
        if (!owners[owner]) {
          owners[owner] = {
            owner,
            vendors: /* @__PURE__ */ new Set(),
            docs: 0,
            aged_0_30: 0,
            aged_31_60: 0,
            aged_61_90: 0,
            aged_91_120: 0,
            aged_121_180: 0,
            aged_180_plus: 0,
            aged_0_30_count: 0,
            aged_31_60_count: 0,
            aged_61_90_count: 0,
            aged_91_120_count: 0,
            aged_121_180_count: 0,
            aged_180_plus_count: 0
          };
        }
        let includeRow = true;
        if (overdueAgingFilter.size) {
          const overdue = (row.a030 || 0) + (row.a3160 || 0) + (row.a6190 || 0) + (row.a91120 || 0) + (row.a121180 || 0) + (row.a180 || 0);
          let matchAny = false;
          for (const bucket of overdueAgingFilter) {
            if (bucket === "NOT_OVERDUE" && overdue === 0) {
              matchAny = true;
              break;
            }
            if (bucket === "ALL_OVERDUE" && overdue !== 0) {
              matchAny = true;
              break;
            }
            if (matchesBucket(row, bucket)) {
              matchAny = true;
              break;
            }
          }
          if (!matchAny) includeRow = false;
        }
        if (!includeRow) continue;
        if (row.s) owners[owner].vendors.add(vendorKey(row));
        owners[owner].docs++;
        owners[owner].aged_0_30 += row.a030 || 0;
        owners[owner].aged_31_60 += row.a3160 || 0;
        owners[owner].aged_61_90 += row.a6190 || 0;
        owners[owner].aged_91_120 += row.a91120 || 0;
        owners[owner].aged_121_180 += row.a121180 || 0;
        owners[owner].aged_180_plus += row.a180 || 0;
        if (row.a030 !== 0 && row.a030 != null) owners[owner].aged_0_30_count++;
        if (row.a3160 !== 0 && row.a3160 != null) owners[owner].aged_31_60_count++;
        if (row.a6190 !== 0 && row.a6190 != null) owners[owner].aged_61_90_count++;
        if (row.a91120 !== 0 && row.a91120 != null) owners[owner].aged_91_120_count++;
        if (row.a121180 !== 0 && row.a121180 != null) owners[owner].aged_121_180_count++;
        if (row.a180 !== 0 && row.a180 != null) owners[owner].aged_180_plus_count++;
      }
      return Object.values(owners).map((o) => ({
        ...o,
        vendors_count: o.vendors.size
      })).sort((a, b) => b.vendors_count - a.vendors_count);
    };
    var filterTeam = filterTeam2, applyCountrySlice = applyCountrySlice2, applyCompanyFilter = applyCompanyFilter2, aggregateByOwner = aggregateByOwner2;
    const w1Data = (await getWeekData(overdueWeek1)).raw || [];
    const w2Data = (await getWeekData(overdueWeek2)).raw || [];
    const currentWeek = overdueWeek1;
    const olderWeek = overdueWeek2;
    const currentData = w1Data;
    const olderData = w2Data;
    const current = detailRows(filterTeam2(currentData));
    const older = detailRows(filterTeam2(olderData));
    const countries = /* @__PURE__ */ new Set();
    current.forEach((r) => {
      if (r.co) countries.add(r.co);
    });
    older.forEach((r) => {
      if (r.co) countries.add(r.co);
    });
    const sortedCountries = Array.from(countries).sort();
    const countryDropdown = document.getElementById("overdueCountrySliceFilter");
    if (countryDropdown) {
      countryDropdown.innerHTML = '<option value="">All Countries</option>' + sortedCountries.map((c) => `<option value="${hesc(c)}">${hesc(c)}</option>`).join("");
      if (overdueCountrySlice && sortedCountries.includes(overdueCountrySlice)) {
        countryDropdown.value = overdueCountrySlice;
      } else if (overdueCountrySlice) {
        overdueCountrySlice = "";
      }
    }
    const companyCodes = /* @__PURE__ */ new Set();
    current.forEach((r) => {
      if (r.cc) companyCodes.add(r.cc);
    });
    older.forEach((r) => {
      if (r.cc) companyCodes.add(r.cc);
    });
    const sortedCodes = Array.from(companyCodes).sort();
    const ccDropdown = document.getElementById("overdueCompanyDropdown");
    if (ccDropdown) {
      ccDropdown.innerHTML = '<button type="button" style="display:block;width:100%;text-align:left;border:0;background:transparent;border-bottom:1px solid var(--border);margin-bottom:2px;padding:0 0 0.4rem 0;font-weight:600;cursor:pointer;color:var(--text);" onclick="clearOverdueCompany()">All Companies</button>' + sortedCodes.map((c) => `<label style="color:var(--text);"><input type="checkbox" value="${hesc(c)}" ${overdueCompanyFilter.has(String(c)) ? "checked" : ""} onchange="toggleOverdueCompany(this)"> ${hesc(c)}</label>`).join("");
    }
    for (const v of [...overdueCompanyFilter]) {
      if (!companyCodes.has(v)) overdueCompanyFilter.delete(v);
    }
    const ccDisp = document.querySelector("#overdueCompanyWrap .multi-select-display");
    if (ccDisp) ccDisp.textContent = overdueCompanyFilter.size === 0 ? "All Companies" : [...overdueCompanyFilter].sort().join(", ");
    const currentFiltered = applyCompanyFilter2(applyCountrySlice2(current));
    const olderFiltered = applyCompanyFilter2(applyCountrySlice2(older));
    const owCurrent = aggregateByOwner2(currentFiltered);
    const owOlder = aggregateByOwner2(olderFiltered);
    const totalVendorsCurrent = owCurrent.reduce((s, o) => s + o.vendors_count, 0);
    const totalVendorsOlder = owOlder.reduce((s, o) => s + o.vendors_count, 0);
    const totalDocsCurrent = owCurrent.reduce((s, o) => s + o.docs, 0);
    const totalDocsOlder = owOlder.reduce((s, o) => s + o.docs, 0);
    const deltaVendors = totalVendorsCurrent - totalVendorsOlder;
    const deltaDocs = totalDocsCurrent - totalDocsOlder;
    const pctVendors = totalVendorsOlder > 0 ? (deltaVendors / totalVendorsOlder * 100).toFixed(1) : "0.0";
    const pctDocs = totalDocsOlder > 0 ? (deltaDocs / totalDocsOlder * 100).toFixed(1) : "0.0";
    const vendorArrow = deltaVendors > 0 ? "" : deltaVendors < 0 ? "" : "";
    const docArrow = deltaDocs > 0 ? "" : deltaDocs < 0 ? "" : "";
    const vendorColor = deltaVendors > 0 ? "var(--red)" : deltaVendors < 0 ? "var(--green)" : "var(--text-muted)";
    const docColor = deltaDocs > 0 ? "var(--red)" : deltaDocs < 0 ? "var(--green)" : "var(--text-muted)";
    const currentLabel = formatDate(currentWeek);
    const olderLabel = formatDate(olderWeek);
    document.getElementById("overdue-kpis").innerHTML = `
        <div class="kpi-card" style="border-left-color: var(--primary); color: var(--primary)">
            <div class="kpi-label"><i class="fa-solid fa-building"></i> Total Vendors (${currentLabel} vs ${olderLabel})</div>
            <div class="kpi-value" style="font-size: 1.5rem">${totalVendorsCurrent} <span style="font-size:0.7rem; opacity:0.6">vs</span> ${totalVendorsOlder}</div>
            <span class="kpi-delta" style="color: ${vendorColor}; font-weight: 700">${vendorArrow} ${Math.abs(deltaVendors)} (${pctVendors}%)</span>
        </div>
        <div class="kpi-card" style="border-left-color: var(--accent); color: var(--accent)">
            <div class="kpi-label"><i class="fa-solid fa-file-invoice"></i> Total Documents (${currentLabel} vs ${olderLabel})</div>
            <div class="kpi-value" style="font-size: 1.5rem">${totalDocsCurrent} <span style="font-size:0.7rem; opacity:0.6">vs</span> ${totalDocsOlder}</div>
            <span class="kpi-delta" style="color: ${docColor}; font-weight: 700">${docArrow} ${Math.abs(deltaDocs)} (${pctDocs}%)</span>
        </div>
        <div class="kpi-card" style="border-left-color: var(--orange); color: var(--orange)">
            <div class="kpi-label"><i class="fa-solid fa-users"></i> Active Owners (${currentLabel} vs ${olderLabel})</div>
            <div class="kpi-value" style="font-size: 1.5rem">${owCurrent.length} <span style="font-size:0.7rem; opacity:0.6">vs</span> ${owOlder.length}</div>
            <span class="kpi-delta neutral">${owCurrent.length - owOlder.length > 0 ? "" : owCurrent.length - owOlder.length < 0 ? "" : ""} ${Math.abs(owCurrent.length - owOlder.length)} owners</span>
        </div>
        <div class="kpi-card" style="border-left-color: var(--green); color: var(--green)">
            <div class="kpi-label"><i class="fa-solid fa-filter"></i> Team Filter</div>
            <div class="kpi-value" style="font-size: 1.2rem">${overdueTeamFilter.size === 0 ? "All Teams" : [...overdueTeamFilter].sort().join(", ")}</div>
            <span class="kpi-delta neutral">Analyzing ${current.length} documents</span>
        </div>
    `;
    const topOwners = owCurrent;
    const labels = topOwners.map((o) => o.owner);
    if (charts.overdueVendors) charts.overdueVendors.destroy();
    charts.overdueVendors = new Chart(document.getElementById("overdueVendorsChart"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: currentLabel,
            data: labels.map((l) => topOwners.find((o) => o.owner === l)?.vendors_count || 0),
            backgroundColor: "#028090",
            borderRadius: 6,
            barThickness: 35
          },
          {
            label: olderLabel,
            data: labels.map((l) => owOlder.find((o) => o.owner === l)?.vendors_count || 0),
            backgroundColor: "#1E2761",
            borderRadius: 6,
            barThickness: 35
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 2.5,
        indexAxis: "x",
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: {
              boxWidth: 12,
              padding: 12,
              font: { size: 11, weight: "600" },
              usePointStyle: true,
              pointStyle: "rectRounded"
            }
          },
          datalabels: {
            anchor: "end",
            align: "top",
            offset: 6,
            font: { size: 12, weight: "bold", family: "'Space Mono', monospace" },
            color: "#0f172a",
            formatter: (v) => v > 0 ? v : "",
            backgroundColor: "rgba(248, 250, 252, 0.98)",
            borderColor: "rgba(15, 23, 42, 0.18)",
            borderWidth: 1,
            borderRadius: 4,
            padding: { top: 2, bottom: 2, left: 4, right: 4 }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} vendors`
            }
          }
        },
        scales: {
          y: {
            stacked: false,
            grid: { display: true, color: gridColor() },
            ticks: { font: { size: 10 } },
            beginAtZero: true
          },
          x: {
            stacked: false,
            grid: { display: false },
            ticks: { font: { size: 11, weight: "600" } }
          }
        }
      }
    });
    if (charts.overdueDocs) charts.overdueDocs.destroy();
    charts.overdueDocs = new Chart(document.getElementById("overdueDocsChart"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: currentLabel,
            data: labels.map((l) => topOwners.find((o) => o.owner === l)?.docs || 0),
            backgroundColor: "#028090",
            borderRadius: 6,
            barThickness: 35
          },
          {
            label: olderLabel,
            data: labels.map((l) => owOlder.find((o) => o.owner === l)?.docs || 0),
            backgroundColor: "#1E2761",
            borderRadius: 6,
            barThickness: 35
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 2.5,
        indexAxis: "x",
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: {
              boxWidth: 12,
              padding: 12,
              font: { size: 11, weight: "600" },
              usePointStyle: true,
              pointStyle: "rectRounded"
            }
          },
          datalabels: {
            anchor: "end",
            align: "top",
            offset: 6,
            font: { size: 12, weight: "bold", family: "'Space Mono', monospace" },
            color: "#0f172a",
            formatter: (v) => v > 0 ? v : "",
            backgroundColor: "rgba(248, 250, 252, 0.98)",
            borderColor: "rgba(15, 23, 42, 0.18)",
            borderWidth: 1,
            borderRadius: 4,
            padding: { top: 2, bottom: 2, left: 4, right: 4 }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} docs`
            }
          }
        },
        scales: {
          y: {
            stacked: false,
            grid: { display: true, color: gridColor() },
            ticks: { font: { size: 10 } },
            beginAtZero: true
          },
          x: {
            stacked: false,
            grid: { display: false },
            ticks: { font: { size: 11, weight: "600" } }
          }
        }
      }
    });
    const agingOwnerLabels = owCurrent.map((o) => o.owner);
    const agingDatasets = [
      { label: "0-30 Days", data: agingOwnerLabels.map((l) => {
        const o = owCurrent.find((ow) => ow.owner === l);
        return o ? o.aged_0_30_count : 0;
      }), backgroundColor: "rgba(40,167,69,0.85)", borderRadius: 2 },
      { label: "31-60 Days", data: agingOwnerLabels.map((l) => {
        const o = owCurrent.find((ow) => ow.owner === l);
        return o ? o.aged_31_60_count : 0;
      }), backgroundColor: "rgba(255,193,7,0.85)", borderRadius: 2 },
      { label: "61-90 Days", data: agingOwnerLabels.map((l) => {
        const o = owCurrent.find((ow) => ow.owner === l);
        return o ? o.aged_61_90_count : 0;
      }), backgroundColor: "rgba(255,107,53,0.85)", borderRadius: 2 },
      { label: "91-120 Days", data: agingOwnerLabels.map((l) => {
        const o = owCurrent.find((ow) => ow.owner === l);
        return o ? o.aged_91_120_count : 0;
      }), backgroundColor: "rgba(230,126,0,0.85)", borderRadius: 2 },
      { label: "121-180 Days", data: agingOwnerLabels.map((l) => {
        const o = owCurrent.find((ow) => ow.owner === l);
        return o ? o.aged_121_180_count : 0;
      }), backgroundColor: "rgba(220,53,69,0.85)", borderRadius: 2 },
      { label: "180+ Days", data: agingOwnerLabels.map((l) => {
        const o = owCurrent.find((ow) => ow.owner === l);
        return o ? o.aged_180_plus_count : 0;
      }), backgroundColor: "rgba(139,0,0,0.85)", borderRadius: 2 }
    ];
    if (charts.agingByOwner) charts.agingByOwner.destroy();
    charts.agingByOwner = new Chart(document.getElementById("agingByOwnerChart"), {
      type: "bar",
      data: { labels: agingOwnerLabels, datasets: agingDatasets },
      options: {
        responsive: true,
        indexAxis: "y",
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, padding: 12, font: { size: 11, weight: "600" }, usePointStyle: true, pointStyle: "rectRounded" } },
          datalabels: { display: false },
          tooltip: { mode: "index", intersect: false, backgroundColor: "rgba(30,39,97,0.92)", padding: 10, cornerRadius: 8, callbacks: { label: (ctx) => " " + ctx.dataset.label + ": " + ctx.parsed.x + " docs", footer: (items) => "Total Docs: " + items.reduce((s, i) => s + i.parsed.x, 0) } }
        },
        scales: {
          x: { stacked: true, grid: { color: gridColor(), drawBorder: false }, ticks: { callback: (v) => v, font: { size: 10 } }, border: { display: false } },
          y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11, weight: "600" } }, border: { display: false } }
        }
      }
    });
    const combinedOwners = [.../* @__PURE__ */ new Set([...owCurrent.map((o) => o.owner), ...owOlder.map((o) => o.owner)])];
    const tableData = combinedOwners.map((owner) => {
      const dCurrent = owCurrent.find((o) => o.owner === owner);
      const dOlder = owOlder.find((o) => o.owner === owner);
      return {
        owner,
        current_vendors: dCurrent?.vendors_count || 0,
        older_vendors: dOlder?.vendors_count || 0,
        current_docs: dCurrent?.docs || 0,
        older_docs: dOlder?.docs || 0,
        delta_vendors: (dCurrent?.vendors_count || 0) - (dOlder?.vendors_count || 0),
        delta_docs: (dCurrent?.docs || 0) - (dOlder?.docs || 0)
      };
    }).sort((a, b) => b.current_vendors - a.current_vendors).slice(0, 20);
    _overdueOwnerCompForCSV = tableData;
    _overdueOwnerCompCurrentLabel = currentLabel;
    _overdueOwnerCompOlderLabel = olderLabel;
    document.getElementById("overdueTable").innerHTML = tableData.length ? `
        <thead><tr>
            <th>Owner</th>
            <th>${currentLabel}<br>Vendors</th>
            <th>${olderLabel}<br>Vendors</th>
            <th> Vendors</th>
            <th>${currentLabel}<br>Docs</th>
            <th>${olderLabel}<br>Docs</th>
            <th> Docs</th>
        </tr></thead>
        <tbody>${tableData.map((d) => {
      const vColor = d.delta_vendors > 0 ? "var(--red)" : d.delta_vendors < 0 ? "var(--green)" : "var(--text-muted)";
      const dColor = d.delta_docs > 0 ? "var(--red)" : d.delta_docs < 0 ? "var(--green)" : "var(--text-muted)";
      const vIcon = d.delta_vendors > 0 ? "" : d.delta_vendors < 0 ? "" : "";
      const dIcon = d.delta_docs > 0 ? "" : d.delta_docs < 0 ? "" : "";
      return `<tr>
                <td class="supplier-name">${hesc(d.owner)}</td>
                <td style="text-align:center; font-weight:700">${d.current_vendors}</td>
                <td style="text-align:center; opacity:0.7">${d.older_vendors}</td>
                <td style="text-align:center; font-weight:700; color:${vColor}">${vIcon} ${Math.abs(d.delta_vendors)}</td>
                <td style="text-align:center; font-weight:700">${d.current_docs}</td>
                <td style="text-align:center; opacity:0.7">${d.older_docs}</td>
                <td style="text-align:center; font-weight:700; color:${dColor}">${dIcon} ${Math.abs(d.delta_docs)}</td>
            </tr>`;
    }).join("")}</tbody>
    ` : '<tr><td colspan="7" class="no-data">No data available</td></tr>';
  } finally {
    showLoading(false);
  }
}
