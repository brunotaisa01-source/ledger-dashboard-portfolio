"use strict";
const TEAM_CONFIG = {
  ROL: {
    label: "ROL Team",
    subtitle: "Full Spectrum Management  All aging buckets 0-30 through 180+",
    icon: "chart-bar",
    color: "#028090",
    colorHex: "#028090",
    overviewIcons: { VALUE: "chart-line", TRANSACTIONS: "file-lines", SUPPLIERS: "user-group" },
    //  Aging chart (all 6 buckets) 
    agingBuckets: ["0-30 Days", "31-60 Days", "61-90 Days", "91-120 Days", "121-180 Days", "180+ Days"],
    agingKeys: ["aged_0_30", "aged_31_60", "aged_61_90", "aged_91_120", "aged_121_180", "aged_180_plus"],
    agingDocKeys: ["aged_0_30_docs", "aged_31_60_docs", "aged_61_90_docs", "aged_91_120_docs", "aged_121_180_docs", "aged_180_plus_docs"],
    agingCountKeys: ["aged_0_30_count", "aged_31_60_count", "aged_61_90_count", "aged_91_120_count", "aged_121_180_count", "aged_180_plus_count"],
    agingColors: ["#028090", "#2AB7CA", "#FFC107", "#FF6B35", "#E74C3C", "#DC3545"],
    chartAxis: "x",
    // 'x' = vertical bar, 'y' = horizontal
    chartHeight: 200,
    //  KPI 1: Total Balance / Total Transactions / Total Suppliers 
    kpi1Icons: { VALUE: "money-bill-trend-up", TRANSACTIONS: "file-lines", SUPPLIERS: "building" },
    //  KPI 2 (mode-aware) 
    kpi2Label: { VALUE: "Total Overdue", TRANSACTIONS: "Overdue Docs", SUPPLIERS: "Docs" },
    kpi2Key: { VALUE: "total_overdue", TRANSACTIONS: "overdueDocs", SUPPLIERS: "total_docs" },
    kpi2Icon: { VALUE: "clock", TRANSACTIONS: "file-lines", SUPPLIERS: "file-lines" },
    kpi2Color: "var(--secondary)",
    //  KPI 3: Critical bucket (>90d aggregate) 
    criticalLabel: "Critical >90d",
    criticalKey: "aged_90_plus",
    criticalDocKey: "aged_90_plus_docs",
    criticalSupplierField: "Aged_90_plus",
    // composite: 91-120 + 121-180 + 180+
    criticalIcon: "triangle-exclamation",
    criticalColor: "var(--orange)",
    hasCriticalPct: false,
    //  Avg Days Overdue (all 6 buckets) 
    avgDaysKeys: ["aged_0_30", "aged_31_60", "aged_61_90", "aged_91_120", "aged_121_180", "aged_180_plus"],
    avgDaysMultipliers: [30, 60, 90, 120, 180, 210],
    //  Pie chart 
    pieColors: ["#028090", "#FFC107"],
    //  Owner Aging stacked bar 
    ownerAgingPalette: null,
    // null = default green-to-red palette
    //  Table 
    tableHasQueryType: true,
    tableCols: 10,
    defaultBucketField: "Aged_91_120",
    // for comparison table default value
    //  Filter element IDs 
    balanceTypeVar: "rolBalanceTypeFilter",
    balanceTypeFilterId: "rolBalanceTypeFilter",
    priorityFilterId: "rolPriorityFilter",
    //  Extras: team-specific charts 
    extras: ["trendChart", "rootCauseChart"]
  },
  KEY: {
    label: "Key Team",
    subtitle: "Full aging spectrum  0-30 through 180+ days overdue",
    icon: "key",
    color: "#6F42C1",
    colorHex: "#6F42C1",
    overviewIcons: { VALUE: "key", TRANSACTIONS: "file-lines", SUPPLIERS: "user-group" },
    //  Aging chart (all 6 buckets) 
    agingBuckets: ["0-30 Days", "31-60 Days", "61-90 Days", "91-120 Days", "121-180 Days", "180+ Days"],
    agingKeys: ["aged_0_30", "aged_31_60", "aged_61_90", "aged_91_120", "aged_121_180", "aged_180_plus"],
    agingDocKeys: ["aged_0_30_docs", "aged_31_60_docs", "aged_61_90_docs", "aged_91_120_docs", "aged_121_180_docs", "aged_180_plus_docs"],
    agingCountKeys: ["aged_0_30_count", "aged_31_60_count", "aged_61_90_count", "aged_91_120_count", "aged_121_180_count", "aged_180_plus_count"],
    agingColors: ["#6F42C1", "#9B59B6", "#FFC107", "#FF6B35", "#E74C3C", "#DC3545"],
    chartAxis: "x",
    chartHeight: 200,
    //  KPI 1 
    kpi1Icons: { VALUE: "key", TRANSACTIONS: "file-lines", SUPPLIERS: "building" },
    //  KPI 2 
    kpi2Label: { VALUE: "Total Overdue", TRANSACTIONS: "Overdue Docs", SUPPLIERS: "Docs" },
    kpi2Key: { VALUE: "total_overdue", TRANSACTIONS: "overdueDocs", SUPPLIERS: "total_docs" },
    kpi2Icon: { VALUE: "clock", TRANSACTIONS: "file-lines", SUPPLIERS: "file-lines" },
    kpi2Color: "var(--orange)",
    //  KPI 3: Critical 180+ 
    criticalLabel: "Critical 180+",
    criticalKey: "aged_180_plus",
    criticalDocKey: "aged_180_plus_docs",
    criticalSupplierField: "Aged_180_plus",
    criticalIcon: "triangle-exclamation",
    criticalColor: "var(--red)",
    hasCriticalPct: false,
    //  Avg Days Overdue (all 6 buckets) 
    avgDaysKeys: ["aged_0_30", "aged_31_60", "aged_61_90", "aged_91_120", "aged_121_180", "aged_180_plus"],
    avgDaysMultipliers: [30, 60, 90, 120, 180, 210],
    //  Pie chart 
    pieColors: ["#6F42C1", "#FFC107"],
    //  Owner Aging (purple palette for first bucket) 
    ownerAgingPalette: [
      "rgba(111,66,193,0.85)",
      // 0-30d  purple
      "rgba(155,89,182,0.85)",
      // 31-60d  lighter purple
      "rgba(255,193,7,0.85)",
      // 61-90d  yellow
      "rgba(255,107,53,0.85)",
      // 91-120d  orange
      "rgba(220,53,69,0.85)",
      // 121-180d  red
      "rgba(139,0,0,0.85)"
      // 180+d  dark red
    ],
    //  Table 
    tableHasQueryType: true,
    tableCols: 10,
    defaultBucketField: "TotalAmount",
    // Key uses full TotalAmount as default
    //  Filter element IDs 
    balanceTypeVar: "keyBalanceTypeFilter",
    balanceTypeFilterId: "keyBalanceTypeDropdown",
    // Key uses dropdown, not toggle
    priorityFilterId: "keyPriorityFilter",
    //  Extras 
    extras: ["trendChart"]
  }
  //  Future teams: add here 
  // PAYMENT: { label: 'Payment Team', icon: 'credit-card', color: '#17A2B8', ... },
  // ESCALATION: { label: 'Escalation', icon: 'arrow-up-right-dots', color: '#E67E00', ... },
};
const DEFAULT_OWNER_AGING_PALETTE = [
  "rgba(40,167,69,0.85)",
  // 0-30d
  "rgba(255,193,7,0.85)",
  // 31-60d
  "rgba(255,107,53,0.85)",
  // 61-90d
  "rgba(230,126,0,0.85)",
  // 91-120d
  "rgba(220,53,69,0.85)",
  // 121-180d
  "rgba(139,0,0,0.85)"
  // 180+d
];
const OWNER_AGING_LABELS = ["0-30d", "31-60d", "61-90d", "91-120d", "121-180d", "180+d"];
const OWNER_AGING_DATA_KEYS = ["a030", "a3160", "a6190", "a91120", "a121180", "a180"];
function getOwnerAgingPalette(teamId) {
  const cfg = TEAM_CONFIG[teamId];
  return cfg && cfg.ownerAgingPalette || DEFAULT_OWNER_AGING_PALETTE;
}
function avgDaysOverdue(kpis, teamId) {
  const cfg = TEAM_CONFIG[teamId];
  if (!cfg) return 0;
  let totalAbs = 0, weightedSum = 0;
  for (let i = 0; i < cfg.avgDaysKeys.length; i++) {
    const bucket = cfg.agingBuckets[i].replace(" Days", "");
    if (globalBucketFilter.size > 0 && !globalBucketFilter.has("ALL_OVERDUE") && !globalBucketFilter.has(bucket)) continue;
    const v = Math.abs(kpis[cfg.avgDaysKeys[i]] || 0);
    totalAbs += v;
    weightedSum += v * cfg.avgDaysMultipliers[i];
  }
  return totalAbs === 0 ? 0 : weightedSum / totalAbs;
}
