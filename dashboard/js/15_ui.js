"use strict";
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    item.classList.add("active");
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    const page = item.dataset.page;
    if (page) document.getElementById(page).classList.add("active");
    if (page && (location.protocol === "http:" || location.protocol === "https:")) {
      history.replaceState(null, "", "#" + page);
    }
    window.scrollTo(0, 0);
    if (item.dataset.page === "overdue") {
      setTimeout(() => updateOverdueInsights(), 0);
    } else if (item.dataset.page === "synthetic_review") {
      setTimeout(() => updateSyntheticReview(), 0);
    } else if (item.dataset.page === "statement") {
      setTimeout(() => updateStatement(), 0);
    } else if (item.dataset.page === "storebookZr") {
      setTimeout(() => updateStorebookZr(), 0);
    } else if (item.dataset.page === "escalation") {
      setTimeout(() => updateEscalation(), 0);
    } else {
      setTimeout(() => update(), 0);
    }
  });
});
document.getElementById("weekSelector").addEventListener("change", async (e) => {
  currentWeek = e.target.value;
  movWeek1 = currentWeek;
  const idx = SORTED_WEEKS.indexOf(currentWeek);
  movWeek2 = idx >= 0 && idx < SORTED_WEEKS.length - 1 ? SORTED_WEEKS[idx + 1] : currentWeek;
  document.getElementById("movWeek1").value = movWeek1;
  document.getElementById("movWeek2").value = movWeek2;
  await populateStatusAndQueryType();
  await update();
});
document.getElementById("viewModeFilter").addEventListener("change", async (e) => {
  viewModeFilter = e.target.value;
  await update();
});
let _searchTimer = null;
document.getElementById("supplierSearch").addEventListener("input", (e) => {
  supplierSearchFilter = e.target.value.toLowerCase();
  if (_searchTimer) clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => update(), 300);
});
document.getElementById("rolPriorityFilter").addEventListener("change", async (_e) => {
  await update();
});
document.getElementById("keyPriorityFilter").addEventListener("change", async (_e) => {
  await update();
});
document.getElementById("prodTeamFilter").addEventListener("change", async (e) => {
  prodTeamFilter = e.target.value;
  await update();
});
document.getElementById("workedCategoryFilter").addEventListener("change", async (e) => {
  workedCategoryFilter = e.target.value;
  await update();
});
document.getElementById("prodDateFrom").addEventListener("change", async (e) => {
  prodDateFrom = e.target.value;
  await update();
});
document.getElementById("prodDateTo").addEventListener("change", async (e) => {
  prodDateTo = e.target.value;
  await update();
});
document.getElementById("overdueWeek1").addEventListener("change", async (e) => {
  overdueWeek1 = e.target.value;
  await updateOverdueInsights();
});
document.getElementById("overdueWeek2").addEventListener("change", async (e) => {
  overdueWeek2 = e.target.value;
  await updateOverdueInsights();
});
document.getElementById("overdueCountrySliceFilter").addEventListener("change", async (e) => {
  overdueCountrySlice = e.target.value;
  await updateOverdueInsights();
});
document.getElementById("movWeek1").addEventListener("change", async (e) => {
  movWeek1 = e.target.value;
  await updateMovement();
});
document.getElementById("movWeek2").addEventListener("change", async (e) => {
  movWeek2 = e.target.value;
  await updateMovement();
});
document.getElementById("overviewTeamFilter").addEventListener("change", async (e) => {
  overviewTeamFilter = e.target.value;
  await update();
});
document.getElementById("topSupplierBalanceType").addEventListener("change", async (e) => {
  topSupplierBalanceType = e.target.value;
  await update();
});
document.getElementById("rolBalanceTypeFilter").addEventListener("change", async (e) => {
  rolBalanceTypeFilter = e.target.value;
  await update();
});
document.getElementById("keyBalanceTypeDropdown").addEventListener("change", async (e) => {
  keyBalanceTypeFilter = e.target.value;
  setKeyBalanceType(e.target.value);
});
["synthetic_reviewDateFrom", "synthetic_reviewDateTo"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", () => {
    pageState.synthetic_review = 1;
    pageState.synthetic_reviewDupes = 1;
    pageState.synthetic_reviewErrors = 1;
    updateSyntheticReview();
  });
});
["stmtDateFrom", "stmtDateTo", "stmtCountry", "stmtRecStatus", "stmtTeam", "stmtOwner"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", () => {
    pageState.stmt = 1;
    updateStatement();
  });
});
const FILTER_DEFAULTS = [
  { global: "countryFilter", type: "set" },
  { global: "companyFilter", type: "set" },
  { global: "statusFilter", type: "set" },
  { global: "queryTypeFilter", type: "set" },
  { global: "docCategoryFilter", type: "set" },
  { global: "ownerFilter", type: "set" },
  { global: "vendorCategoryFilter", type: "set" },
  { global: "paymentBlockFilter", type: "set" },
  { global: "balanceTypeFilter", type: "set" },
  { global: "viewModeFilter", type: "string", default: "VALUE" },
  { global: "prodTeamFilter", type: "string", default: "" },
  { global: "workedCategoryFilter", type: "string", default: "" },
  { global: "prodDateFrom", type: "string", default: "" },
  { global: "prodDateTo", type: "string", default: "" },
  { global: "supplierSearchFilter", type: "string", default: "" },
  { global: "movementTeamFilter", type: "string", default: "" },
  { global: "movementStatusFilter", type: "string", default: "" },
  { global: "globalBucketFilter", type: "set" },
  { global: "overdueTeamFilter", type: "set" },
  { global: "overdueAgingFilter", type: "set" },
  { global: "overdueCountrySlice", type: "string", default: "" },
  { global: "overdueCompanyFilter", type: "set" },
  { global: "topSupplierBalanceType", type: "string", default: "ALL" },
  { global: "rolBalanceTypeFilter", type: "string", default: "ALL" },
  { global: "overviewTeamFilter", type: "string", default: "" },
  { global: "overviewTableTeamFilter", type: "string", default: "" },
  { global: "keyBalanceTypeFilter", type: "string", default: "ALL" }
];
document.getElementById("refreshFiltersBtn").addEventListener("click", async () => {
  const btn = document.getElementById("refreshFiltersBtn");
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Resetting...';
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  for (const f of FILTER_DEFAULTS) {
    window[f.global] = f.type === "set" ? /* @__PURE__ */ new Set() : f.default;
  }
  tableLimits.overview = 10;
  tableLimits.key = 10;
  tableLimits.movement = 10;
  tableLimits.rol = 10;
  tableLimits.prod = 9999;
  if (tableLimits.workedSuppliers) tableLimits.workedSuppliers = 10;
  tableLimits.resolvedCarryover = 10;
  pageState.resolvedCarryover = 1;
  document.getElementById("supplierSearch").value = "";
  document.getElementById("movTeamAll").classList.add("active");
  document.getElementById("movTeamKey").classList.remove("active");
  document.getElementById("movTeamROL").classList.remove("active");
  document.getElementById("overviewTeamFilter").value = "";
  document.getElementById("ovTableTeamAll").classList.add("active");
  document.getElementById("ovTableTeamKey").classList.remove("active");
  document.getElementById("ovTableTeamROL").classList.remove("active");
  document.getElementById("keyBtAll").classList.add("active");
  document.getElementById("keyBtDebit").classList.remove("active");
  document.getElementById("keyBtCredit").classList.remove("active");
  document.getElementById("keyBalanceTypeDropdown").value = "ALL";
  document.getElementById("keyPriorityFilter").value = "";
  document.querySelectorAll("#movStatusFilter .toggle-btn").forEach((b, i) => b.classList.toggle("active", i === 0));
  document.querySelectorAll('#countryWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
  const coDisp = document.querySelector("#countryWrap .multi-select-display");
  if (coDisp) coDisp.textContent = "All Countries";
  document.getElementById("countryWrap").classList.remove("open");
  document.querySelectorAll('#companyCodeWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
  const ccDisp = document.querySelector("#companyCodeWrap .multi-select-display");
  if (ccDisp) ccDisp.textContent = "All Companies";
  document.getElementById("companyCodeWrap").classList.remove("open");
  document.querySelectorAll('#statusWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
  const stDisp = document.querySelector("#statusWrap .multi-select-display");
  if (stDisp) stDisp.textContent = "All Statuses";
  document.getElementById("statusWrap").classList.remove("open");
  document.querySelectorAll('#queryTypeWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
  const qtDisp = document.querySelector("#queryTypeWrap .multi-select-display");
  if (qtDisp) qtDisp.textContent = "All Query Types";
  document.getElementById("queryTypeWrap").classList.remove("open");
  document.querySelectorAll('#docCategoryWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
  document.querySelector("#docCategoryWrap .multi-select-display").textContent = "All";
  document.getElementById("docCategoryWrap").classList.remove("open");
  document.querySelectorAll('#ownerWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
  const owDisp = document.querySelector("#ownerWrap .multi-select-display");
  if (owDisp) owDisp.textContent = "All Owners";
  document.getElementById("ownerWrap").classList.remove("open");
  document.querySelectorAll('#vendorCategoryWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
  const vcDisp = document.querySelector("#vendorCategoryWrap .multi-select-display");
  if (vcDisp) vcDisp.textContent = "All Categories";
  const vcWrap = document.getElementById("vendorCategoryWrap");
  if (vcWrap) vcWrap.classList.remove("open");
  document.querySelectorAll('#paymentBlockWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
  document.querySelector("#paymentBlockWrap .multi-select-display").textContent = "All";
  document.getElementById("paymentBlockWrap").classList.remove("open");
  document.querySelectorAll('#balanceTypeWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
  const btDisp = document.querySelector("#balanceTypeWrap .multi-select-display");
  if (btDisp) btDisp.textContent = "All";
  document.getElementById("balanceTypeWrap").classList.remove("open");
  document.getElementById("viewModeFilter").value = "VALUE";
  document.getElementById("prodTeamFilter").value = "";
  document.getElementById("workedCategoryFilter").value = "";
  document.getElementById("prodDateFrom").value = "";
  document.getElementById("prodDateTo").value = "";
  document.querySelectorAll('#overdueTeamWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
  document.querySelector("#overdueTeamWrap .multi-select-display").textContent = "All Teams";
  document.getElementById("overdueTeamWrap").classList.remove("open");
  document.querySelectorAll('#overdueAgingWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
  document.querySelector("#overdueAgingWrap .multi-select-display").textContent = "All Buckets";
  document.getElementById("overdueAgingWrap").classList.remove("open");
  document.getElementById("overdueCountrySliceFilter").value = "";
  document.querySelectorAll('#overdueCompanyWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
  document.querySelector("#overdueCompanyWrap .multi-select-display").textContent = "All Companies";
  document.getElementById("overdueCompanyWrap").classList.remove("open");
  document.querySelectorAll('#globalBucketWrap input[type="checkbox"]').forEach((cb) => cb.checked = false);
  document.querySelector("#globalBucketWrap .multi-select-display").textContent = "All Buckets";
  document.getElementById("globalBucketWrap").classList.remove("open");
  document.getElementById("topSupplierBalanceType").value = "ALL";
  document.getElementById("overviewPageSize").value = "10";
  document.getElementById("movementPageSize").value = "10";
  document.getElementById("rolPageSize").value = "10";
  const workedEl = document.getElementById("workedSuppliersPageSize");
  if (workedEl) workedEl.value = "10";
  document.getElementById("rolBalanceTypeFilter").value = "ALL";
  const rolPrio = document.getElementById("rolPriorityFilter");
  if (rolPrio) rolPrio.value = "";
  const prio = document.getElementById("priorityFilter");
  if (prio) prio.value = "";
  await update();
  await updateOverdueInsights();
  resetSyntheticReviewFilters();
  btn.innerHTML = '<i class="fa-solid fa-trash-can"></i> All Reset!';
  btn.style.background = "linear-gradient(135deg, var(--red), var(--orange))";
  setTimeout(() => {
    btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh Filters';
    btn.style.background = "linear-gradient(135deg, var(--accent), var(--primary))";
  }, 1500);
});
function toggleTheme() {
  const html = document.documentElement;
  const btn = document.getElementById("themeToggleBtn");
  const isDark = html.getAttribute("data-theme") === "dark";
  const newTheme = isDark ? "light" : "dark";
  html.setAttribute("data-theme", newTheme);
  try {
    localStorage.setItem("rol_dashboard_theme", newTheme);
  } catch (_e) {
  }
  if (btn) {
    if (newTheme === "dark") {
      btn.textContent = "";
      btn.style.background = "rgba(30,41,59,0.85)";
      btn.style.borderColor = "rgba(255,255,255,0.1)";
    } else {
      btn.textContent = "";
      btn.style.background = "rgba(255,255,255,0.9)";
      btn.style.borderColor = "rgba(128,128,128,0.3)";
    }
  }
  applyChartDefaults();
  setTimeout(() => {
    if (typeof update === "function") update();
  }, 50);
}
(function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem("rol_dashboard_theme");
  } catch (_e) {
  }
  const html = document.documentElement;
  const btn = document.getElementById("themeToggleBtn");
  if (!btn) return;
  if (saved === "modern") saved = "dark";
  if (saved === "classic") saved = "light";
  const theme = saved || "light";
  html.setAttribute("data-theme", theme);
  if (theme === "dark") {
    btn.textContent = "";
    btn.style.background = "rgba(30,41,59,0.85)";
    btn.style.borderColor = "rgba(255,255,255,0.1)";
  } else {
    btn.textContent = "";
    btn.style.background = "rgba(255,255,255,0.9)";
    btn.style.borderColor = "rgba(128,128,128,0.3)";
  }
})();
let resizeTimeout = null;
let lastWidth = window.innerWidth;
let lastHeight = window.innerHeight;
function handleResize() {
  if (resizeTimeout) clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const newWidth = window.innerWidth;
    const newHeight = window.innerHeight;
    if (Math.abs(newWidth - lastWidth) > 50 || Math.abs(newHeight - lastHeight) > 50) {
      lastWidth = newWidth;
      lastHeight = newHeight;
      Object.values(charts).forEach((c) => {
        try {
          if (c && typeof c.resize === "function") c.resize();
        } catch (_) {
        }
      });
    }
  }, 250);
}
window.addEventListener("resize", handleResize);
document.addEventListener("click", (e) => {
  document.querySelectorAll(".multi-select-wrap.open").forEach((w) => {
    if (!w.contains(e.target)) w.classList.remove("open");
  });
});
function _loadHealthBadge() {
  if (location.protocol === "file:") return;
  fetch("status.json").then((r) => r.ok ? r.json() : null).then((data) => {
    if (!data) return;
    const footer = document.querySelector(".sidebar-footer");
    if (!footer) return;
    const isOk = data.overall === "ok";
    const color = isOk ? "#28a745" : "#ffc107";
    const icon = isOk ? "" : "";
    const label = isOk ? "Data OK" : "Data Stale";
    const details = Object.entries(data.checks || {}).map(([k, v]) => {
      const s = v.ok ? "OK" : "STALE";
      const age = v.age_hours != null ? v.age_hours + "h" : "N/A";
      return k.replace("_", " ") + ": " + s + " (" + age + ")";
    }).join("\n");
    const badge = document.createElement("span");
    badge.style.cssText = "margin-left:8px;padding:2px 6px;border-radius:4px;font-size:11px;cursor:help;color:#fff;background:" + color;
    badge.textContent = icon + " " + label;
    badge.title = "Health Check: " + data.checked_at + "\n" + details;
    footer.appendChild(badge);
  }).catch(() => {
  });
}
