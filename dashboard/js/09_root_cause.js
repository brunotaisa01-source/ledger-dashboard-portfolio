"use strict";
function renderRootCause(tid, filtered) {
  const isValueMode = viewModeFilter === "VALUE";
  const queryTypeAging = computeAgingByQueryType(filtered, globalBucketFilter);
  const qtLabels = queryTypeAging.map((t) => t.type);
  const bucketDatasets = [
    { bucket: "0-30", label: "0-30d", key: "a030", backgroundColor: "rgba(2,128,144,0.85)" },
    { bucket: "31-60", label: "31-60d", key: "a3160", backgroundColor: "rgba(42,183,202,0.85)" },
    { bucket: "61-90", label: "61-90d", key: "a6190", backgroundColor: "rgba(255,193,7,0.85)" },
    { bucket: "91-120", label: "91-120d", key: "a91120", backgroundColor: "rgba(255,107,53,0.85)" },
    { bucket: "121-180", label: "121-180d", key: "a121180", backgroundColor: "rgba(220,53,69,0.85)" },
    { bucket: "180+", label: "180+d", key: "a180", backgroundColor: "rgba(139,0,0,0.85)" }
  ].filter((b) => isAgingBucketVisible(b.bucket, globalBucketFilter));
  if (charts[tid + "RootCause"]) charts[tid + "RootCause"].destroy();
  charts[tid + "RootCause"] = new Chart(document.getElementById(tid + "RootCauseChart"), {
    type: "bar",
    data: {
      labels: qtLabels,
      datasets: bucketDatasets.map((b) => ({
        label: b.label,
        data: queryTypeAging.map((t) => Number(t[b.key] || 0)),
        backgroundColor: b.backgroundColor,
        borderRadius: 2
      }))
    },
    options: {
      responsive: true,
      indexAxis: "y",
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, padding: 8, font: { size: 10, weight: "600" }, usePointStyle: true, pointStyle: "rectRounded" } },
        datalabels: {
          display: true,
          anchor: "end",
          align: "end",
          formatter: (v, ctx) => {
            const ds = ctx.chart.data.datasets;
            const idx = ctx.dataIndex;
            if (ctx.datasetIndex !== ds.length - 1) return "";
            const total = ds.reduce((s, d) => s + (d.data[idx] || 0), 0);
            return isValueMode ? fmt(total) : total;
          },
          color: () => dlColor(),
          font: { weight: "bold", size: 11 }
        },
        tooltip: { mode: "index", intersect: false, callbacks: { label: (ctx) => " " + ctx.dataset.label + ": " + fmt(ctx.parsed.x), footer: (items) => "Total: " + fmt(items.reduce((s, i) => s + i.parsed.x, 0)) } }
      },
      scales: {
        x: { stacked: true, ticks: { callback: (v) => isValueMode ? fmt(v) : v, font: { size: 10 } }, grid: { color: gridColor() } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11, weight: "600" } } }
      },
      onClick: (e, els) => {
        if (els.length) {
          const idx = els[0].index;
          const qt = qtLabels[idx];
          queryTypeFilter.clear();
          queryTypeFilter.add(qt);
          document.querySelectorAll('#queryTypeWrap input[type="checkbox"]').forEach((cb) => {
            cb.checked = cb.value === qt;
          });
          const qtDisp = document.querySelector("#queryTypeWrap .multi-select-display");
          if (qtDisp) qtDisp.textContent = qt;
          update();
        }
      }
    }
  });
}
