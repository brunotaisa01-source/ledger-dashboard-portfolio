"use strict";
async function filterByOwner(owner) {
  try {
    ownerFilter.clear();
    ownerFilter.add(owner);
    document.querySelectorAll('#ownerWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = cb.value === owner;
    });
    const disp = document.querySelector("#ownerWrap .multi-select-display");
    if (disp) disp.textContent = owner;
    await update();
    const activePage = document.querySelector(".page.active");
    const table = activePage ? activePage.querySelector(".table-container") : null;
    if (table) table.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error("filterByOwner failed:", err);
  }
}
async function filterByCompany(cc) {
  try {
    companyFilter.clear();
    companyFilter.add(cc);
    document.querySelectorAll('#companyCodeWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = cb.value === cc;
    });
    const disp = document.querySelector("#companyCodeWrap .multi-select-display");
    if (disp) disp.textContent = cc;
    await update();
  } catch (err) {
    console.error("filterByCompany failed:", err);
  }
}
async function setKeyBalanceType(type) {
  try {
    keyBalanceTypeFilter = type;
    document.getElementById("keyBtAll").classList.toggle("active", type === "ALL");
    document.getElementById("keyBtDebit").classList.toggle("active", type === "DEBIT");
    document.getElementById("keyBtCredit").classList.toggle("active", type === "CREDIT");
    const dd = document.getElementById("keyBalanceTypeDropdown");
    if (dd) dd.value = type;
    await update();
  } catch (err) {
    console.error("setKeyBalanceType failed:", err);
  }
}
async function setOverviewTableTeam(team) {
  try {
    overviewTableTeamFilter = team;
    document.getElementById("ovTableTeamAll").classList.toggle("active", team === "");
    document.getElementById("ovTableTeamKey").classList.toggle("active", team === "KEY");
    document.getElementById("ovTableTeamROL").classList.toggle("active", team === "ROL");
    await update();
  } catch (err) {
    console.error("setOverviewTableTeam failed:", err);
  }
}
async function toggleOverdueTeam(cb) {
  try {
    if (cb.checked) overdueTeamFilter.add(cb.value);
    else overdueTeamFilter.delete(cb.value);
    const disp = document.querySelector("#overdueTeamWrap .multi-select-display");
    disp.textContent = overdueTeamFilter.size === 0 ? "All Teams" : [...overdueTeamFilter].sort().join(", ");
    await updateOverdueInsights();
  } catch (err) {
    console.error("toggleOverdueTeam failed:", err);
  }
}
async function clearOverdueTeam() {
  try {
    overdueTeamFilter.clear();
    document.querySelectorAll('#overdueTeamWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
    document.querySelector("#overdueTeamWrap .multi-select-display").textContent = "All Teams";
    document.getElementById("overdueTeamWrap").classList.remove("open");
    await updateOverdueInsights();
  } catch (err) {
    console.error("clearOverdueTeam failed:", err);
  }
}
async function setMovementTeam(team) {
  try {
    movementTeamFilter = team;
    document.getElementById("movTeamAll").classList.toggle("active", team === "");
    document.getElementById("movTeamKey").classList.toggle("active", team === "KEY");
    document.getElementById("movTeamROL").classList.toggle("active", team === "ROL");
    await updateMovement();
  } catch (err) {
    console.error("setMovementTeam failed:", err);
  }
}
async function setMovementStatus(status) {
  try {
    movementStatusFilter = status;
    document.querySelectorAll("#movStatusFilter .toggle-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.status === status);
    });
    await updateMovement();
  } catch (err) {
    console.error("setMovementStatus failed:", err);
  }
}
function exportTableCSV(tableId, filename) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const rows = table.querySelectorAll("tr");
  if (!rows.length) return;
  let csv = "\uFEFF";
  rows.forEach((row) => {
    const cells = row.querySelectorAll("th, td");
    const rowData = [];
    cells.forEach((cell) => {
      let text = cell.innerText.replace(/"/g, '""');
      rowData.push('"' + text + '"');
    });
    csv += rowData.join(",") + "\r\n";
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename || "export.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}
async function toggleTable(page, n, evt) {
  try {
    tableLimits[page] = n;
    const btns = evt.target.closest(".table-controls").querySelectorAll(".toggle-btn:not([title])");
    btns.forEach((b) => b.classList.remove("active"));
    evt.target.classList.add("active");
    await update();
  } catch (err) {
    console.error("toggleTable failed:", err);
  }
}
const DC_LABELS = { PAYMENT: "Payment", INVOICE: "Invoice", CREDIT_NOTE: "Credit Note" };
async function toggleDocCategory(cb) {
  try {
    if (cb.checked) docCategoryFilter.add(cb.value);
    else docCategoryFilter.delete(cb.value);
    const disp = document.querySelector("#docCategoryWrap .multi-select-display");
    disp.textContent = docCategoryFilter.size === 0 ? "All" : [...docCategoryFilter].map((v) => DC_LABELS[v] || v).join(", ");
    await update();
  } catch (err) {
    console.error("toggleDocCategory failed:", err);
  }
}
async function clearDocCategory() {
  try {
    docCategoryFilter.clear();
    document.querySelectorAll('#docCategoryWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
    document.querySelector("#docCategoryWrap .multi-select-display").textContent = "All";
    document.getElementById("docCategoryWrap").classList.remove("open");
    await update();
  } catch (err) {
    console.error("clearDocCategory failed:", err);
  }
}
async function selectAllDocCategory() {
  try {
    docCategoryFilter.clear();
    document.querySelectorAll('#docCategoryWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
      docCategoryFilter.add(cb.value);
    });
    document.querySelector("#docCategoryWrap .multi-select-display").textContent = "All";
    await update();
  } catch (err) {
    console.error("selectAllDocCategory failed:", err);
  }
}
async function togglePaymentBlock(cb) {
  try {
    if (cb.checked) paymentBlockFilter.add(cb.value);
    else paymentBlockFilter.delete(cb.value);
    const disp = document.querySelector("#paymentBlockWrap .multi-select-display");
    disp.textContent = paymentBlockFilter.size === 0 ? "All" : [...paymentBlockFilter].join(", ");
    await update();
  } catch (err) {
    console.error("togglePaymentBlock failed:", err);
  }
}
async function clearPaymentBlock() {
  try {
    paymentBlockFilter.clear();
    document.querySelectorAll('#paymentBlockWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
    document.querySelector("#paymentBlockWrap .multi-select-display").textContent = "All";
    document.getElementById("paymentBlockWrap").classList.remove("open");
    await update();
  } catch (err) {
    console.error("clearPaymentBlock failed:", err);
  }
}
async function selectAllPaymentBlock() {
  try {
    paymentBlockFilter.clear();
    document.querySelectorAll('#paymentBlockWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
      paymentBlockFilter.add(cb.value);
    });
    document.querySelector("#paymentBlockWrap .multi-select-display").textContent = "All";
    await update();
  } catch (err) {
    console.error("selectAllPaymentBlock failed:", err);
  }
}
async function toggleVendorCategory(cb) {
  try {
    if (cb.checked) vendorCategoryFilter.add(cb.value);
    else vendorCategoryFilter.delete(cb.value);
    const disp = document.querySelector("#vendorCategoryWrap .multi-select-display");
    if (disp) {
      disp.textContent = vendorCategoryFilter.size === 0 ? "All Categories" : [...vendorCategoryFilter].join(", ");
    }
    await update();
  } catch (err) {
    console.error("toggleVendorCategory failed:", err);
  }
}
async function clearVendorCategory() {
  try {
    vendorCategoryFilter.clear();
    document.querySelectorAll('#vendorCategoryWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
    const disp = document.querySelector("#vendorCategoryWrap .multi-select-display");
    if (disp) disp.textContent = "All Categories";
    const wrap = document.getElementById("vendorCategoryWrap");
    if (wrap) wrap.classList.remove("open");
    await update();
  } catch (err) {
    console.error("clearVendorCategory failed:", err);
  }
}
async function selectAllVendorCategory() {
  try {
    vendorCategoryFilter.clear();
    document.querySelectorAll('#vendorCategoryWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
      vendorCategoryFilter.add(cb.value);
    });
    const disp = document.querySelector("#vendorCategoryWrap .multi-select-display");
    if (disp) disp.textContent = "All Categories";
    await update();
  } catch (err) {
    console.error("selectAllVendorCategory failed:", err);
  }
}
const BUCKET_LABELS = { "NOT_OVERDUE": "Not Overdue", "ALL_OVERDUE": "All Overdue", "0-30": "0-30", "31-60": "31-60", "61-90": "61-90", "91-120": "91-120", "121-180": "121-180", "180+": "180+" };
async function toggleGlobalBucket(cb) {
  try {
    if (cb.checked) globalBucketFilter.add(cb.value);
    else globalBucketFilter.delete(cb.value);
    const disp = document.querySelector("#globalBucketWrap .multi-select-display");
    disp.textContent = globalBucketFilter.size === 0 ? "All Buckets" : [...globalBucketFilter].map((v) => BUCKET_LABELS[v] || v).join(", ");
    await update();
  } catch (err) {
    console.error("toggleGlobalBucket failed:", err);
  }
}
async function clearGlobalBucket() {
  try {
    globalBucketFilter.clear();
    document.querySelectorAll('#globalBucketWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
    document.querySelector("#globalBucketWrap .multi-select-display").textContent = "All Buckets";
    document.getElementById("globalBucketWrap").classList.remove("open");
    await update();
  } catch (err) {
    console.error("clearGlobalBucket failed:", err);
  }
}
async function selectAllGlobalBucket() {
  try {
    globalBucketFilter.clear();
    document.querySelectorAll('#globalBucketWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
      globalBucketFilter.add(cb.value);
    });
    document.querySelector("#globalBucketWrap .multi-select-display").textContent = "All Buckets";
    await update();
  } catch (err) {
    console.error("selectAllGlobalBucket failed:", err);
  }
}
const AGING_LABELS = BUCKET_LABELS;
async function toggleOverdueAging(cb) {
  try {
    if (cb.checked) overdueAgingFilter.add(cb.value);
    else overdueAgingFilter.delete(cb.value);
    const disp = document.querySelector("#overdueAgingWrap .multi-select-display");
    disp.textContent = overdueAgingFilter.size === 0 ? "All Buckets" : [...overdueAgingFilter].map((v) => AGING_LABELS[v] || v).join(", ");
    await updateOverdueInsights();
  } catch (err) {
    console.error("toggleOverdueAging failed:", err);
  }
}
async function clearOverdueAging() {
  try {
    overdueAgingFilter.clear();
    document.querySelectorAll('#overdueAgingWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
    document.querySelector("#overdueAgingWrap .multi-select-display").textContent = "All Buckets";
    document.getElementById("overdueAgingWrap").classList.remove("open");
    await updateOverdueInsights();
  } catch (err) {
    console.error("clearOverdueAging failed:", err);
  }
}
async function selectAllOverdueAging() {
  try {
    overdueAgingFilter.clear();
    document.querySelectorAll('#overdueAgingWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
      overdueAgingFilter.add(cb.value);
    });
    document.querySelector("#overdueAgingWrap .multi-select-display").textContent = "All Buckets";
    await updateOverdueInsights();
  } catch (err) {
    console.error("selectAllOverdueAging failed:", err);
  }
}
async function toggleOverdueCompany(cb) {
  try {
    if (cb.checked) overdueCompanyFilter.add(cb.value);
    else overdueCompanyFilter.delete(cb.value);
    const disp = document.querySelector("#overdueCompanyWrap .multi-select-display");
    disp.textContent = overdueCompanyFilter.size === 0 ? "All Companies" : [...overdueCompanyFilter].sort().join(", ");
    await updateOverdueInsights();
  } catch (err) {
    console.error("toggleOverdueCompany failed:", err);
  }
}
async function clearOverdueCompany() {
  try {
    overdueCompanyFilter.clear();
    document.querySelectorAll('#overdueCompanyWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
    document.querySelector("#overdueCompanyWrap .multi-select-display").textContent = "All Companies";
    document.getElementById("overdueCompanyWrap").classList.remove("open");
    await updateOverdueInsights();
  } catch (err) {
    console.error("clearOverdueCompany failed:", err);
  }
}
async function selectAllOverdueCompany() {
  try {
    overdueCompanyFilter.clear();
    document.querySelectorAll('#overdueCompanyWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
      overdueCompanyFilter.add(cb.value);
    });
    document.querySelector("#overdueCompanyWrap .multi-select-display").textContent = "All Companies";
    await updateOverdueInsights();
  } catch (err) {
    console.error("selectAllOverdueCompany failed:", err);
  }
}
async function selectAllOverdueTeam() {
  try {
    overdueTeamFilter.clear();
    document.querySelectorAll('#overdueTeamWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
      overdueTeamFilter.add(cb.value);
    });
    document.querySelector("#overdueTeamWrap .multi-select-display").textContent = "All Teams";
    await updateOverdueInsights();
  } catch (err) {
    console.error("selectAllOverdueTeam failed:", err);
  }
}
async function toggleCountry(cb) {
  try {
    if (cb.checked) countryFilter.add(cb.value);
    else countryFilter.delete(cb.value);
    const disp = document.querySelector("#countryWrap .multi-select-display");
    if (disp) disp.textContent = countryFilter.size === 0 ? "All Countries" : [...countryFilter].sort().join(", ");
    await update();
  } catch (err) {
    console.error("toggleCountry failed:", err);
  }
}
async function clearCountry() {
  try {
    countryFilter.clear();
    document.querySelectorAll('#countryWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
    const disp = document.querySelector("#countryWrap .multi-select-display");
    if (disp) disp.textContent = "All Countries";
    document.getElementById("countryWrap").classList.remove("open");
    await update();
  } catch (err) {
    console.error("clearCountry failed:", err);
  }
}
async function selectAllCountry() {
  try {
    countryFilter.clear();
    document.querySelectorAll('#countryWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
      countryFilter.add(cb.value);
    });
    const disp = document.querySelector("#countryWrap .multi-select-display");
    if (disp) disp.textContent = "All Countries";
    await update();
  } catch (err) {
    console.error("selectAllCountry failed:", err);
  }
}
async function toggleCompanyCode(cb) {
  try {
    if (cb.checked) companyFilter.add(cb.value);
    else companyFilter.delete(cb.value);
    const disp = document.querySelector("#companyCodeWrap .multi-select-display");
    if (disp) disp.textContent = companyFilter.size === 0 ? "All Companies" : [...companyFilter].sort().join(", ");
    await update();
  } catch (err) {
    console.error("toggleCompanyCode failed:", err);
  }
}
async function clearCompanyCode() {
  try {
    companyFilter.clear();
    document.querySelectorAll('#companyCodeWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
    const disp = document.querySelector("#companyCodeWrap .multi-select-display");
    if (disp) disp.textContent = "All Companies";
    document.getElementById("companyCodeWrap").classList.remove("open");
    await update();
  } catch (err) {
    console.error("clearCompanyCode failed:", err);
  }
}
async function selectAllCompanyCode() {
  try {
    companyFilter.clear();
    document.querySelectorAll('#companyCodeWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
      companyFilter.add(cb.value);
    });
    const disp = document.querySelector("#companyCodeWrap .multi-select-display");
    if (disp) disp.textContent = "All Companies";
    await update();
  } catch (err) {
    console.error("selectAllCompanyCode failed:", err);
  }
}
async function toggleOwner(cb) {
  try {
    if (cb.checked) ownerFilter.add(cb.value);
    else ownerFilter.delete(cb.value);
    const disp = document.querySelector("#ownerWrap .multi-select-display");
    if (disp) disp.textContent = ownerFilter.size === 0 ? "All Owners" : [...ownerFilter].sort().join(", ");
    await update();
  } catch (err) {
    console.error("toggleOwner failed:", err);
  }
}
async function clearOwner() {
  try {
    ownerFilter.clear();
    document.querySelectorAll('#ownerWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
    const disp = document.querySelector("#ownerWrap .multi-select-display");
    if (disp) disp.textContent = "All Owners";
    document.getElementById("ownerWrap").classList.remove("open");
    await update();
  } catch (err) {
    console.error("clearOwner failed:", err);
  }
}
async function selectAllOwner() {
  try {
    ownerFilter.clear();
    document.querySelectorAll('#ownerWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
      ownerFilter.add(cb.value);
    });
    const disp = document.querySelector("#ownerWrap .multi-select-display");
    if (disp) disp.textContent = "All Owners";
    await update();
  } catch (err) {
    console.error("selectAllOwner failed:", err);
  }
}
async function toggleStatus(cb) {
  try {
    if (cb.checked) statusFilter.add(cb.value);
    else statusFilter.delete(cb.value);
    const disp = document.querySelector("#statusWrap .multi-select-display");
    if (disp) disp.textContent = statusFilter.size === 0 ? "All Statuses" : [...statusFilter].sort().join(", ");
    await update();
  } catch (err) {
    console.error("toggleStatus failed:", err);
  }
}
async function clearStatus() {
  try {
    statusFilter.clear();
    document.querySelectorAll('#statusWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
    const disp = document.querySelector("#statusWrap .multi-select-display");
    if (disp) disp.textContent = "All Statuses";
    document.getElementById("statusWrap").classList.remove("open");
    await update();
  } catch (err) {
    console.error("clearStatus failed:", err);
  }
}
async function selectAllStatus() {
  try {
    statusFilter.clear();
    document.querySelectorAll('#statusWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
      statusFilter.add(cb.value);
    });
    const disp = document.querySelector("#statusWrap .multi-select-display");
    if (disp) disp.textContent = "All Statuses";
    await update();
  } catch (err) {
    console.error("selectAllStatus failed:", err);
  }
}
async function toggleQueryType(cb) {
  try {
    if (cb.checked) queryTypeFilter.add(cb.value);
    else queryTypeFilter.delete(cb.value);
    const disp = document.querySelector("#queryTypeWrap .multi-select-display");
    if (disp) disp.textContent = queryTypeFilter.size === 0 ? "All Query Types" : [...queryTypeFilter].sort().join(", ");
    await update();
  } catch (err) {
    console.error("toggleQueryType failed:", err);
  }
}
async function clearQueryType() {
  try {
    queryTypeFilter.clear();
    document.querySelectorAll('#queryTypeWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
    const disp = document.querySelector("#queryTypeWrap .multi-select-display");
    if (disp) disp.textContent = "All Query Types";
    document.getElementById("queryTypeWrap").classList.remove("open");
    await update();
  } catch (err) {
    console.error("clearQueryType failed:", err);
  }
}
async function selectAllQueryType() {
  try {
    queryTypeFilter.clear();
    document.querySelectorAll('#queryTypeWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
      queryTypeFilter.add(cb.value);
    });
    const disp = document.querySelector("#queryTypeWrap .multi-select-display");
    if (disp) disp.textContent = "All Query Types";
    await update();
  } catch (err) {
    console.error("selectAllQueryType failed:", err);
  }
}
async function toggleBalanceType(cb) {
  try {
    if (cb.checked) balanceTypeFilter.add(cb.value);
    else balanceTypeFilter.delete(cb.value);
    const disp = document.querySelector("#balanceTypeWrap .multi-select-display");
    if (disp) disp.textContent = balanceTypeFilter.size === 0 ? "All" : [...balanceTypeFilter].sort().join(", ");
    await update();
  } catch (err) {
    console.error("toggleBalanceType failed:", err);
  }
}
async function clearBalanceType() {
  try {
    balanceTypeFilter.clear();
    document.querySelectorAll('#balanceTypeWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
    const disp = document.querySelector("#balanceTypeWrap .multi-select-display");
    if (disp) disp.textContent = "All";
    document.getElementById("balanceTypeWrap").classList.remove("open");
    await update();
  } catch (err) {
    console.error("clearBalanceType failed:", err);
  }
}
async function selectAllBalanceType() {
  try {
    balanceTypeFilter.clear();
    document.querySelectorAll('#balanceTypeWrap input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
      balanceTypeFilter.add(cb.value);
    });
    const disp = document.querySelector("#balanceTypeWrap .multi-select-display");
    if (disp) disp.textContent = "All";
    await update();
  } catch (err) {
    console.error("selectAllBalanceType failed:", err);
  }
}
async function changePageSize(tableKey, n) {
  try {
    tableLimits[tableKey] = n;
    pageState[tableKey] = 1;
    _paginating = true;
    await update();
    _paginating = false;
  } catch (err) {
    console.error("changePageSize failed:", err);
  }
}
function paginateRows(allRows, tableKey) {
  pageData[tableKey] = allRows;
  const perPage = tableLimits[tableKey] || 10;
  const page = pageState[tableKey] || 1;
  const start = (page - 1) * perPage;
  return allRows.slice(start, start + perPage);
}
function buildPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push("...");
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}
function renderPagination(tableKey, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const allData = pageData[tableKey] || [];
  const perPage = tableLimits[tableKey] || 10;
  const totalPages = Math.ceil(allData.length / perPage);
  const page = pageState[tableKey] || 1;
  if (totalPages <= 1) {
    container.innerHTML = allData.length ? `<span class="pg-info">${allData.length} row${allData.length !== 1 ? "s" : ""} total</span>` : "";
    return;
  }
  let html = "";
  html += `<button ${page === 1 ? "disabled" : ""} onclick="goToPage('${tableKey}', ${page - 1})"><i class="fa-solid fa-chevron-left"></i></button>`;
  const nums = buildPageNumbers(page, totalPages);
  nums.forEach((p) => {
    if (p === "...") {
      html += `<span style="padding:0 0.3rem;color:var(--text-muted)">...</span>`;
    } else {
      html += `<button class="${p === page ? "pg-active" : ""}" onclick="goToPage('${tableKey}', ${p})">${p}</button>`;
    }
  });
  html += `<button ${page === totalPages ? "disabled" : ""} onclick="goToPage('${tableKey}', ${page + 1})"><i class="fa-solid fa-chevron-right"></i></button>`;
  html += `<span class="pg-info">Page ${page} of ${totalPages} (${allData.length} rows)</span>`;
  container.innerHTML = html;
}
async function goToPage(tableKey, pageNum) {
  try {
    const allData = pageData[tableKey] || [];
    const perPage = tableLimits[tableKey] || 10;
    const totalPages = Math.ceil(allData.length / perPage);
    if (pageNum < 1 || pageNum > totalPages) return;
    pageState[tableKey] = pageNum;
    if (tableKey === "synthetic_reviewDupes" || tableKey === "synthetic_reviewErrors") {
      if (synthetic_reviewData && synthetic_reviewData.rows) {
        const filtered = applySyntheticReviewFilters(synthetic_reviewData.rows);
        renderSyntheticReviewTable(filtered);
      }
      return;
    }
    if (tableKey === "stmtNoStmt") {
      if (stmtCoverageCache) renderNoStmtTable(stmtCoverageCache.uncoveredSuppliers);
      return;
    }
    if (tableKey === "stmt") {
      if (stmtData && stmtData.rows) renderStatementTable(applyStatementFilters(stmtData.rows));
      return;
    }
    if (tableKey === "movement") {
      await updateMovement();
      return;
    }
    _paginating = true;
    try {
      await update();
    } finally {
      _paginating = false;
    }
  } catch (err) {
    console.error("goToPage failed:", err);
  }
}
function exportWorkedSuppliersCSV() {
  const all = pageData["workedSuppliers"] || [];
  if (!all.length) return;
  if (viewModeFilter === "TRANSACTIONS") {
    exportCSV({
      filename: "worked_documents.csv",
      getRows: () => all,
      columns: [
        { header: "Supplier #", value: (d) => d.s },
        { header: "Name", value: (d) => d.sn },
        { header: "CC", value: (d) => d.cc },
        { header: "Reference", value: (d) => d.rn },
        { header: "Doc #", value: (d) => d.dn },
        { header: "Doc Type", value: (d) => d.dt },
        { header: "Amount", value: (d) => (d.a || 0).toFixed(2) },
        { header: "Owner", value: (d) => d.o },
        { header: "Country", value: (d) => d.co },
        { header: "Category", value: (d) => d.vc },
        { header: "Comment", value: (d) => d.cm }
      ]
    });
    return;
  }
  exportCSV({
    filename: "worked_suppliers.csv",
    getRows: () => all,
    columns: [
      { header: "Supplier #", value: (s) => s.supplier },
      { header: "Name", value: (s) => s.name || "" },
      { header: "Owner", value: (s) => s.owner },
      { header: "CC", value: (s) => s.cc },
      { header: "Country", value: (s) => s.co },
      { header: "Category", value: (s) => s.vc },
      { header: "Docs", value: (s) => s.docs },
      { header: "Amount Worked", value: (s) => s.amount.toFixed(2) },
      { header: "Change", value: (s) => s.change.toFixed(2) },
      { header: "Status", value: (s) => s.change > 0.5 ? "Worse" : s.change < -0.5 ? "Better" : "Stable" },
      { header: "Comments", value: (s) => [...s.comments].join(" | ") }
    ]
  });
}
function exportResolvedCarryoverCSV() {
  const all = pageData["resolvedCarryover"] || [];
  if (!all.length) return;
  const modeSelect = document.getElementById("resolvedCarryoverMode");
  const auditMode = modeSelect?.value === "snapshot" ? "Snapshot carryover" : "Actioned only";
  exportCSV({
    filename: modeSelect?.value === "snapshot" ? "resolved_snapshot_carryover_audit.csv" : "resolved_actioned_carryover_audit.csv",
    getRows: () => all,
    columns: [
      { header: "Audit Mode", value: () => auditMode },
      { header: "Resolved Week", value: (r) => r.rw },
      { header: "Present Week", value: (r) => r.pw },
      { header: "Actioned In Week", value: (r) => (r.act || 0) === 1 ? "Yes" : "No" },
      { header: "Source", value: (r) => r.src },
      { header: "Present Source", value: (r) => r.psrc },
      { header: "Team", value: (r) => r.team },
      { header: "Present Team", value: (r) => r.pteam },
      { header: "Owner", value: (r) => r.o },
      { header: "Present Owner", value: (r) => r.po },
      { header: "Company Code", value: (r) => r.cc },
      { header: "Supplier", value: (r) => r.s },
      { header: "Supplier Name", value: (r) => r.sn },
      { header: "Country", value: (r) => r.co },
      { header: "Document Number", value: (r) => r.dn },
      { header: "Reference", value: (r) => r.rn },
      { header: "Document Type", value: (r) => r.dt },
      { header: "Amount", value: (r) => (r.a || 0).toFixed(2) },
      { header: "Amount Key", value: (r) => r.mk || "" },
      { header: "Match Reason", value: (r) => r.mr || "" },
      { header: "Currency", value: (r) => r.cur },
      { header: "Status Marked", value: (r) => r.st },
      { header: "Action Date", value: (r) => r.ad },
      { header: "Query Type", value: (r) => r.qt },
      { header: "Comment", value: (r) => r.cm },
      { header: "Next Step", value: (r) => r.ns },
      { header: "Category", value: (r) => r.vc },
      { header: "Confidence", value: (r) => r.conf },
      { header: "Line Count", value: (r) => r.lc },
      { header: "Present Line Count", value: (r) => r.plc },
      { header: "Present Amount", value: (r) => (r.pa || 0).toFixed(2) },
      { header: "Amount Difference", value: (r) => (r.adiff || 0).toFixed(2) }
    ]
  });
}
function exportProductivityScorecardCSV() {
  const all = pageData["productivityScorecard"] || [];
  if (!all.length) return;
  exportCSV({
    filename: "productivity_scorecard.csv",
    getRows: () => all,
    columns: [
      { header: "Owner", value: (r) => r.owner },
      { header: "Week", value: (r) => r.week },
      { header: "Source", value: (r) => r.source },
      { header: "Action-date Resolved", value: (r) => r.aged_items_cleared },
      { header: "Resolved Value", value: (r) => (r.value_cleared || 0).toFixed(2) },
      { header: "Vendor Reviews Completed", value: (r) => r.vendor_reviews_completed },
      { header: "Comments Updated", value: (r) => r.comments_updated },
      { header: "Blockers Raised", value: (r) => r.blockers_raised },
      { header: "RAG Green", value: (r) => r.rag_green },
      { header: "RAG Amber", value: (r) => r.rag_amber },
      { header: "RAG Red", value: (r) => r.rag_red },
      { header: "RAG Blocker", value: (r) => r.rag_blocker },
      { header: "RAG Total", value: (r) => r.rag_total }
    ]
  });
}
async function exportFilteredCSV(tableKey, tableId, filename) {
  try {
    const allData = pageData[tableKey] || [];
    if (!allData.length) {
      exportTableCSV(tableId, filename);
      return;
    }
    const savedPerPage = tableLimits[tableKey];
    const savedPage = pageState[tableKey];
    tableLimits[tableKey] = 999999;
    pageState[tableKey] = 1;
    _paginating = true;
    await update();
    exportTableCSV(tableId, filename);
    tableLimits[tableKey] = savedPerPage;
    pageState[tableKey] = savedPage;
    await update();
    _paginating = false;
  } catch (err) {
    console.error("exportFilteredCSV failed:", err);
  }
}
function downloadCSV(csv, filename) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
function esc(v) {
  return String(v ?? "").replace(/"/g, '""');
}
function bucketShown(bucket) {
  if (globalBucketFilter.size === 0) return true;
  if (globalBucketFilter.has(bucket)) return true;
  if (globalBucketFilter.has("ALL_OVERDUE")) return true;
  return false;
}
const EXPORT_AGING_BUCKETS = [
  { bucket: "0-30", label: "0-30 Days", docsKey: "docs_0_30", valueKey: "Aged_0_30" },
  { bucket: "31-60", label: "31-60 Days", docsKey: "docs_31_60", valueKey: "Aged_31_60" },
  { bucket: "61-90", label: "61-90 Days", docsKey: "docs_61_90", valueKey: "Aged_61_90" },
  { bucket: "91-120", label: "91-120 Days", docsKey: "docs_91_120", valueKey: "Aged_91_120" },
  { bucket: "121-180", label: "121-180 Days", docsKey: "docs_121_180", valueKey: "Aged_121_180" },
  { bucket: "180+", label: "180+ Days", docsKey: "docs_180_plus", valueKey: "Aged_180_plus" }
];
function exportBucketColumns() {
  return EXPORT_AGING_BUCKETS.filter((b) => bucketShown(b.bucket)).flatMap((b) => [
    { header: b.label + " Vol", value: (row) => row[b.docsKey] || 0 },
    { header: b.label + " Value", value: (row) => (row[b.valueKey] || 0).toFixed(2) }
  ]);
}
function exportCSV({ filename, dataKey, columns, getRows }) {
  const rows = getRows ? getRows() : dataKey ? pageData[dataKey] || [] : [];
  if (!rows.length) return;
  let csv = columns.map((c) => `"${c.header}"`).join(",") + "\r\n";
  for (const row of rows) {
    csv += columns.map((c) => `"${esc(c.value(row))}"`).join(",") + "\r\n";
  }
  downloadCSV(csv, filename);
}
function exportOverviewCSV() {
  const all = pageData["overview"] || [];
  if (!all.length) return;
  if (viewModeFilter === "TRANSACTIONS") {
    exportCSV({
      filename: "overview_documents.csv",
      getRows: () => all,
      columns: [
        { header: "Supplier #", value: (d) => d.s },
        { header: "Name", value: (d) => d.sn },
        { header: "CC", value: (d) => d.cc },
        { header: "Reference", value: (d) => d.rn },
        { header: "Doc #", value: (d) => d.dn },
        { header: "Doc Type", value: (d) => d.dt },
        { header: "Amount", value: (d) => (d.a || 0).toFixed(2) },
        { header: "Owner", value: (d) => d.o },
        { header: "Team", value: (d) => d.sh },
        { header: "Country", value: (d) => d.co },
        { header: "Currency", value: (d) => d.cur },
        { header: "Comment", value: (d) => d.cm }
      ]
    });
    return;
  }
  exportCSV({
    filename: "overview_suppliers.csv",
    getRows: () => all,
    columns: [
      { header: "Supplier #", value: (s) => s.SupplierNumber },
      { header: "Name", value: (s) => s.SupplierName },
      { header: "Owner", value: (s) => s.Owner },
      { header: "Team", value: (s) => s.Sheet },
      { header: "Country", value: (s) => s.Country },
      { header: "Category", value: (s) => s.VendorCategory || "" },
      { header: "Company Code", value: (s) => s.CompanyCode },
      ...exportBucketColumns(),
      { header: "Total Balance", value: (s) => (globalBucketFilter.size > 0 ? sumBucketValues(s, globalBucketFilter, s.TotalAmount) : s.TotalAmount || 0).toFixed(2) },
      { header: "Total Docs", value: (s) => globalBucketFilter.size > 0 ? sumBucketDocs(s, globalBucketFilter, s.doc_count || s.TotalVol || 0) : s.doc_count || s.TotalVol || 0 },
      { header: "Overdue Balance", value: (s) => (globalBucketFilter.size > 0 ? sumBucketValues(s, globalBucketFilter, s.total_overdue || 0) : s.total_overdue || 0).toFixed(2) },
      { header: "Overdue Docs", value: (s) => globalBucketFilter.size > 0 ? sumBucketDocs(s, globalBucketFilter, s.overdueDocs || 0) : s.overdueDocs || 0 },
      { header: "Currency", value: (s) => s.Currency },
      { header: "Action Date", value: (s) => s.ActionDate || "" },
      { header: "Comments", value: (s) => s.Comment || "" },
      { header: "Next Step", value: (s) => s.NextStep || "" }
    ]
  });
}
function movStatus(prev, curr) {
  if (prev === 0 && curr !== 0) return "New";
  if (curr === 0 && prev !== 0) return "Cleared";
  const diff = Math.abs(curr) - Math.abs(prev);
  if (diff > 0.5) return "Increased";
  if (diff < -0.5) return "Decreased";
  return "Stable";
}
function exportMovementCSV() {
  const all = typeof _movementAllForCSV !== "undefined" && _movementAllForCSV.length ? _movementAllForCSV : pageData["movement"] || [];
  if (!all.length) return;
  if (viewModeFilter === "TRANSACTIONS") {
    exportCSV({
      filename: "movement_documents.csv",
      getRows: () => all,
      columns: [
        { header: "Supplier #", value: (m) => m.Supplier },
        { header: "Name", value: (m) => m.SupplierName },
        { header: "CC", value: (m) => m.CompanyCode },
        { header: "Reference", value: (m) => m.Reference },
        { header: "Doc #", value: (m) => m.DocNumber },
        { header: "Doc Type", value: (m) => m.DocType },
        { header: "Amount", value: (m) => (m.Amount || 0).toFixed(2) },
        { header: "Status", value: (m) => m.status },
        { header: "Owner", value: (m) => m.Owner },
        { header: "Team", value: (m) => m.Sheet },
        { header: "Comment", value: (m) => m.Comment }
      ]
    });
    return;
  }
  exportCSV({
    filename: "movement.csv",
    getRows: () => all,
    columns: [
      { header: "Supplier #", value: (m) => m.Supplier },
      { header: "Name", value: (m) => m.SupplierName },
      { header: "Owner", value: (m) => m.Owner },
      { header: "Team", value: (m) => m.Sheet },
      { header: "Country", value: (m) => m.Country || "" },
      { header: "Category", value: (m) => m.VendorCategory || "" },
      { header: "Company Code", value: (m) => m.CompanyCode },
      ...exportBucketColumns(),
      { header: "Prev Balance", value: (m) => (m.prevVal || 0).toFixed(2) },
      { header: "Curr Balance", value: (m) => (m.currVal || 0).toFixed(2) },
      { header: "Change (Value)", value: (m) => (m.change || 0).toFixed(2) },
      { header: "Status (Value)", value: (m) => m.status || "" },
      { header: "Prev Volume", value: (m) => m.prevVol || 0 },
      { header: "Curr Volume", value: (m) => m.currVol || 0 },
      { header: "Change (Volume)", value: (m) => m.currVol - m.prevVol },
      { header: "Status (Volume)", value: (m) => movStatus(m.prevVol, m.currVol) },
      { header: "Total Overdue", value: (m) => (globalBucketFilter.size > 0 ? sumBucketValues(m, globalBucketFilter, m.total_overdue || 0) : m.total_overdue || 0).toFixed(2) },
      { header: "Overdue Docs", value: (m) => globalBucketFilter.size > 0 ? sumBucketDocs(m, globalBucketFilter, m.overdueDocs || 0) : m.overdueDocs || 0 },
      { header: "Currency", value: (m) => m.Currency || "" },
      { header: "Action Date", value: (m) => m.ActionDate || "" },
      { header: "Comments", value: (m) => m.Comment || "" },
      { header: "Next Step", value: (m) => m.NextStep || "" }
    ]
  });
}
function exportROLCSV() {
  const all = pageData["rol"] || [];
  if (!all.length) return;
  if (viewModeFilter === "TRANSACTIONS") {
    exportCSV({
      filename: "rol_documents.csv",
      getRows: () => all,
      columns: [
        { header: "Supplier #", value: (d) => d.s },
        { header: "Name", value: (d) => d.sn },
        { header: "CC", value: (d) => d.cc },
        { header: "Reference", value: (d) => d.rn },
        { header: "Doc #", value: (d) => d.dn },
        { header: "Doc Type", value: (d) => d.dt },
        { header: "Amount", value: (d) => (d.a || 0).toFixed(2) },
        { header: "Owner", value: (d) => d.o },
        { header: "Status", value: (d) => d.st },
        { header: "Country", value: (d) => d.co },
        { header: "Currency", value: (d) => d.cur },
        { header: "Comment", value: (d) => d.cm }
      ]
    });
    return;
  }
  exportCSV({
    filename: "rol_suppliers.csv",
    getRows: () => all,
    columns: [
      { header: "Supplier #", value: (s) => s.SupplierNumber },
      { header: "Name", value: (s) => s.SupplierName },
      { header: "Owner", value: (s) => s.Owner },
      { header: "Priority", value: (s) => s.Priority },
      { header: "Total Balance", value: (s) => (globalBucketFilter.size > 0 ? sumBucketValues(s, globalBucketFilter, s.TotalAmount) : s.TotalAmount || 0).toFixed(2) },
      { header: "Total Vol", value: (s) => globalBucketFilter.size > 0 ? sumBucketDocs(s, globalBucketFilter, s.doc_count || s.TotalVol || 0) : s.doc_count || s.TotalVol || 0 },
      { header: "Change (Value)", value: (s) => (s.change_value || 0).toFixed(2) },
      { header: "Change (Vol)", value: (s) => s.change_vol || 0 },
      { header: "Status", value: (s) => s.Status },
      { header: "Company", value: (s) => s.CompanyCode },
      { header: "Currency", value: (s) => s.Currency },
      { header: "Comments", value: (s) => s.Comment || "" }
    ]
  });
}
function exportKeyCSV() {
  const all = pageData["key"] || [];
  if (!all.length) return;
  if (viewModeFilter === "TRANSACTIONS") {
    exportCSV({
      filename: "key_documents.csv",
      getRows: () => all,
      columns: [
        { header: "Supplier #", value: (d) => d.s },
        { header: "Name", value: (d) => d.sn },
        { header: "CC", value: (d) => d.cc },
        { header: "Reference", value: (d) => d.rn },
        { header: "Doc #", value: (d) => d.dn },
        { header: "Doc Type", value: (d) => d.dt },
        { header: "Amount", value: (d) => (d.a || 0).toFixed(2) },
        { header: "Owner", value: (d) => d.o },
        { header: "Query Type", value: (d) => d.qt },
        { header: "Country", value: (d) => d.co },
        { header: "Currency", value: (d) => d.cur },
        { header: "Comment", value: (d) => d.cm }
      ]
    });
    return;
  }
  exportCSV({
    filename: "key_suppliers.csv",
    getRows: () => all,
    columns: [
      { header: "Supplier #", value: (s) => s.SupplierNumber },
      { header: "Name", value: (s) => s.SupplierName },
      { header: "Owner", value: (s) => s.Owner },
      { header: "Priority", value: (s) => s.Priority },
      { header: "Query Type", value: (s) => s.QueryType },
      { header: "Total Balance", value: (s) => (globalBucketFilter.size > 0 ? sumBucketValues(s, globalBucketFilter, s.TotalAmount) : s.TotalAmount || 0).toFixed(2) },
      { header: "Total Vol", value: (s) => globalBucketFilter.size > 0 ? sumBucketDocs(s, globalBucketFilter, s.doc_count || s.TotalVol || 0) : s.doc_count || s.TotalVol || 0 },
      { header: "Change (Value)", value: (s) => (s.change_value || 0).toFixed(2) },
      { header: "Change (Vol)", value: (s) => s.change_vol || 0 },
      { header: "Status", value: (s) => s.Status },
      { header: "Company", value: (s) => s.CompanyCode },
      { header: "Currency", value: (s) => s.Currency },
      { header: "Comments", value: (s) => s.Comment || "" }
    ]
  });
}
function exportOverdueOwnerComparisonCSV() {
  const rows = typeof _overdueOwnerCompForCSV !== "undefined" ? _overdueOwnerCompForCSV : [];
  if (!rows.length) return;
  const currentLabel = typeof _overdueOwnerCompCurrentLabel !== "undefined" ? _overdueOwnerCompCurrentLabel : "Current";
  const olderLabel = typeof _overdueOwnerCompOlderLabel !== "undefined" ? _overdueOwnerCompOlderLabel : "Older";
  exportCSV({
    filename: "overdue_owner_comparison.csv",
    getRows: () => rows,
    columns: [
      { header: "Owner", value: (r) => r.owner },
      { header: `${currentLabel} Vendors`, value: (r) => r.current_vendors },
      { header: `${olderLabel} Vendors`, value: (r) => r.older_vendors },
      { header: "Delta Vendors", value: (r) => r.delta_vendors },
      { header: `${currentLabel} Docs`, value: (r) => r.current_docs },
      { header: `${olderLabel} Docs`, value: (r) => r.older_docs },
      { header: "Delta Docs", value: (r) => r.delta_docs }
    ]
  });
}
