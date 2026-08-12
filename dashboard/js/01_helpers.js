"use strict";
const DEBUG = false;
function dbg(...args) {
  if (DEBUG) console.log("[DBG]", ...args);
}
const LRU_LIMIT = 24;
const WEEK_CACHE = /* @__PURE__ */ new Map();
async function decompressBlob(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if ("DecompressionStream" in window) {
    try {
      const ds = new DecompressionStream("deflate");
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      const text = await new Response(stream).text();
      return JSON.parse(text);
    } catch (e) {
    }
  }
  if (typeof pako !== "undefined") {
    const inflated = pako.inflate(bytes, { to: "string" });
    return JSON.parse(inflated);
  }
  throw new Error("No decompression available. Use Chrome, Edge, or Firefox.");
}
const _loadedScripts = /* @__PURE__ */ new Set();
function _loadScript(src) {
  if (_loadedScripts.has(src)) return Promise.resolve();
  _loadedScripts.add(src);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => {
      console.warn("Chunk not found: " + src);
      _loadedScripts.delete(src);
      resolve();
    };
    document.head.appendChild(s);
  });
}
async function _loadCompressedDashboardChunk(fileName, globalName, fallbackKey) {
  if (!window[globalName]) {
    await _loadScript("data/" + fileName);
  }
  const chunkValue = window[globalName];
  if (chunkValue) return chunkValue;
  const fallbackValue = DASHBOARD_DATA[fallbackKey];
  return typeof fallbackValue === "string" ? fallbackValue : void 0;
}
async function _decompressAndCache(week, b64) {
  const data = await decompressBlob(b64);
  WEEK_CACHE.set(week, data);
  while (WEEK_CACHE.size > LRU_LIMIT) {
    const oldest = WEEK_CACHE.keys().next().value;
    if (oldest !== void 0) WEEK_CACHE.delete(oldest);
  }
  return data;
}
async function getWeekData(week) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return { raw: [] };
  if (WEEK_CACHE.has(week)) {
    const v = WEEK_CACHE.get(week);
    WEEK_CACHE.delete(week);
    WEEK_CACHE.set(week, v);
    return v;
  }
  if (COMPRESSED_WEEKS[week]) {
    return _decompressAndCache(week, COMPRESSED_WEEKS[week]);
  }
  if (!window._WEEK_CHUNKS || !window._WEEK_CHUNKS[week]) {
    await _loadScript("data/week_" + week + ".js");
  }
  if (window._WEEK_CHUNKS && window._WEEK_CHUNKS[week]) {
    return _decompressAndCache(week, window._WEEK_CHUNKS[week]);
  }
  return { raw: [] };
}
async function ensureTrendCube() {
  if (typeof YEAR_TREND_CUBE !== "undefined" && YEAR_TREND_CUBE) return YEAR_TREND_CUBE;
  if (!window._TREND_CUBE) {
    await _loadScript("data/trend_cube.js");
  }
  if (window._TREND_CUBE) {
    window.YEAR_TREND_CUBE = window._TREND_CUBE;
    return window.YEAR_TREND_CUBE;
  }
  console.warn("Trend cube not available");
  return null;
}
function showLoading(show) {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;
  if (show) {
    overlay.classList.remove("hidden");
    overlay.style.display = "";
  } else {
    overlay.classList.add("hidden");
  }
}
const DOC_TYPES_KPI = {
  ERP1: { payment: /* @__PURE__ */ new Set(["KZ", "SA", "ZP", "AB"]), invoice: /* @__PURE__ */ new Set(["KA", "KD", "KR", "Y0", "Z0"]), credit_note: /* @__PURE__ */ new Set(["Z2", "KG"]) },
  ERP2: { payment: /* @__PURE__ */ new Set(["KA", "KM", "KZ", "SE", "ZP", "AB"]), invoice: /* @__PURE__ */ new Set(["KR", "KS", "RB", "RE", "Y0", "Z0", "1H", "UE"]), credit_note: /* @__PURE__ */ new Set(["Z2", "KN", "KG"]) },
  ERP3: { payment: /* @__PURE__ */ new Set(["K1", "K3", "K5", "KA", "KS", "SA", "ZB"]), invoice: /* @__PURE__ */ new Set(["KD", "KR", "RE", "Y0", "Z0", "ZO", "SX"]), credit_note: /* @__PURE__ */ new Set(["Z2"]) },
  UK: { payment: /* @__PURE__ */ new Set(["KZ", "SA", "ZP", "ZR", "AB", "SU"]), invoice: /* @__PURE__ */ new Set(["KR", "RE"]), credit_note: /* @__PURE__ */ new Set(["KG"]) },
  ERP4: { payment: /* @__PURE__ */ new Set(["DZ", "KZ", "RK", "SA", "ZP"]), invoice: /* @__PURE__ */ new Set(["KD", "KR", "ST", "VK", "Y0", "Z0", "ZC", "L3", "ZE"]), credit_note: /* @__PURE__ */ new Set(["Z2", "KG"]) }
};
function docKey(row) {
  const sys = (row.sys || "").toUpperCase().trim();
  const co = (row.co || "").toUpperCase().trim();
  if (["ERP1", "ERP2", "ERP3", "ERP4"].includes(sys)) return sys;
  if (["UK", "GB", "UNITED KINGDOM"].includes(co)) return "UK";
  return "";
}
function docCategory(row) {
  const key = docKey(row);
  const dt = (row.dt || "").toUpperCase().trim();
  const amt = Number(row.a || 0);
  const map = DOC_TYPES_KPI[key];
  if (!map || !dt) return "";
  if (map.credit_note.has(dt)) return "CREDIT_NOTE";
  if (map.payment.has(dt)) return "PAYMENT";
  if (map.invoice.has(dt)) {
    return amt < 0 ? "INVOICE" : "CREDIT_NOTE";
  }
  return "";
}
async function populateStatusAndQueryType() {
  const weekData = await getWeekData(currentWeek);
  const currentData = weekData.raw || [];
  const statuses = /* @__PURE__ */ new Set();
  const queryTypes = /* @__PURE__ */ new Set();
  currentData.forEach((row) => {
    if (row.st) statuses.add(row.st);
    if (row.qt) queryTypes.add(row.qt);
  });
  const sortedStatuses = Array.from(statuses).sort();
  const sortedQueryTypes = Array.from(queryTypes).sort();
  const statusDropdownEl = document.querySelector("#statusWrap .multi-select-dropdown");
  if (statusDropdownEl) {
    const prevStatus = new Set(statusFilter);
    statusDropdownEl.innerHTML = '<div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllStatus();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearStatus();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>' + sortedStatuses.map((s) => `<label><input type="checkbox" value="${hesc(s)}" onchange="toggleStatus(this)" ${prevStatus.has(s) ? "checked" : ""}> ${hesc(s)}</label>`).join("");
    for (const v of [...statusFilter]) {
      if (!statuses.has(v)) statusFilter.delete(v);
    }
    const stDisp = document.querySelector("#statusWrap .multi-select-display");
    if (stDisp) stDisp.textContent = statusFilter.size === 0 ? "All Statuses" : [...statusFilter].sort().join(", ");
  }
  const queryTypeDropdownEl = document.querySelector("#queryTypeWrap .multi-select-dropdown");
  if (queryTypeDropdownEl) {
    const prevQt = new Set(queryTypeFilter);
    queryTypeDropdownEl.innerHTML = '<div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllQueryType();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearQueryType();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>' + sortedQueryTypes.map((q) => `<label><input type="checkbox" value="${hesc(q)}" onchange="toggleQueryType(this)" ${prevQt.has(q) ? "checked" : ""}> ${hesc(q)}</label>`).join("");
    for (const v of [...queryTypeFilter]) {
      if (!queryTypes.has(v)) queryTypeFilter.delete(v);
    }
    const qtDisp = document.querySelector("#queryTypeWrap .multi-select-display");
    if (qtDisp) qtDisp.textContent = queryTypeFilter.size === 0 ? "All Query Types" : [...queryTypeFilter].sort().join(", ");
  }
}
function formatDate(isoDate) {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return isoDate;
}
function teamBadgeHtml(tm) {
  if (!tm) return "";
  const d = isDark();
  const colors = {
    "Key": { bg: d ? "rgba(46,125,50,0.2)" : "#E8F5E9", fg: d ? "#86efac" : "#2E7D32" },
    "ROL": { bg: d ? "rgba(21,101,192,0.2)" : "#E3F2FD", fg: d ? "#93c5fd" : "#1565C0" }
  };
  const c = colors[tm] || { bg: d ? "rgba(230,81,0,0.2)" : "#FFF3E0", fg: d ? "#fdba74" : "#E65100" };
  return `<span style="background:${c.bg};color:${c.fg};padding:2px 8px;border-radius:4px;font-size:0.8rem;font-weight:600">${hesc(tm)}</span>`;
}
function statusBadgeHtml(status, isPositive) {
  const d = isDark();
  const bg = isPositive ? d ? "rgba(40,167,69,0.2)" : "#E8F5E9" : d ? "rgba(245,158,11,0.2)" : "#FFF8E1";
  const fg = isPositive ? d ? "#86efac" : "#28A745" : d ? "#fbbf24" : "#F59E0B";
  return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:4px;font-size:0.8rem;font-weight:600">${hesc(status)}</span>`;
}
function fmt(v, currency) {
  const abs_v = Math.abs(v || 0);
  if (abs_v >= 1e6) return (v < 0 ? "-" : "") + (abs_v / 1e6).toFixed(1) + "M";
  if (abs_v >= 1e3) return (v < 0 ? "-" : "") + (abs_v / 1e3).toFixed(0) + "K";
  return (v < 0 ? "-" : "") + abs_v.toFixed(0);
}
function fmtExact(v) {
  return (v || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtFull(v, currency) {
  return (v < 0 ? "-" : "") + new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Math.abs(v || 0));
}
function pct(v) {
  return (v || 0).toFixed(1) + "%";
}
function headerRows(rows) {
  return rows.filter((r) => (r.rl || "").toUpperCase() === "HEADER");
}
function detailRows(rows) {
  return rows.filter((r) => (r.rl || "").toUpperCase() === "DETAIL");
}
function vendorKey(row) {
  return row.s + "|" + (row.cc || "");
}
function creditRiskTier(balance) {
  if (balance > 0) return "HIGH_RISK_DEBIT";
  if (balance <= -5e4) return "HIGH_RISK";
  if (balance <= -1e4) return "MEDIUM_RISK";
  if (balance < 0) return "LOW_RISK";
  return "NO_RISK";
}
function getTeamTrend(teams, n) {
  if (typeof YEAR_TREND_CUBE === "undefined" || !YEAR_TREND_CUBE) return [];
  const combos = YEAR_TREND_CUBE.combos;
  const weeks = YEAR_TREND_CUBE.weeks;
  const nw = weeks.length;
  if (nw === 0) return [];
  const isVal = viewModeFilter === "VALUE";
  const isTx = viewModeFilter === "TRANSACTIONS";
  const teamSet = teams ? new Set(teams.map((t) => t.toUpperCase())) : null;
  const vals = new Array(nw).fill(0);
  for (const c of combos) {
    if (teamSet && !teamSet.has(c.sh.toUpperCase())) continue;
    if (countryFilter.size > 0 && !countryFilter.has(c.co)) continue;
    if (companyFilter.size > 0 && !companyFilter.has(c.cc)) continue;
    if (statusFilter.size > 0 && !statusFilter.has(c.st)) continue;
    if (queryTypeFilter.size > 0 && !queryTypeFilter.has(c.qt)) continue;
    if (ownerFilter.size > 0 && !ownerFilter.has(c.ow)) continue;
    if (balanceTypeFilter.size > 0 && !balanceTypeFilter.has(c.bal)) continue;
    if (vendorCategoryFilter.size > 0 && !vendorCategoryFilter.has(c.vc || "")) continue;
    if (paymentBlockFilter.size > 0 && !paymentBlockFilter.has(c.pb || "")) continue;
    if (paymentBlockFilter.size === 0 && (c.pb || "") !== "") continue;
    if (docCategoryFilter.size === 0) {
      if (c.dc !== "") continue;
    } else {
      if (!docCategoryFilter.has(c.dc)) continue;
    }
    const arr = isVal ? c.tv : isTx ? c.dv : c.sv;
    for (let i = 0; i < nw; i++) vals[i] += arr[i];
  }
  return vals.slice(Math.max(0, nw - n));
}
function sparklineSVG(data, color, w, h) {
  if (!data || data.length < 2) return "";
  const abs = data.map((v) => Math.abs(v));
  if (abs.every((v) => v === 0)) return "";
  const max = Math.max(...abs), min = Math.min(...abs);
  const range = max - min || 1;
  const pad = 2, usable = h - 2 * pad;
  const pts = abs.map((v, i) => {
    const x = i / (abs.length - 1) * (w - 4) + 2;
    const y = h - pad - (v - min) / range * usable;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lp = pts[pts.length - 1].split(",");
  return `<svg width="${w}" height="${h}" style="display:block;margin-top:6px;opacity:0.85"><polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${lp[0]}" cy="${lp[1]}" r="2" fill="${color}"/></svg>`;
}
function hesc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
}
function hasAging(row) {
  return (row.a030 || 0) !== 0 || (row.a3160 || 0) !== 0 || (row.a6190 || 0) !== 0 || (row.a91120 || 0) !== 0 || (row.a121180 || 0) !== 0 || (row.a180 || 0) !== 0;
}
const BUCKET_FIELD_MAP = {
  "0-30": "a030",
  "31-60": "a3160",
  "61-90": "a6190",
  "91-120": "a91120",
  "121-180": "a121180",
  "180+": "a180"
};
function matchesBucket(row, bucket) {
  const field = BUCKET_FIELD_MAP[bucket];
  return field ? !!row[field] : false;
}
function sumRowBuckets(row, bucketSet, defaultVal) {
  if (!bucketSet || bucketSet.size === 0) return defaultVal;
  const specific = [...bucketSet].filter((b) => b !== "NOT_OVERDUE" && b !== "ALL_OVERDUE");
  const hasAllOverdue = bucketSet.has("ALL_OVERDUE");
  const hasNotOverdue = bucketSet.has("NOT_OVERDUE");
  if (specific.length === 0 && !hasAllOverdue && !hasNotOverdue) return defaultVal;
  const allOverdueSum = Number(row.a030 || 0) + Number(row.a3160 || 0) + Number(row.a6190 || 0) + Number(row.a91120 || 0) + Number(row.a121180 || 0) + Number(row.a180 || 0);
  if (hasAllOverdue) {
    if (hasNotOverdue) return defaultVal;
    return allOverdueSum;
  }
  let sum = 0;
  if (hasNotOverdue) sum += defaultVal - allOverdueSum;
  for (const b of specific) {
    const field = BUCKET_FIELD_MAP[b];
    if (field) sum += Number(row[field] || 0);
  }
  return sum;
}
