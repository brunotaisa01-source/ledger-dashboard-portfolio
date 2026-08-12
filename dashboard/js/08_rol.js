"use strict";
async function updateROL(filtered, raw, prevRaw) {
  try {
    await updateTeamPage("ROL", filtered, raw, prevRaw);
    if (document.getElementById("rolTrendChart")) {
      await renderROLTrend("rol", filtered);
    }
  } catch (e) {
    console.error("updateROL error:", e);
  }
}
async function getTeamTrendScoped(teamIds, n) {
  if (globalBucketFilter.size === 0 && !supplierSearchFilter) return getTeamTrend(teamIds, n);
  const weeks = ((YEAR_TREND_CUBE || {}).weeks || SORTED_WEEKS).slice(-n);
  const teamSet = new Set(teamIds.map((t) => t.toUpperCase()));
  const isValueMode = viewModeFilter === "VALUE";
  const isTx = viewModeFilter === "TRANSACTIONS";
  const allWeekData = await Promise.all(weeks.map((w) => getWeekData(w)));
  return allWeekData.map((weekData) => {
    const filtered = applyFilters(weekData.raw || []);
    const headers = headerRows(filtered).filter((r) => teamSet.has((r.sh || "").toUpperCase()));
    if (isValueMode) {
      return headers.reduce((sum, r) => sum + sumRowBuckets(r, globalBucketFilter, r.tv || 0), 0);
    }
    if (isTx) {
      return filterDocsByBucket(detailRows(filtered), globalBucketFilter).filter((r) => teamSet.has((r.sh || "").toUpperCase())).length;
    }
    return headers.length;
  });
}
async function renderROLTrend(tid, filtered, teamIds = ["ROL"]) {
  try {
    const isValueMode = viewModeFilter === "VALUE";
    const isTx = viewModeFilter === "TRANSACTIONS";
    const trend = await getTeamTrendScoped(teamIds, 12);
    const canvas = document.getElementById(tid + "TrendChart");
    const badge = document.getElementById(tid + "TrendBadge");
    if (canvas && trend.length >= 2) {
      const allWeeks = (YEAR_TREND_CUBE || {}).weeks || SORTED_WEEKS;
      const trendWeeks = allWeeks.slice(Math.max(0, allWeeks.length - 12));
      const weekLabels = trendWeeks.map((w) => {
        const d = /* @__PURE__ */ new Date(w + "T00:00:00");
        const oneJan = new Date(d.getFullYear(), 0, 1);
        const wk = Math.ceil(((d.getTime() - oneJan.getTime()) / 864e5 + oneJan.getDay() + 1) / 7);
        return "W" + String(wk).padStart(2, "0") + "/" + String(d.getFullYear()).slice(-2);
      });
      const first = Math.abs(trend[0]), last = Math.abs(trend[trend.length - 1]);
      const improving = last < first;
      const pctChange = first > 0 ? ((last - first) / first * 100).toFixed(1) : "0.0";
      const trendColor = improving ? "#28A745" : "#DC3545";
      if (badge) {
        badge.textContent = (improving ? " " : " ") + Math.abs(parseFloat(pctChange)) + "%  " + (improving ? "Improving" : "Deteriorating");
        badge.style.background = trendColor + "18";
        badge.style.color = trendColor;
      }
      if (charts[tid + "Trend"]) charts[tid + "Trend"].destroy();
      charts[tid + "Trend"] = new Chart(canvas, {
        type: "line",
        data: {
          labels: weekLabels,
          datasets: [{
            label: isValueMode ? "Balance" : isTx ? "Documents" : "Suppliers",
            data: trend.map((v) => Math.abs(v)),
            borderColor: trendColor,
            backgroundColor: trendColor + "20",
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            pointBackgroundColor: trendColor,
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            datalabels: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => isValueMode ? fmt(ctx.parsed.y) : ctx.parsed.y.toLocaleString()
              }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 9, weight: "600" }, color: tickColor(), maxRotation: 0 } },
            y: { grid: { color: gridColor() }, ticks: { callback: (v) => isValueMode ? fmt(v) : v, font: { size: 9 }, color: tickColor() } }
          }
        }
      });
    } else if (badge) {
      badge.textContent = "";
      if (charts[tid + "Trend"]) {
        charts[tid + "Trend"].destroy();
        delete charts[tid + "Trend"];
      }
    }
  } catch (e) {
    console.error("renderROLTrend error:", e);
  }
}
