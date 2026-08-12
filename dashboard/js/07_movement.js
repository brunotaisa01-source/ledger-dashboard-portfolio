"use strict";
let _movementAllForCSV = [];
async function updateMovement() {
  try {
    const isValueMode = viewModeFilter === "VALUE";
    const isTx = viewModeFilter === "TRANSACTIONS";
    const w1Raw = (await getWeekData(movWeek1)).raw || [];
    const w2Raw = (await getWeekData(movWeek2)).raw || [];
    const w1Filtered = applyFilters(w1Raw);
    const w2Filtered = applyFilters(w2Raw);
    let movements = [];
    let newCount = 0, clearedCount = 0, increasedCount = 0, decreasedCount = 0;
    let totalIncreasedAmt = 0, totalDecreasedAmt = 0;
    if (isTx) {
      const w1Details = w1Filtered.filter((r) => (r.rl || "").toUpperCase() === "DETAIL");
      const w2Details = w2Filtered.filter((r) => (r.rl || "").toUpperCase() === "DETAIL");
      const w1TeamDocs = teamViewRows(w1Details, movementTeamFilter || void 0);
      const w2TeamDocs = teamViewRows(w2Details, movementTeamFilter || void 0);
      const w1Docs = filterDocsByBucket(w1TeamDocs, globalBucketFilter);
      const w2Docs = filterDocsByBucket(w2TeamDocs, globalBucketFilter);
      const movDocKey = (d) => (d.s || "") + "|" + (d.cc || "") + "|" + (d.rn || "") + "|" + (d.dn || "") + "|" + (d.dt || "");
      const currDocMap = {};
      w1Docs.forEach((d) => {
        currDocMap[movDocKey(d)] = d;
      });
      const prevDocMap = {};
      w2Docs.forEach((d) => {
        prevDocMap[movDocKey(d)] = d;
      });
      const allDocKeys = /* @__PURE__ */ new Set([...Object.keys(currDocMap), ...Object.keys(prevDocMap)]);
      allDocKeys.forEach((key) => {
        const curr = currDocMap[key];
        const prev = prevDocMap[key];
        let status = "";
        if (curr && !prev) {
          status = "New";
          newCount++;
        } else if (!curr && prev) {
          status = "Cleared";
          clearedCount++;
        } else {
          return;
        }
        const ref = curr || prev;
        movements.push({
          Supplier: ref.s || "",
          SupplierName: ref.sn || "",
          DocNumber: ref.dn || "",
          Reference: ref.rn || "",
          DocType: ref.dt || "",
          Owner: ref.o || "",
          Sheet: ref.sh || "",
          CompanyCode: ref.cc || "",
          Comment: ref.cm || "",
          Amount: ref.a || 0,
          status
        });
      });
      movements.sort((a, b) => Math.abs(b.Amount) - Math.abs(a.Amount));
    } else {
      const movCurrSuppliers = filterByBucket(aggregateSuppliers(w1Filtered, movementTeamFilter || void 0), globalBucketFilter);
      const movPrevSuppliers = filterByBucket(aggregateSuppliers(w2Filtered, movementTeamFilter || void 0), globalBucketFilter);
      const currMap = {};
      movCurrSuppliers.forEach((s) => {
        currMap[s.Supplier + "|" + s.CompanyCode] = s;
      });
      const prevMap = {};
      movPrevSuppliers.forEach((s) => {
        prevMap[s.Supplier + "|" + s.CompanyCode] = s;
      });
      const allKeys = /* @__PURE__ */ new Set([...Object.keys(currMap), ...Object.keys(prevMap)]);
      const bucketActive = globalBucketFilter.size > 0;
      const valOf = (s) => {
        if (!s) return 0;
        const volume = s.doc_count || s.TotalVol || 0;
        if (!bucketActive) return isValueMode ? s.TotalAmount : volume;
        return isValueMode ? sumBucketValues(s, globalBucketFilter, s.TotalAmount) : sumBucketDocs(s, globalBucketFilter, volume);
      };
      const volOf = (s) => {
        if (!s) return 0;
        const volume = s.doc_count || s.TotalVol || 0;
        return bucketActive ? sumBucketDocs(s, globalBucketFilter, volume) : volume;
      };
      allKeys.forEach((key) => {
        const curr = currMap[key];
        const prev = prevMap[key];
        const currVal = valOf(curr);
        const prevVal = valOf(prev);
        let status = "";
        if (!prev && curr) {
          status = "New";
          newCount++;
        } else if (prev && (!curr || Math.abs(currVal) === 0 && Math.abs(prevVal) > 0)) {
          status = "Cleared";
          clearedCount++;
        } else if (curr && prev) {
          const signFlipped = currVal < 0 && prevVal > 0 || currVal > 0 && prevVal < 0;
          if (signFlipped) {
            const impact = Math.abs(currVal - prevVal);
            if (impact < 0.5) {
              status = "Same";
            } else {
              status = "Increased";
              increasedCount++;
              totalIncreasedAmt += impact;
            }
          } else {
            const diff = Math.abs(currVal) - Math.abs(prevVal);
            if (diff > 0.5) {
              status = "Increased";
              increasedCount++;
              totalIncreasedAmt += diff;
            } else if (diff < -0.5) {
              status = "Decreased";
              decreasedCount++;
              totalDecreasedAmt += Math.abs(diff);
            } else {
              status = "Same";
            }
          }
        } else {
          if (!curr && !prev) return;
          status = "Same";
        }
        const ref = curr || prev;
        movements.push({
          Supplier: ref.Supplier,
          SupplierName: ref.SupplierName,
          Owner: ref.Owner,
          Sheet: ref.Sheet,
          CompanyCode: ref.CompanyCode,
          Comment: ref.Comment || "",
          prevVal,
          currVal,
          change: currVal - prevVal,
          status,
          prevBal: prev ? prev.TotalAmount : 0,
          currBal: curr ? curr.TotalAmount : 0,
          prevVol: volOf(prev),
          currVol: volOf(curr),
          Aged_0_30: curr ? curr.Aged_0_30 : 0,
          Aged_31_60: curr ? curr.Aged_31_60 : 0,
          Aged_61_90: curr ? curr.Aged_61_90 : 0,
          Aged_91_120: curr ? curr.Aged_91_120 : 0,
          Aged_121_180: curr ? curr.Aged_121_180 : 0,
          Aged_180_plus: curr ? curr.Aged_180_plus : 0,
          docs_0_30: curr ? curr.docs_0_30 || 0 : 0,
          docs_31_60: curr ? curr.docs_31_60 || 0 : 0,
          docs_61_90: curr ? curr.docs_61_90 || 0 : 0,
          docs_91_120: curr ? curr.docs_91_120 || 0 : 0,
          docs_121_180: curr ? curr.docs_121_180 || 0 : 0,
          docs_180_plus: curr ? curr.docs_180_plus || 0 : 0,
          total_overdue: curr ? curr.total_overdue || 0 : 0,
          overdueDocs: curr ? curr.overdueDocs || 0 : 0,
          Country: (curr || prev).Country || "",
          VendorCategory: (curr || prev).VendorCategory || "",
          Currency: (curr || prev).Currency || "",
          ActionDate: curr ? curr.ActionDate || "" : "",
          NextStep: curr ? curr.NextStep || "" : ""
        });
      });
      movements.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    }
    const allMovements = [...movements];
    const statusScopedMovements = movementStatusFilter ? allMovements.filter((m) => m.status === movementStatusFilter) : allMovements;
    _movementAllForCSV = Object.freeze([...statusScopedMovements]);
    const sameCount = allMovements.filter((m) => m.status === "Same").length;
    movements = statusScopedMovements.filter((m) => m.status !== "Same");
    const countFor = (status) => statusScopedMovements.filter((m) => m.status === status).length;
    const sumFor = (status) => statusScopedMovements.filter((m) => m.status === status).reduce((sum, m) => sum + Math.abs(m.change || m.Amount || 0), 0);
    newCount = countFor("New");
    clearedCount = countFor("Cleared");
    increasedCount = countFor("Increased");
    decreasedCount = countFor("Decreased");
    totalIncreasedAmt = sumFor("Increased");
    totalDecreasedAmt = sumFor("Decreased");
    const fmtMov = (v) => isValueMode || isTx ? fmt(v) : Math.round(v).toLocaleString();
    const w1Parts = movWeek1.split("-");
    const w2Parts = movWeek2.split("-");
    const w1Display = w1Parts.length === 3 ? `${w1Parts[2]}/${w1Parts[1]}/${w1Parts[0]}` : movWeek1;
    const w2Display = w2Parts.length === 3 ? `${w2Parts[2]}/${w2Parts[1]}/${w2Parts[0]}` : movWeek2;
    const entityLabel = isTx ? "Document" : "Supplier";
    document.getElementById("movementTitle").innerHTML = `<i class="fa-solid fa-arrow-right-arrow-left" style="color:var(--accent)"></i> ${entityLabel} Movement (${w1Display} vs ${w2Display})`;
    if (isTx) {
      document.getElementById("movement-kpis").innerHTML = `
            <div class="kpi-card" style="border-left-color: var(--green)">
                <div class="kpi-label" style="color:var(--green)"><i class="fa-solid fa-plus-circle"></i> New</div>
                <div class="kpi-value" style="color:var(--green)">${newCount}</div>
            </div>
            <div class="kpi-card" style="border-left-color: var(--accent)">
                <div class="kpi-label" style="color:var(--accent)"><i class="fa-solid fa-circle-check"></i> Cleared</div>
                <div class="kpi-value" style="color:var(--accent)">${clearedCount}</div>
            </div>
            <div class="kpi-card" style="border-left-color: var(--orange)">
                <div class="kpi-label" style="color:var(--orange)"><i class="fa-solid fa-arrows-up-down"></i> Net Movement</div>
                <div class="kpi-value" style="color:var(--orange)">${movements.length}</div>
                <span class="kpi-delta neutral">${movementTeamFilter || "All Teams"}</span>
            </div>
        `;
    } else {
      document.getElementById("movement-kpis").innerHTML = `
            <div class="kpi-card" style="border-left-color: var(--green)">
                <div class="kpi-label" style="color:var(--green)"><i class="fa-solid fa-plus-circle"></i> New</div>
                <div class="kpi-value" style="color:var(--green)">${newCount}</div>
            </div>
            <div class="kpi-card" style="border-left-color: var(--accent)">
                <div class="kpi-label" style="color:var(--accent)"><i class="fa-solid fa-circle-check"></i> Cleared</div>
                <div class="kpi-value" style="color:var(--accent)">${clearedCount}</div>
            </div>
            <div class="kpi-card" style="border-left-color: var(--red)">
                <div class="kpi-label" style="color:var(--red)"><i class="fa-solid fa-arrow-trend-up"></i> Increased</div>
                <div class="kpi-value" style="color:var(--red)">${increasedCount}</div>
                <span class="kpi-delta up">${fmtMov(totalIncreasedAmt)} total</span>
            </div>
            <div class="kpi-card" style="border-left-color: var(--primary)">
                <div class="kpi-label" style="color:var(--primary)"><i class="fa-solid fa-arrow-trend-down"></i> Decreased</div>
                <div class="kpi-value" style="color:var(--primary)">${decreasedCount}</div>
                <span class="kpi-delta down">${fmtMov(totalDecreasedAmt)} total</span>
            </div>
            <div class="kpi-card" style="border-left-color: var(--orange)">
                <div class="kpi-label" style="color:var(--orange)"><i class="fa-solid fa-arrows-up-down"></i> Net Movement</div>
                <div class="kpi-value" style="color:var(--orange)">${movements.length}</div>
                <span class="kpi-delta neutral">${movementTeamFilter || "All Teams"}</span>
            </div>
        `;
    }
    const movementSlice = paginateRows(movements, "movement");
    if (isTx) {
      document.getElementById("movementTable").innerHTML = movementSlice.length ? `
            <thead><tr><th>Supplier #</th><th>Name</th><th>CC</th><th>Reference</th><th>Doc #</th><th>Doc Type</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>${movementSlice.map((m) => {
        const statusBadge = m.status === "New" ? "badge-medium" : "badge-low";
        return `<tr>
                    <td class="supplier-name">${hesc(String(m.Supplier))}</td>
                    <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis">${hesc(String(m.SupplierName))}</td>
                    <td>${hesc(String(m.CompanyCode))}</td>
                    <td style="font-family:'Space Mono',monospace">${hesc(String(m.Reference))}</td>
                    <td style="font-family:'Space Mono',monospace">${hesc(String(m.DocNumber))}</td>
                    <td>${hesc(String(m.DocType))}</td>
                    <td class="amount">${fmtFull(m.Amount)}</td>
                    <td><span class="badge ${statusBadge}">${m.status}</span></td>
                </tr>`;
      }).join("")}</tbody>
        ` : '<tr><td colspan="8" class="no-data">No movement data</td></tr>';
    } else {
      const valHdr = isValueMode ? "Balance" : "Volume";
      const fmtTbl = (v) => isValueMode ? fmtFull(v) : Math.round(v).toLocaleString();
      document.getElementById("movementTable").innerHTML = movementSlice.length ? `
            <thead><tr><th>Supplier #</th><th>Name</th><th>Owner</th><th>Team</th><th>Prev ${valHdr}</th><th>Curr ${valHdr}</th><th>Change</th><th>Status</th></tr></thead>
            <tbody>${movementSlice.map((m) => {
        const statusColor = m.status === "New" ? "var(--orange)" : m.status === "Cleared" ? "var(--green)" : m.change > 0 ? "var(--red)" : "var(--green)";
        const statusBadge = m.status === "New" ? "badge-medium" : m.status === "Cleared" ? "badge-low" : m.status === "Increased" ? "badge-high" : "badge-low";
        return `<tr>
                    <td class="supplier-name">${hesc(String(m.Supplier))}</td>
                    <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis">${hesc(String(m.SupplierName))}</td>
                    <td><strong class="clickable-owner" onclick="filterByOwner('${hesc(String(m.Owner))}')">${hesc(String(m.Owner || "-"))}</strong></td>
                    <td><span class="badge badge-${hesc(String(m.Sheet || "")).toLowerCase()}">${hesc(String(m.Sheet))}</span></td>
                    <td class="amount">${fmtTbl(m.prevVal)}</td>
                    <td class="amount">${fmtTbl(m.currVal)}</td>
                    <td class="amount" style="color:${statusColor};font-weight:700">${m.change > 0 ? "+" : ""}${fmtTbl(m.change)}</td>
                    <td><span class="badge ${statusBadge}">${m.status}</span></td>
                </tr>`;
      }).join("")}</tbody>
        ` : '<tr><td colspan="8" class="no-data">No movement data</td></tr>';
    }
    renderPagination("movement", "movementPagination");
  } catch (e) {
    console.error("updateMovement error:", e);
  }
}
