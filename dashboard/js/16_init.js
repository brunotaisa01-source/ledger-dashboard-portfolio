"use strict";
function initFormatWeekOption(week) {
  const parts = week.split("-");
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : week;
}
function initPopulateWeekSelect(id, weeks, preferred) {
  const select = document.getElementById(id);
  const fallback = weeks[0] || "";
  const currentValue = select?.value || "";
  const selected = preferred && weeks.includes(preferred) ? preferred : currentValue && weeks.includes(currentValue) ? currentValue : fallback;
  if (select) {
    select.innerHTML = "";
    for (const week of weeks) {
      const option = document.createElement("option");
      option.value = week;
      option.textContent = initFormatWeekOption(week);
      select.appendChild(option);
    }
    select.value = selected;
  }
  return selected;
}
function initPopulateAllWeekSelectors() {
  const weeks = Array.isArray(SORTED_WEEKS) ? SORTED_WEEKS.filter(Boolean) : [];
  if (!weeks.length) return;
  const previousWeek = weeks.length > 1 ? weeks[1] : weeks[0];
  currentWeek = initPopulateWeekSelect("weekSelector", weeks, currentWeek);
  overdueWeek1 = initPopulateWeekSelect("overdueWeek1", weeks, overdueWeek1 || currentWeek);
  overdueWeek2 = initPopulateWeekSelect("overdueWeek2", weeks, overdueWeek2 || previousWeek);
  movWeek1 = initPopulateWeekSelect("movWeek1", weeks, movWeek1 || currentWeek);
  movWeek2 = initPopulateWeekSelect("movWeek2", weeks, movWeek2 || previousWeek);
}
(async function() {
  const overlay = document.getElementById("loadingOverlay");
  const barEl = document.getElementById("loadingBar");
  const statusEl = document.getElementById("loadingStatus");
  try {
    initPopulateAllWeekSelectors();
    if (statusEl) statusEl.textContent = "Loading current week...";
    if (barEl) barEl.style.width = "30%";
    await getWeekData(SORTED_WEEKS[0]);
    if (SORTED_WEEKS.length > 1) {
      if (statusEl) statusEl.textContent = "Loading previous week...";
      if (barEl) barEl.style.width = "50%";
      await getWeekData(SORTED_WEEKS[1]);
    }
    if (statusEl) statusEl.textContent = "Rendering dashboard...";
    if (barEl) barEl.style.width = "70%";
    await populateStatusAndQueryType();
    initPopulateAllWeekSelectors();
    await update();
    if (barEl) barEl.style.width = "100%";
    if (statusEl) statusEl.textContent = "Done!";
    if (overlay) {
      setTimeout(() => {
        overlay.classList.add("hidden");
        setTimeout(() => overlay.remove(), 600);
      }, 200);
    }
    _loadHealthBadge();
  } catch (err) {
    console.error("Dashboard init error:", err);
    if (statusEl) {
      statusEl.textContent = "Error: " + (err instanceof Error ? err.message : String(err));
      statusEl.style.color = "#DC3545";
    }
    if (barEl) {
      barEl.style.width = "100%";
      barEl.style.background = "#DC3545";
    }
    if (overlay) {
      overlay.style.cursor = "pointer";
      overlay.addEventListener("click", () => overlay.remove());
    }
  }
})();
