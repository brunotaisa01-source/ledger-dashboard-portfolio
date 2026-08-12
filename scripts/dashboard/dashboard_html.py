#!/usr/bin/env python3
"""
AP CONTROL DASHBOARD V19 - HTML Generation Module
All three HTML generation functions (embedded, JSON mode, helper mode).
Split from Rol_Query.py for maintainability.
"""

import json
import zlib
import base64
from datetime import datetime
from typing import Dict, Any

from ..utils.paths import LIBS_DIR, CSS_DIR, JS_DIR, DASHBOARD_DIR
from .dashboard_config import (
    COLORS, _JS_STATE_VARS,
    HELPER_BIND, HELPER_PORT, OUTPUT_CUBE_LEDGER,
    UI_THEME, TEAM_CONFIG
)
from .dashboard_data import escape_html, compute_year_trend_cube
from ..utils.log import get_logger

log = get_logger(__name__)


# 
# CSS / JS Loader  reads external files and inlines at build time
# 

def _load_css(minified: bool = False) -> str:
    """Read all .css files from dashboard/css/ (sorted by name) and return
    their contents wrapped in a single <style> block.
    If minified=True, reads from dashboard/build/css/ (falls back to originals).
    Returns empty string if no CSS files found (fallback to inline)."""
    if not CSS_DIR.is_dir():
        return ''
    build_css = DASHBOARD_DIR / "build" / "css"
    files = sorted(CSS_DIR.glob('*.css'))
    if not files:
        return ''
    parts = []
    for f in files:
        src = (build_css / f.name) if (minified and (build_css / f.name).exists()) else f
        parts.append(f'/*  {f.name}  */\n{src.read_text(encoding="utf-8")}')
    css = '\n\n'.join(parts)
    return f'<style>\n{css}\n</style>'


def _load_js(minified: bool = False) -> str:
    """Read all .js files from dashboard/js/ (sorted by name) and return
    their contents concatenated.
    If minified=True, reads from dashboard/build/js/ (falls back to originals).
    Returns empty string if no JS files found."""
    if not JS_DIR.is_dir():
        return ''
    build_js = DASHBOARD_DIR / "build" / "js"
    files = sorted(JS_DIR.glob('*.js'))
    if not files:
        return ''
    parts = []
    for f in files:
        src = (build_js / f.name) if (minified and (build_js / f.name).exists()) else f
        parts.append(f'//  {f.name} \n{src.read_text(encoding="utf-8")}')
    return '\n\n'.join(parts)


def _team_page_html(team_id: str, cfg: Dict[str, Any]) -> str:
    """Generates the HTML block for a specific team page dynamically based on TEAM_CONFIG."""
    tid = team_id.lower()
    
    extras = cfg.get('extras', [])
    has_trend = 'trendChart' in extras
    has_root = 'rootCauseChart' in extras

    if has_trend and has_root:
        # Side-by-side layout when both charts present
        extras_html = f'''
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:16px;">
            <div class="chart-card" style="position:relative; height:220px;">
                <div class="chart-title"><i class="fa-solid fa-chart-line"></i> 12-Week Trend <span id="{tid}TrendBadge" class="trend-badge" style="font-size:0.75rem;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:8px"></span></div>
                <div style="position:relative; height:180px;"><canvas id="{tid}TrendChart"></canvas></div>
            </div>
            <div class="chart-card" style="position:relative; height:220px;">
                <div class="chart-title"><i class="fa-solid fa-magnifying-glass-chart"></i> Query Type Breakdown  Root Cause</div>
                <div style="position:relative; height:180px;"><canvas id="{tid}RootCauseChart"></canvas></div>
            </div>
        </div>'''
    else:
        extras_html = ""
        for extra in extras:
            if extra == 'trendChart':
                extras_html += f'''
        <div class="chart-container" style="margin-bottom:16px">
            <div class="chart-title"><i class="fa-solid fa-chart-line"></i> {team_id} Balance  Last 12 Weeks <span id="{tid}TrendBadge" style="font-size:0.75rem;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:8px"></span></div>
            <div style="position:relative;height:120px"><canvas id="{tid}TrendChart"></canvas></div>
        </div>'''
            elif extra == 'rootCauseChart':
                extras_html += f'''
        <div class="chart-container" style="margin-bottom:16px">
            <div class="chart-title"><i class="fa-solid fa-magnifying-glass-chart"></i> Query Type Breakdown  Root Cause Analysis</div>
            <div style="position:relative;height:260px"><canvas id="{tid}RootCauseChart"></canvas></div>
        </div>'''

    # Some teams like Key use toggle buttons instead of a dropdown for balance type chart filtering
    aging_chart_buttons = ""
    if cfg.get('balance_type_style') == 'buttons':
        aging_chart_buttons = f'''
                    <span style="float:right;display:inline-flex;gap:4px;">
                        <button class="toggle-btn active" id="{tid}BtAll" onclick="set{team_id.capitalize()}BalanceType('ALL')">All</button>
                        <button class="toggle-btn" id="{tid}BtDebit" onclick="set{team_id.capitalize()}BalanceType('DEBIT')">Debit</button>
                        <button class="toggle-btn" id="{tid}BtCredit" onclick="set{team_id.capitalize()}BalanceType('CREDIT')">Credit</button>
                    </span>'''

    return f'''
    <!--  -->
    <!-- {team_id} TEAM PAGE -->
    <!--  -->
    <div class="page" id="{tid}">
        <div class="page-header">
            <h1 class="page-title"><i class="fa-solid fa-{cfg['icon']}" style="color:{cfg.get('color_hex', 'inherit')}"></i> {cfg['label']} Dashboard</h1>
            <p class="page-subtitle">{cfg['subtitle']}</p>
        </div>
        <div class="kpi-grid" id="{tid}-kpis"></div>
        <div class="chart-grid">
            <div class="chart-container team-aging-chart">
                <div class="chart-title"><i class="fa-solid fa-{cfg['aging_chart_icon']}"></i> {cfg['aging_chart_title']}{aging_chart_buttons}</div>
                <div class="team-aging-canvas"><canvas id="{tid}AgingChart"></canvas></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:1rem">
                <div class="chart-container" style="display:flex;flex-direction:column;align-items:center">
                    <div class="chart-title" style="width:100%"><i class="fa-solid fa-chart-pie"></i> Current vs Overdue</div>
                    <div style="width:100%;max-width:220px;margin:0 auto">
                        <canvas id="{tid}PieChart"></canvas>
                    </div>
                </div>
                <div class="chart-container" style="flex:1;min-height:0">
                    <div class="chart-title"><i class="fa-solid fa-users"></i> Aging by Owner</div>
                    <div style="position:relative;height:200px"><canvas id="{tid}OwnerAgingChart"></canvas></div>
                </div>
            </div>
        </div>
{extras_html}
        <div class="table-container">
            <div class="table-header">
                <div class="table-title"><i class="fa-solid fa-{cfg.get('table_icon', 'crosshairs')}" style="color:{cfg.get('table_icon_color', 'inherit')}"></i> Critical Suppliers with Comparison</div>
                <div class="table-controls">
                    <select id="{cfg['balance_type_filter_id']}" style="margin-right: 0.5rem; padding: 0.4rem 0.6rem; border-radius: 6px; border: 1px solid #ddd; font-size: 0.8rem;">
                        <option value="ALL">All Balance Types</option>
                        <option value="CREDIT"> Credit (< 0)</option>
                        <option value="DEBIT"> Debit (> 0)</option>
                    </select>
                    <select id="{cfg['priority_filter_id']}">
                        <option value="">All Priorities</option>
                        <option value="HIGH"> High</option>
                        <option value="MEDIUM"> Medium</option>
                        <option value="LOW"> Low</option>
                    </select>
                    <span style="font-size:0.75rem;color:var(--text-muted);margin-left:0.5rem"><i class="fa-solid fa-star" style="color:var(--orange)"></i> New | <i class="fa-solid fa-arrow-trend-up" style="color:#dc3545"></i> Worse | <i class="fa-solid fa-arrow-trend-down" style="color:#02c39a"></i> Better</span>
                    <select class="page-size-select" id="{cfg['page_size_id']}" onchange="changePageSize('{tid}', +this.value)">
                        <option value="10" selected>10 rows</option>
                        <option value="20">20 rows</option>
                        <option value="50">50 rows</option>
                    </select>
                    <button class="toggle-btn" onclick="{cfg['export_fn']}()" title="Export CSV"><i class="fa-solid fa-download"></i> CSV</button>
                </div>
            </div>
            <div style="overflow-x:auto"><table id="{tid}Table"></table></div>
            <div id="{tid}Pagination" class="pagination-bar"></div>
        </div>
    </div>
'''


def generate_html_template_json_mode(data: Dict[str, Any]) -> str:
    """Generate static HTML template that loads data from dashboard_data.js.

    Strategy: Generate the full embedded HTML, then surgically replace
    the inline data with code that reads from window.DASHBOARD_DATA.
    Same approach used by generate_html_dashboard_helper_mode().
    """
    # Generate the shell with lightweight placeholders. JSON mode replaces the
    # data layer with dashboard_data.js below, so building a full embedded data
    # payload here is wasted work during daily --force-html runs.
    html = generate_html_dashboard(data, placeholder_data=True)

    #  Add <script src="dashboard_data.js"> before main <script> 
    main_script_tag = '\n<script>\n//  Compressed data'
    if main_script_tag in html:
        html = html.replace(
            main_script_tag,
            '\n<script src="dashboard_data.js"></script>\n<script>\n//  Compressed data'
        )

    #  Replace inline data constants with reads from window.DASHBOARD_DATA 
    # Load 00_config.js (TEAM_CONFIG)  the surgical replacement below overwrites
    # the region where _load_js() inlined it, so we must re-inject it here.
    _config_js = (JS_DIR / "00_config.js").read_text(encoding="utf-8")

    json_data_js = f'''
//  00_config.js 
{_config_js}

//  JSON_MODE: Data loaded from external dashboard_data.js 
if (!window.DASHBOARD_DATA) {{
    document.body.innerHTML = '<div style="padding:40px;font-family:Inter,sans-serif;text-align:center">'
        + '<h2 style="color:#DC3545">\\u26a0\\ufe0f dashboard_data.js not found</h2>'
        + '<p>Make sure <b>dashboard_data.js</b> is in the same folder as this HTML file.</p></div>';
    throw new Error('dashboard_data.js not found');
}}
const _D = window.DASHBOARD_DATA;
const COMPRESSED_WEEKS = _D.compressed_weeks;
const SORTED_WEEKS = _D.sorted_weeks;
let YEAR_TREND_CUBE = null;
const CHUNK_WEEKS = _D.chunk_weeks || [];
const SYNTHETIC_REVIEW_COMPRESSED = _D.synthetic_review_compressed || '';
const STATEMENT_COMPRESSED = _D.statement_compressed || '';

{_JS_STATE_VARS}

Chart.register(ChartDataLabels);

//  LRU CACHE + DECOMPRESSOR 
const LRU_LIMIT = 4;
const WEEK_CACHE = new Map();

async function decompressBlob(b64) {{
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if ("DecompressionStream" in window) {{
        try {{
            const ds = new DecompressionStream("deflate");
            const stream = new Blob([bytes]).stream().pipeThrough(ds);
            const text = await new Response(stream).text();
            return JSON.parse(text);
        }} catch(e) {{ /* fallback to pako */ }}
    }}
    if (typeof pako !== 'undefined') {{
        const inflated = pako.inflate(bytes, {{ to: 'string' }});
        return JSON.parse(inflated);
    }}
    throw new Error("No decompression available.");
}}

const _loadedScripts = new Set();
function _loadScript(src) {{
    if (_loadedScripts.has(src)) return Promise.resolve();
    _loadedScripts.add(src);
    return new Promise((resolve) => {{
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => {{ console.warn('Chunk not found: ' + src); _loadedScripts.delete(src); resolve(); }};
        document.head.appendChild(s);
    }});
}}

async function _loadCompressedDashboardChunk(fileName, globalName, fallbackKey) {{
    if (!window[globalName]) {{
        await _loadScript('data/' + fileName);
    }}
    const chunkValue = window[globalName];
    if (chunkValue) return chunkValue;
    const fallbackValue = _D[fallbackKey];
    return typeof fallbackValue === 'string' ? fallbackValue : undefined;
}}

async function _decompressAndCache(week, b64) {{
    const data = await decompressBlob(b64);
    WEEK_CACHE.set(week, data);
    while (WEEK_CACHE.size > LRU_LIMIT) {{
        const oldest = WEEK_CACHE.keys().next().value;
        WEEK_CACHE.delete(oldest);
    }}
    return data;
}}

async function getWeekData(week) {{
    if (!week) return {{ raw: [] }};
    if (WEEK_CACHE.has(week)) {{
        const v = WEEK_CACHE.get(week);
        WEEK_CACHE.delete(week);
        WEEK_CACHE.set(week, v);
        return v;
    }}
    if (COMPRESSED_WEEKS[week]) {{
        return _decompressAndCache(week, COMPRESSED_WEEKS[week]);
    }}
    if (!window._WEEK_CHUNKS || !window._WEEK_CHUNKS[week]) {{
        await _loadScript('data/week_' + week + '.js');
    }}
    if (window._WEEK_CHUNKS && window._WEEK_CHUNKS[week]) {{
        return _decompressAndCache(week, window._WEEK_CHUNKS[week]);
    }}
    return {{ raw: [] }};
}}

async function ensureTrendCube() {{
    if (YEAR_TREND_CUBE) return YEAR_TREND_CUBE;
    if (!window._TREND_CUBE) await _loadScript('data/trend_cube.js');
    if (window._TREND_CUBE) {{
        YEAR_TREND_CUBE = window._TREND_CUBE;
        return YEAR_TREND_CUBE;
    }}
    console.warn('Trend cube not available');
    return null;
}}

'''

    # Find and replace the data section
    old_data_section_start = '//  Compressed data'
    show_loading_marker = 'function showLoading(show)'

    idx_start = html.find(old_data_section_start)
    end_of_replacement = html.find(show_loading_marker, idx_start) if idx_start != -1 else -1

    if idx_start != -1 and end_of_replacement != -1:
        html = html[:idx_start] + json_data_js + '\n' + html[end_of_replacement:]

    #  Replace the init IIFE to populate filters from JS data 
    json_init = '''
//  INIT: JSON_MODE  Data from dashboard_data.js 
(async function() {
    const overlay = document.getElementById('loadingOverlay');
    const barEl = document.getElementById('loadingBar');
    const statusEl = document.getElementById('loadingStatus');

    try {
        // Populate week dropdown from data
        if (statusEl) statusEl.textContent = 'Loading data...';
        if (barEl) barEl.style.width = '10%';

        const weekDropdown = document.getElementById('weekSelector');
        weekDropdown.innerHTML = SORTED_WEEKS.map(w => {
            const parts = w.split('-');
            const display = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : w;
            return `<option value="${w}">${display}</option>`;
        }).join('');

        currentWeek = SORTED_WEEKS[0];
        overdueWeek1 = SORTED_WEEKS[0];
        overdueWeek2 = SORTED_WEEKS.length > 1 ? SORTED_WEEKS[1] : SORTED_WEEKS[0];

        // Populate overdue week dropdowns
        const overdueOpts = SORTED_WEEKS.map(w => {
            const parts = w.split('-');
            const display = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : w;
            return `<option value="${w}">${display}</option>`;
        }).join('');
        document.getElementById('overdueWeek1').innerHTML = overdueOpts;
        document.getElementById('overdueWeek2').innerHTML = overdueOpts;
        document.getElementById('overdueWeek2').value = overdueWeek2;

        // Populate movement week dropdowns
        movWeek1 = SORTED_WEEKS[0];
        movWeek2 = SORTED_WEEKS.length > 1 ? SORTED_WEEKS[1] : SORTED_WEEKS[0];
        document.getElementById('movWeek1').innerHTML = overdueOpts;
        document.getElementById('movWeek2').innerHTML = overdueOpts;
        document.getElementById('movWeek1').value = movWeek1;
        document.getElementById('movWeek2').value = movWeek2;

        // Populate filter dropdowns from data
        const f = _D.filters;
        if (f.countries && f.countries.length) {
            const coDD = document.querySelector('#countryWrap .multi-select-dropdown');
            if (coDD) coDD.innerHTML = '<div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllCountry();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearCountry();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>' +
                f.countries.map(c => `<label><input type="checkbox" value="${c}" onchange="toggleCountry(this)"> ${c}</label>`).join('');
        }
        if (f.company_codes && f.company_codes.length) {
            const ccDD = document.querySelector('#companyCodeWrap .multi-select-dropdown');
            if (ccDD) ccDD.innerHTML = '<div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllCompanyCode();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearCompanyCode();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>' +
                f.company_codes.map(c => `<label><input type="checkbox" value="${c}" onchange="toggleCompanyCode(this)"> ${c}</label>`).join('');
        }
        if (f.owners && f.owners.length) {
            const owDD = document.querySelector('#ownerWrap .multi-select-dropdown');
            if (owDD) owDD.innerHTML = '<div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllOwner();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearOwner();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>' +
                f.owners.map(o => `<label><input type="checkbox" value="${o}" onchange="toggleOwner(this)"> ${o}</label>`).join('');
        }
        // vendorCategoryFilter is now multi-select, populated dynamically in update()
        if (f.payment_blocks && f.payment_blocks.length) {
            const dd = document.querySelector('#paymentBlockWrap .multi-select-dropdown');
            if (dd) {
                dd.innerHTML = '<div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllPaymentBlock();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearPaymentBlock();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>' +
                    f.payment_blocks.map(pb => `<label><input type="checkbox" value="${pb}" onchange="togglePaymentBlock(this)"> ${pb}</label>`).join('');
            }
        }

        // Step 1: Decompress current week
        if (statusEl) statusEl.textContent = 'Loading current week...';
        if (barEl) barEl.style.width = '30%';
        await getWeekData(SORTED_WEEKS[0]);

        // Step 2: Decompress previous week (for deltas)
        if (SORTED_WEEKS.length > 1) {
            if (statusEl) statusEl.textContent = 'Loading previous week...';
            if (barEl) barEl.style.width = '50%';
            await getWeekData(SORTED_WEEKS[1]);
        }

        // Step 2.5: Load trend cube (async, from external script)
        if (statusEl) statusEl.textContent = 'Loading trend data...';
        if (barEl) barEl.style.width = '60%';
        await ensureTrendCube();

        // Step 3: Render dashboard
        if (statusEl) statusEl.textContent = 'Rendering dashboard...';
        if (barEl) barEl.style.width = '70%';
        await populateStatusAndQueryType();
        await update();

        if (barEl) barEl.style.width = '85%';
        if (statusEl) statusEl.textContent = 'Loading overdue insights...';
        await updateOverdueInsights();

        if (statusEl) statusEl.textContent = 'Loading SyntheticReview data...';
        if (barEl) barEl.style.width = '90%';
        await updateSyntheticReview();

        if (statusEl) statusEl.textContent = 'Loading Statement data...';
        if (barEl) barEl.style.width = '95%';
        await updateStatement();

        // Step 5: Health check badge (non-blocking)
        _loadHealthBadge();

        // Step 6: Done
        if (barEl) barEl.style.width = '100%';
        if (statusEl) statusEl.textContent = 'Done!';
        if (overlay) {
            setTimeout(() => {
                overlay.classList.add('hidden');
                setTimeout(() => overlay.remove(), 600);
            }, 200);
        }
    } catch (err) {
        console.error('Dashboard init error:', err);
        if (statusEl) {
            statusEl.textContent = 'Error: ' + err.message;
            statusEl.style.color = '#DC3545';
        }
        if (barEl) {
            barEl.style.width = '100%';
            barEl.style.background = '#DC3545';
        }
        if (overlay) {
            overlay.style.cursor = 'pointer';
            overlay.addEventListener('click', () => overlay.remove());
        }
    }
})();
'''

    old_init_start = '// \u2550\u2550\u2550 INIT: LAZY-LOAD 1-2 WEEKS + RENDER \u2550\u2550\u2550'
    old_init_end = '</script>'

    init_start_idx = html.find(old_init_start)
    init_end_idx = html.find(old_init_end, init_start_idx) if init_start_idx != -1 else -1

    if init_start_idx != -1 and init_end_idx != -1:
        html = html[:init_start_idx] + json_init + '\n</script>' + html[init_end_idx + len('</script>'):]

    # Update version label
    html = html.replace('V13 HYBRID', 'V19 JSON')

    # Add generated timestamp in footer
    html = html.replace(
        'Data refreshes on page load',
        f'Data updated: {datetime.now().strftime("%d/%m/%Y %H:%M")} | Refresh page for latest data'
    )

    return html


def generate_html_dashboard(data: Dict[str, Any], *, placeholder_data: bool = False) -> str:
    weeks_data = data['weeks_data']
    countries, company_codes = data['countries'], data['company_codes']
    statuses, query_types, owners = data['statuses'], data['query_types'], data['owners']
    vendor_categories = data.get('vendor_categories', [])
    sorted_weeks = sorted(weeks_data.keys(), reverse=True)
    selector_weeks = sorted(data.get('all_weeks') or weeks_data.keys(), reverse=True)

    #  Inline libraries for self-contained HTML (Local Fixture Store compatible) 
    _libs = LIBS_DIR
    _chart_js = (_libs / "chart.umd.min.js").read_text(encoding='utf-8')
    _chart_dl = (_libs / "chartjs-plugin-datalabels.min.js").read_text(encoding='utf-8')
    _pako_js = (_libs / "pako.min.js").read_text(encoding='utf-8')
    # Font Awesome: CSS with base64-encoded woff2 fonts
    _fa_css = (_libs / "fontawesome.min.css").read_text(encoding='utf-8')
    _fa_solid_b64 = base64.b64encode((_libs / "fa-solid-900.woff2").read_bytes()).decode('ascii')
    _fa_regular_b64 = base64.b64encode((_libs / "fa-regular-400.woff2").read_bytes()).decode('ascii')
    _fa_css = _fa_css.replace('../webfonts/fa-solid-900.woff2', f'data:font/woff2;base64,{_fa_solid_b64}')
    _fa_css = _fa_css.replace('../webfonts/fa-regular-400.woff2', f'data:font/woff2;base64,{_fa_regular_b64}')
    log.info("  [OK] Inline libs: Chart.js %dKB, Datalabels %dKB, Pako %dKB, FA CSS+fonts %dKB", len(_chart_js)//1024, len(_chart_dl)//1024, len(_pako_js)//1024, len(_fa_css)//1024)

    country_checkboxes = ''.join(f'<label><input type="checkbox" value="{escape_html(c)}" onchange="toggleCountry(this)"> {escape_html(c)}</label>' for c in countries)
    cc_checkboxes = ''.join(f'<label><input type="checkbox" value="{escape_html(c)}" onchange="toggleCompanyCode(this)"> {escape_html(c)}</label>' for c in company_codes)
    # Status and Query Type are populated dynamically by populateStatusAndQueryType() in JS
    owner_checkboxes = ''.join(f'<label><input type="checkbox" value="{escape_html(o)}" onchange="toggleOwner(this)"> {escape_html(o)}</label>' for o in owners)
    vc_checkboxes = ''.join(f'<label><input type="checkbox" value="{escape_html(vc)}" onchange="toggleVendorCategory(this)"> {escape_html(vc)}</label>' for vc in vendor_categories)
    payment_blocks = data.get('payment_blocks', [])
    pb_opts = ''.join(f'<option value="{e}">{e}</option>' for pb in payment_blocks for e in [escape_html(pb)])
    pb_checkboxes = ''.join(f'<label><input type="checkbox" value="{escape_html(pb)}" onchange="togglePaymentBlock(this)"> {escape_html(pb)}</label>' for pb in payment_blocks)

    # Format weeks as DD-MM-YYYY for display
    def format_week_display(w):
        parts = w.split('-')
        if len(parts) == 3:
            return f"{parts[2]}-{parts[1]}-{parts[0]}"
        return w

    week_opts = ''.join(f'<option value="{w}">{format_week_display(w)}</option>' for w in selector_weeks)

    #  PART A: Per-week compressed blobs (lazy-load with LRU cache)
    # Cache in data dict to avoid recomputation when called from embedded paths.
    # JSON template mode replaces this whole data block with dashboard_data.js,
    # so placeholders avoid compressing historical weeks just to discard them.
    if placeholder_data:
        compressed_weeks_json = "{}"
        log.info("  [OK] Per-week compression: placeholder (JSON template mode)")
    elif '_cached_compressed_weeks_json' in data:
        compressed_weeks_json = data['_cached_compressed_weeks_json']
        log.info("  [OK] Per-week compression: cached (skipped recomputation)")
    else:
        compressed_weeks = {}
        total_orig = 0
        total_comp = 0
        for week_key in sorted_weeks:
            week_val = weeks_data[week_key]
            week_json = json.dumps(week_val, separators=(",", ":"), default=str)
            week_bytes = zlib.compress(week_json.encode("utf-8"), level=9)
            week_b64 = base64.b64encode(week_bytes).decode("ascii")
            compressed_weeks[week_key] = week_b64
            total_orig += len(week_json)
            total_comp += len(week_b64)
        compressed_weeks_json = json.dumps(compressed_weeks, separators=(",", ":"))
        data['_cached_compressed_weeks_json'] = compressed_weeks_json
        orig_mb = total_orig / (1024 * 1024)
        comp_mb = total_comp / (1024 * 1024)
        log.info("  [OK] Per-week compression: %.1f MB -> %.1f MB (%.1f%%)", orig_mb, comp_mb, comp_mb/orig_mb*100)

    #  PART B: YEAR_TREND_CUBE  pre-computed sparse cube for instant trend rendering
    # Cache in data dict to avoid recomputation
    if placeholder_data:
        year_trend_cube_json = '{"weeks":[],"combos":[]}'
        log.info("  [OK] Year Trend Cube: placeholder (JSON template mode)")
    elif '_cached_year_trend_cube_json' in data:
        year_trend_cube_json = data['_cached_year_trend_cube_json']
        log.info("  [OK] Year Trend Cube: cached (skipped recomputation)")
    else:
        year_trend_cube = compute_year_trend_cube(weeks_data, sorted_weeks)
        year_trend_cube_json = json.dumps(year_trend_cube, separators=(",", ":"), default=str)
        data['_cached_year_trend_cube_json'] = year_trend_cube_json
        log.info("  [OK] Year Trend Cube: %d combos, %.1f KB", len(year_trend_cube['combos']), len(year_trend_cube_json) / 1024)

    #  PART C: SyntheticReview compressed blob
    synthetic_review_data = data.get('synthetic_review')
    if placeholder_data:
        synthetic_review_b64 = ''
    elif synthetic_review_data:
        synthetic_review_json = json.dumps(synthetic_review_data, separators=(",", ":"), default=str)
        synthetic_review_bytes = zlib.compress(synthetic_review_json.encode("utf-8"), level=9)
        synthetic_review_b64 = base64.b64encode(synthetic_review_bytes).decode("ascii")
        log.info("  [OK] SyntheticReview embedded: %.1f KB -> %.1f KB", len(synthetic_review_json)/1024, len(synthetic_review_b64)/1024)
    else:
        synthetic_review_b64 = ''

    #  PART D: Statement compressed blob
    stmt_data = data.get('statement')
    if placeholder_data:
        stmt_b64 = ''
    elif stmt_data:
        stmt_json = json.dumps(stmt_data, separators=(",", ":"), default=str)
        stmt_bytes = zlib.compress(stmt_json.encode("utf-8"), level=9)
        stmt_b64 = base64.b64encode(stmt_bytes).decode("ascii")
        log.info("  [OK] Statement embedded: %.1f KB -> %.1f KB", len(stmt_json)/1024, len(stmt_b64)/1024)
    else:
        stmt_b64 = ''

    _html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AP Dashboard V13 HYBRID </title>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<style>__FA_CSS_INLINE__</style>
<script>__PAKO_JS_INLINE__</script>
<script>__CHART_JS_INLINE__</script>
<script>__CHART_DL_INLINE__</script>
{_load_css()}
</head>
<body>
<div id="loadingOverlay">
    <div class="loader-title">AP Control</div>
    <div class="loader-spinner"></div>
    <div class="loader-status" id="loadingStatus">Loading data...</div>
    <div class="loader-bar"><div class="loader-bar-fill" id="loadingBar"></div></div>
</div>
<div class="sidebar">
    <div class="logo">
        <div class="OK-brand"><span class="OK-e">Synthetic</span> <span class="OK-g">Group</span></div>
        <p>Ledger Control</p>
    </div>

    <div class="filter-section">
        <label class="filter-label" for="weekSelector"><i class="fa-regular fa-calendar"></i> Week</label>
        <select id="weekSelector">{week_opts}</select>
    </div>

    <div class="filter-section">
        <label class="filter-label" for="viewModeFilter"><i class="fa-solid fa-chart-line"></i> View Mode</label>
        <select id="viewModeFilter">
            <option value="VALUE">Value (Monetary)</option>
            <option value="SUPPLIERS">Suppliers (Volume)</option>
            <option value="TRANSACTIONS">Transactions (Volume)</option>
        </select>
    </div>

    <div class="filter-section">
        <div class="filter-label"><i class="fa-solid fa-scale-balanced"></i> Balance Type</div>
        <div class="multi-select-wrap" id="balanceTypeWrap">
            <div class="multi-select-display" onclick="this.parentElement.classList.toggle('open')">All</div>
            <div class="multi-select-dropdown">
                <div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllBalanceType();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearBalanceType();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>
                <label><input type="checkbox" value="DEBIT" onchange="toggleBalanceType(this)"> Debit (Positive)</label>
                <label><input type="checkbox" value="CREDIT" onchange="toggleBalanceType(this)"> Credit (Negative)</label>
            </div>
        </div>
    </div>

    <div class="filter-section">
        <div class="filter-label"><i class="fa-solid fa-globe"></i> Country</div>
        <div class="multi-select-wrap" id="countryWrap">
            <div class="multi-select-display" onclick="this.parentElement.classList.toggle('open')">All Countries</div>
            <div class="multi-select-dropdown">
                <div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllCountry();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearCountry();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>
                {country_checkboxes}
            </div>
        </div>
    </div>

    <div class="filter-section">
        <div class="filter-label"><i class="fa-solid fa-building"></i> Company Code</div>
        <div class="multi-select-wrap" id="companyCodeWrap">
            <div class="multi-select-display" onclick="this.parentElement.classList.toggle('open')">All Companies</div>
            <div class="multi-select-dropdown">
                <div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllCompanyCode();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearCompanyCode();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>
                {cc_checkboxes}
            </div>
        </div>
    </div>

    <div class="filter-section">
        <div class="filter-label"><i class="fa-solid fa-circle-check"></i> Status</div>
        <div class="multi-select-wrap" id="statusWrap">
            <div class="multi-select-display" onclick="this.parentElement.classList.toggle('open')">All Statuses</div>
            <div class="multi-select-dropdown">
                <div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllStatus();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearStatus();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>
            </div>
        </div>
    </div>

    <div class="filter-section">
        <div class="filter-label"><i class="fa-solid fa-magnifying-glass"></i> Query Type</div>
        <div class="multi-select-wrap" id="queryTypeWrap">
            <div class="multi-select-display" onclick="this.parentElement.classList.toggle('open')">All Query Types</div>
            <div class="multi-select-dropdown">
                <div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllQueryType();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearQueryType();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>
            </div>
        </div>
    </div>

    <div class="filter-section">
        <div class="filter-label"><i class="fa-solid fa-file-invoice"></i> Doc Category</div>
        <div class="multi-select-wrap" id="docCategoryWrap">
            <div class="multi-select-display" onclick="this.parentElement.classList.toggle('open')">All</div>
            <div class="multi-select-dropdown">
                <div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllDocCategory();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearDocCategory();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>
                <label><input type="checkbox" value="PAYMENT" onchange="toggleDocCategory(this)"> Payment</label>
                <label><input type="checkbox" value="INVOICE" onchange="toggleDocCategory(this)"> Invoice</label>
                <label><input type="checkbox" value="CREDIT_NOTE" onchange="toggleDocCategory(this)"> Credit Note</label>
            </div>
        </div>
    </div>

    <div class="filter-section">
        <div class="filter-label"><i class="fa-solid fa-user-tie"></i> Owner</div>
        <div class="multi-select-wrap" id="ownerWrap">
            <div class="multi-select-display" onclick="this.parentElement.classList.toggle('open')">All Owners</div>
            <div class="multi-select-dropdown">
                <div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllOwner();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearOwner();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>
                {owner_checkboxes}
            </div>
        </div>
    </div>

    <div class="filter-section">
        <div class="filter-label"><i class="fa-solid fa-tags"></i> Vendor Category</div>
        <div class="multi-select-wrap" id="vendorCategoryWrap">
            <div class="multi-select-display" onclick="this.parentElement.classList.toggle('open')">All Categories</div>
            <div class="multi-select-dropdown">
                <div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllVendorCategory();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearVendorCategory();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>
                {vc_checkboxes}
            </div>
        </div>
    </div>

    <div class="filter-section">
        <div class="filter-label"><i class="fa-solid fa-ban"></i> Payment Block</div>
        <div class="multi-select-wrap" id="paymentBlockWrap">
            <div class="multi-select-display" onclick="this.parentElement.classList.toggle('open')">All</div>
            <div class="multi-select-dropdown">
                <div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllPaymentBlock();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearPaymentBlock();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>
                {pb_checkboxes}
            </div>
        </div>
    </div>

    <div class="filter-section">
        <div class="filter-label"><i class="fa-solid fa-layer-group"></i> Aging Bucket</div>
        <div class="multi-select-wrap" id="globalBucketWrap">
            <div class="multi-select-display" onclick="this.parentElement.classList.toggle('open')">All Buckets</div>
            <div class="multi-select-dropdown">
                <div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllGlobalBucket();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearGlobalBucket();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>
                <label><input type="checkbox" value="NOT_OVERDUE" onchange="toggleGlobalBucket(this)"> Not Overdue</label>
                <label><input type="checkbox" value="ALL_OVERDUE" onchange="toggleGlobalBucket(this)"> All Overdue</label>
                <label style="border-top:1px solid rgba(255,255,255,0.1);margin-top:2px;padding-top:0.3rem;"><input type="checkbox" value="0-30" onchange="toggleGlobalBucket(this)"> 0-30 Days</label>
                <label><input type="checkbox" value="31-60" onchange="toggleGlobalBucket(this)"> 31-60 Days</label>
                <label><input type="checkbox" value="61-90" onchange="toggleGlobalBucket(this)"> 61-90 Days</label>
                <label><input type="checkbox" value="91-120" onchange="toggleGlobalBucket(this)"> 91-120 Days</label>
                <label><input type="checkbox" value="121-180" onchange="toggleGlobalBucket(this)"> 121-180 Days</label>
                <label><input type="checkbox" value="180+" onchange="toggleGlobalBucket(this)"> 180+ Days</label>
            </div>
        </div>
    </div>

    <div class="filter-section">
        <label class="filter-label" for="supplierSearch"><i class="fa-solid fa-magnifying-glass"></i> Search Supplier</label>
        <input type="text" id="supplierSearch" placeholder="Name or number..." style="width:100%;padding:0.35rem 0.6rem;border:1px solid rgba(255,255,255,0.2);border-radius:6px;background:rgba(255,255,255,0.1);color:white;font-size:0.75rem;outline:none;">
    </div>

    <div class="filter-section" style="margin-top: 0.4rem;">
        <button id="refreshFiltersBtn" style="
            width: 100%;
            padding: 0.45rem;
            background: linear-gradient(135deg, var(--accent), var(--primary));
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            font-size: 0.75rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.4rem;
            transition: all 0.2s;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <i class="fa-solid fa-arrows-rotate"></i> Refresh Filters
        </button>
    </div>

    <div class="nav-divider"></div>

    <ul class="nav-menu">
        <li class="nav-item active" data-page="overview"><i class="fa-solid fa-chart-line"></i> Overview</li>
        <li class="nav-item" data-page="key"><i class="fa-solid fa-key"></i> Key Team</li>
        <li class="nav-item" data-page="rol"><i class="fa-solid fa-chart-bar"></i> ROL Team</li>
        <li class="nav-item" data-page="productivity"><i class="fa-solid fa-gauge-high"></i> Productivity</li>
        <li class="nav-item" data-page="overdue"><i class="fa-solid fa-chart-column"></i> Overdue Insights</li>
        <li class="nav-item" data-page="synthetic_review"><i class="fa-solid fa-magnifying-glass-dollar"></i> SyntheticReview</li>
        <li class="nav-item" data-page="statement"><i class="fa-solid fa-file-invoice-dollar"></i> Statement</li>
        <li class="nav-item" data-page="storebookZr"><i class="fa-solid fa-book-open"></i> Storebook / Z & R</li>
        <li class="nav-item" data-page="escalation"><i class="fa-solid fa-triangle-exclamation"></i> Escalations</li>
    </ul>

    <div class="sidebar-footer">V1  Generated {datetime.now().strftime('%d %b %Y %H:%M')}</div>
</div>

<div class="main-content">
    <!-- Theme Toggle Button -->
    <button id="themeToggleBtn" onclick="toggleTheme()" title="Switch theme" style="position:fixed;top:12px;right:20px;z-index:999;width:38px;height:38px;border-radius:50%;border:1px solid rgba(128,128,128,0.3);background:rgba(255,255,255,0.9);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:all 0.3s ease;" aria-label="Toggle theme"></button>
    <div class="page active" id="overview">
        <div class="page-header">
            <h1 class="page-title"> Overview Dashboard</h1>
            <p class="page-subtitle">Consolidated view  ROL & Key Teams</p>
        </div>
        <div style="margin-bottom:1rem;display:flex;align-items:center;gap:1rem;">
            <select id="overviewTeamFilter" style="padding:0.5rem 1rem;border:2px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);font-size:0.9rem;font-weight:600;cursor:pointer;">
                <option value="">All Teams (ROL + Key)</option>
                <option value="ROL">ROL</option>
                <option value="KEY">Key</option>
            </select>
        </div>
        <div class="kpi-grid" id="overview-kpis"></div>
        <div class="chart-grid">
            <div class="chart-container">
                <div class="chart-title"><i class="fa-solid fa-tags"></i> Query Type Distribution</div>
                <canvas id="queryTypeChart" height="200"></canvas>
            </div>
            <div class="chart-container">
                <div class="chart-title"><i class="fa-solid fa-building-columns"></i> Top Entities</div>
                <canvas id="entityChart"></canvas>
            </div>
        </div>
        <div class="chart-grid" style="grid-template-columns: 1fr;">
            <div class="chart-container" style="grid-column: 1 / -1">
                <div class="chart-title"><i class="fa-solid fa-chart-line"></i> Weekly <span id="trendModeLabel">Balance</span> Trend</div>
                <div id="trendFilterNotice" style="display:none; padding:6px 12px; margin-bottom:8px; background:#FFF3CD; border-radius:6px; font-size:0.78rem; color:#856404; border:1px solid #FFEEBA;">
                    <i class="fa-solid fa-info-circle"></i> Bucket Filter / Supplier Search active  Year Trend computed from raw data (may take a few seconds).
                </div>
                <canvas id="trendLineChart" height="180"></canvas>
            </div>
        </div>
        <div class="table-container">
            <div class="table-header">
                <div class="table-title"><i class="fa-solid fa-building" style="color: #FFC107"></i> Supplier Overview</div>
                <div class="table-controls">
                    <button class="toggle-btn active" id="ovTableTeamAll" onclick="setOverviewTableTeam('')">All</button>
                    <button class="toggle-btn" id="ovTableTeamKey" onclick="setOverviewTableTeam('KEY')">Key</button>
                    <button class="toggle-btn" id="ovTableTeamROL" onclick="setOverviewTableTeam('ROL')">ROL</button>
                    <span style="width:1px;height:20px;background:var(--border);margin:0 0.25rem"></span>
                    <select id="topSupplierBalanceType" style="margin-right: 0.5rem; padding: 0.4rem 0.6rem; border-radius: 6px; border: 1px solid #ddd; font-size: 0.8rem;">
                        <option value="ALL">All Balance Types</option>
                        <option value="CREDIT">Credit Only (< 0)</option>
                        <option value="DEBIT">Debit Only (> 0)</option>
                    </select>
                    <select class="page-size-select" id="overviewPageSize" onchange="changePageSize('overview', +this.value)">
                        <option value="10" selected>10 rows</option>
                        <option value="20">20 rows</option>
                        <option value="50">50 rows</option>
                    </select>
                    <button class="toggle-btn" onclick="exportOverviewCSV()" title="Export CSV"><i class="fa-solid fa-download"></i> CSV</button>
                </div>
            </div>
            <div style="overflow-x:auto"><table id="overviewTable"></table></div>
            <div id="overviewPagination" class="pagination-bar"></div>
        </div>
        <div class="table-container" id="supplierMovementSection">
            <div class="table-header">
                <div class="table-title" id="movementTitle"><i class="fa-solid fa-arrow-right-arrow-left" style="color:var(--accent)"></i> Supplier Movement</div>
                <div class="table-controls">
                    <label for="movWeek1" style="font-size:0.75rem;color:var(--text-secondary);font-weight:600">Current</label>
                    <select class="page-size-select" id="movWeek1" style="min-width:110px">{week_opts}</select>
                    <label for="movWeek2" style="font-size:0.75rem;color:var(--text-secondary);font-weight:600">Compare</label>
                    <select class="page-size-select" id="movWeek2" style="min-width:110px">{week_opts}</select>
                    <span style="width:1px;height:20px;background:var(--border);margin:0 0.25rem"></span>
                    <button class="toggle-btn active" id="movTeamAll" onclick="setMovementTeam('')">All</button>
                    <button class="toggle-btn" id="movTeamKey" onclick="setMovementTeam('KEY')">Key</button>
                    <button class="toggle-btn" id="movTeamROL" onclick="setMovementTeam('ROL')">ROL</button>
                    <span style="width:1px;height:20px;background:var(--border);margin:0 0.25rem"></span>
                    <span id="movStatusFilter" style="display:inline-flex;gap:0.35rem;">
                        <button class="toggle-btn active" data-status="" onclick="setMovementStatus('')">All</button>
                        <button class="toggle-btn" data-status="New" onclick="setMovementStatus('New')">New</button>
                        <button class="toggle-btn" data-status="Cleared" onclick="setMovementStatus('Cleared')">Cleared</button>
                        <button class="toggle-btn" data-status="Increased" onclick="setMovementStatus('Increased')">Increased</button>
                        <button class="toggle-btn" data-status="Decreased" onclick="setMovementStatus('Decreased')">Decreased</button>
                    </span>
                    <select class="page-size-select" id="movementPageSize" onchange="changePageSize('movement', +this.value)">
                        <option value="10" selected>10 rows</option>
                        <option value="20">20 rows</option>
                        <option value="50">50 rows</option>
                    </select>
                    <button class="toggle-btn" onclick="exportMovementCSV()" title="Export CSV"><i class="fa-solid fa-download"></i> CSV</button>
                </div>
            </div>
            <div class="kpi-grid" id="movement-kpis" style="grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));"></div>
            <div style="overflow-x:auto"><table id="movementTable"></table></div>
            <div id="movementPagination" class="pagination-bar"></div>
        </div>
    </div>

    <!--  -->
    <!-- DYNAMIC TEAM PAGES -->
    <!--  -->
'''
    for team_id, cfg in TEAM_CONFIG.items():
        _html += _team_page_html(team_id, cfg)

    _html += f'''
    <div class="page" id="productivity">
        <div class="page-header">
            <h1 class="page-title"> Productivity Dashboard</h1>
            <p class="page-subtitle">Owner performance  Work done within selected week only</p>
        </div>
        <div style="background: linear-gradient(135deg, #1E2761 0%, #2A3875 100%); color: white; padding: 1rem 1.5rem; border-radius: var(--radius); margin-bottom: 1.5rem; display: flex; align-items: center; gap: 1rem; font-size: 0.85rem;">
            <i class="fa-solid fa-circle-info" style="font-size: 1.1rem; color: var(--accent);"></i>
            <div><strong>Portfolio</strong> = Total snapshot balance. <strong style="color: var(--accent);">Work Log</strong> = Only items with Action Date within the selected week.</div>
        </div>
        <div class="kpi-grid" id="prod-kpis"></div>
        <div style="background: var(--card); border-radius: 12px; padding: 1rem 1.5rem; margin-bottom: 1.5rem; box-shadow: var(--shadow); display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 16px; align-items: end;">
            <div>
                <label for="prodTeamFilter" style="display:block;color:var(--text-muted);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;"><i class="fa-solid fa-filter"></i> Team</label>
                <select id="prodTeamFilter" style="width:100%;padding:0.4rem 0.5rem;color:var(--text);background:var(--card);border:2px solid var(--border);border-radius:6px;font-size:0.8rem;">
                    <option value="">All Teams (ROL + Key)</option>
                    <option value="KEY">Key Only</option>
                    <option value="ROL">ROL Only</option>
                </select>
            </div>
            <div>
                <label for="workedCategoryFilter" style="display:block;color:var(--text-muted);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;"><i class="fa-solid fa-filter"></i> Worked Category</label>
                <select id="workedCategoryFilter" style="width:100%;padding:0.4rem 0.5rem;color:var(--text);background:var(--card);border:2px solid var(--border);border-radius:6px;font-size:0.8rem;">
                    <option value="">All</option>
                    <option value="NOT_OVERDUE">Not overdue worked</option>
                    <option value="OVERDUE">Overdue worked</option>
                </select>
            </div>
            <div>
                <div style="display:block;color:var(--text-muted);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;"><i class="fa-solid fa-calendar-days"></i> Action Date Range</div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <input type="date" id="prodDateFrom" aria-label="Productivity action date from" style="padding:0.4rem 0.5rem;border:2px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:0.8rem;flex:1;">
                    <span style="color:var(--text-muted);font-size:0.8rem;">to</span>
                    <input type="date" id="prodDateTo" aria-label="Productivity action date to" style="padding:0.4rem 0.5rem;border:2px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:0.8rem;flex:1;">
                    <button onclick="clearProdDates()" style="padding:0.3rem 0.5rem;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text-muted);cursor:pointer;font-size:0.75rem;" title="Clear dates">X</button>
                    <span style="color:var(--text-muted);font-size:0.65rem;opacity:0.7;white-space:nowrap;">Empty = week</span>
                </div>
            </div>
        </div>
        <div class="chart-grid">
            <div class="chart-container">
                <div class="chart-title" id="prodChartTitle"><i class="fa-solid fa-users"></i> Work by Owner (This Week)</div>
                <canvas id="prodWorkChart" height="260"></canvas>
                <div class="chart-hint"> Click to filter</div>
            </div>
            <div class="chart-container">
                <div class="chart-title"><i class="fa-solid fa-chart-pie"></i> Portfolio vs Worked</div>
                <canvas id="prodPieChart"></canvas>
            </div>
            <div class="chart-container" style="height:420px;grid-column:1/-1;overflow:visible">
                <div class="chart-title"><i class="fa-solid fa-chart-line"></i> Weekly Actioned Docs Trend</div>
                <canvas id="productivityWeeklyTrend" height="360"></canvas>
            </div>
        </div>
        <div class="table-container">
            <div class="table-header">
                <div class="table-title"><i class="fa-solid fa-gauge-high" style="color: var(--primary)"></i> Productivity Scorecard</div>
                <div class="table-controls">
                    <button class="toggle-btn" onclick="exportTableCSV('productivityScorecardTable','productivity_scorecard.csv')" title="Export CSV"><i class="fa-solid fa-download"></i> CSV</button>
                </div>
            </div>
            <div class="kpi-grid" id="productivityScorecardKpis" style="margin: 0 1rem 1rem 1rem;"></div>
            <div style="overflow-x:auto"><table id="productivityScorecardTable"></table></div>
        </div>
        <div class="table-container">
            <div class="table-header">
                <div class="table-title"><i class="fa-solid fa-clipboard-check" style="color: var(--orange)"></i> Resolution Quality</div>
                <div class="table-controls">
                    <select id="resolvedCarryoverPair" onchange="renderResolutionQuality()" style="padding:0.4rem 0.5rem;border:2px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:0.8rem;min-width:120px;"></select>
                    <select id="resolvedCarryoverMode" onchange="renderResolutionQuality()" style="padding:0.4rem 0.5rem;border:2px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:0.8rem;">
                        <option value="all" selected>All resolved carryover</option>
                        <option value="actioned">With action date only</option>
                    </select>
                    <select id="resolvedCarryoverSource" onchange="renderResolutionQuality()" style="padding:0.4rem 0.5rem;border:2px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:0.8rem;">
                        <option value="all" selected>All sources</option>
                        <option value="key">Key</option>
                        <option value="rol">ROL</option>
                    </select>
                    <select id="resolvedCarryoverOwner" onchange="renderResolutionQuality()" style="padding:0.4rem 0.5rem;border:2px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:0.8rem;"></select>
                    <select id="resolvedCarryoverConfidence" onchange="renderResolutionQuality()" style="padding:0.4rem 0.5rem;border:2px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:0.8rem;">
                        <option value="all" selected>All confidence</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                    </select>
                    <select class="page-size-select" id="resolvedCarryoverPageSize" onchange="changePageSize('resolvedCarryover', +this.value)">
                        <option value="10" selected>10 rows</option>
                        <option value="20">20 rows</option>
                        <option value="50">50 rows</option>
                    </select>
                    <button class="toggle-btn" onclick="exportTableCSV('resolvedCarryoverTable','resolution_quality.csv')" title="Export CSV"><i class="fa-solid fa-download"></i> CSV</button>
                </div>
            </div>
            <div class="kpi-grid" id="resolvedCarryoverKpis" style="margin: 0 1rem 1rem 1rem;"></div>
            <div style="overflow-x:auto"><table id="resolvedCarryoverTable"></table></div>
            <div id="resolvedCarryoverPagination" class="pagination-bar"></div>
            <div class="chart-grid" style="margin-top:1rem;">
                <div class="chart-container" style="height:320px;"><div class="chart-title"><i class="fa-solid fa-users"></i> Carryover by Owner</div><canvas id="resolvedCarryoverOwnerChart"></canvas></div>
                <div class="chart-container" style="height:320px;"><div class="chart-title"><i class="fa-solid fa-chart-line"></i> Failed Resolution Rate by Week</div><canvas id="resolvedCarryoverTrendChart"></canvas></div>
            </div>
        </div>        <div class="table-container">
            <div class="table-header">
                <div class="table-title"><i class="fa-solid fa-gauge-high" style="color: var(--primary)"></i> Owner Performance</div>
                <div class="table-controls">
                    <button class="toggle-btn" onclick="toggleTable('prod', 15, event)">Top 15</button>
                    <button class="toggle-btn active" onclick="toggleTable('prod', 9999, event)">All</button>
                    <button class="toggle-btn" onclick="exportTableCSV('prodTable','productivity.csv')" title="Export CSV"><i class="fa-solid fa-download"></i> CSV</button>
                </div>
            </div>
            <div style="overflow-x:auto"><table id="prodTable"></table></div>
        </div>
        <div class="table-container">
            <div class="table-header">
                <div class="table-title"><i class="fa-solid fa-list-check" style="color: var(--accent)"></i> Worked Suppliers Detail</div>
                <div class="table-controls">
                    <span style="font-size:0.75rem;color:var(--text-muted);margin-right:0.5rem"><i class="fa-solid fa-arrow-trend-up" style="color:#dc3545"></i> Worse | <i class="fa-solid fa-arrow-trend-down" style="color:#02c39a"></i> Better</span>
                    <select class="page-size-select" id="workedSuppliersPageSize" onchange="changePageSize('workedSuppliers', +this.value)">
                        <option value="10" selected>10 rows</option>
                        <option value="20">20 rows</option>
                        <option value="50">50 rows</option>
                    </select>
                    <button class="toggle-btn" onclick="exportWorkedSuppliersCSV()" title="Export CSV"><i class="fa-solid fa-download"></i> CSV</button>
                </div>
            </div>
            <div style="overflow-x:auto"><table id="workedSuppliersTable"></table></div>
            <div id="workedSuppliersPagination" class="pagination-bar"></div>
        </div>
    </div>

    <div class="page" id="overdue">
        <div class="page-header">
            <h1 class="page-title"> Overdue Insights</h1>
            <p class="page-subtitle">Dual-week comparative analysis  Aging bucket trends by owner</p>
        </div>
        
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 12px; margin-bottom: 24px; box-shadow: 0 4px 12px rgba(102,126,234,0.3);">
            <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px;">
                <div>
                    <label for="overdueWeek1" style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"> Week 1 (Current)</label>
                    <select id="overdueWeek1" style="width: 100%; padding: 10px; border: 2px solid var(--border); border-radius: 8px; background: var(--card); color: var(--text); font-weight: 600; font-size: 0.95rem; cursor: pointer;">
                        {week_opts}
                    </select>
                </div>
                <div>
                    <label for="overdueWeek2" style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"> Week 2 (Compare)</label>
                    <select id="overdueWeek2" style="width: 100%; padding: 10px; border: 2px solid var(--border); border-radius: 8px; background: var(--card); color: var(--text); font-weight: 600; font-size: 0.95rem; cursor: pointer;">
                        {week_opts}
                    </select>
                </div>
                <div>
                    <div style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"> Team Filter</div>
                    <div class="multi-select-wrap" id="overdueTeamWrap" style="position:relative;">
                        <div class="multi-select-display" onclick="this.parentElement.classList.toggle('open')" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;background:var(--card);font-weight:600;font-size:0.95rem;cursor:pointer;color:var(--text);">All Teams</div>
                        <div class="multi-select-dropdown" style="background:#1e293b;color:white;">
                            <div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllOverdueTeam();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearOverdueTeam();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>
                            <label><input type="checkbox" value="KEY" onchange="toggleOverdueTeam(this)"> Key Team</label>
                            <label><input type="checkbox" value="ROL" onchange="toggleOverdueTeam(this)"> ROL Team</label>
                        </div>
                    </div>
                </div>
                <div>
                    <div style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"> Aging Bucket</div>
                    <div class="multi-select-wrap" id="overdueAgingWrap" style="position:relative;">
                        <div class="multi-select-display" onclick="this.parentElement.classList.toggle('open')" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;background:var(--card);font-weight:600;font-size:0.95rem;cursor:pointer;color:var(--text);">All Buckets</div>
                        <div class="multi-select-dropdown" style="background:#1e293b;color:white;">
                            <div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllOverdueAging();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearOverdueAging();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>
                            <label><input type="checkbox" value="NOT_OVERDUE" onchange="toggleOverdueAging(this)"> Not Overdue</label>
                            <label><input type="checkbox" value="ALL_OVERDUE" onchange="toggleOverdueAging(this)"> All Overdue</label>
                            <label style="border-top:1px solid rgba(255,255,255,0.1);margin-top:2px;padding-top:0.4rem;"><input type="checkbox" value="0-30" onchange="toggleOverdueAging(this)"> 0-30 Days</label>
                            <label><input type="checkbox" value="31-60" onchange="toggleOverdueAging(this)"> 31-60 Days</label>
                            <label><input type="checkbox" value="61-90" onchange="toggleOverdueAging(this)"> 61-90 Days</label>
                            <label><input type="checkbox" value="91-120" onchange="toggleOverdueAging(this)"> 91-120 Days</label>
                            <label><input type="checkbox" value="121-180" onchange="toggleOverdueAging(this)"> 121-180 Days</label>
                            <label><input type="checkbox" value="180+" onchange="toggleOverdueAging(this)"> 180+ Days</label>
                        </div>
                    </div>
                </div>
                <div>
                    <label for="overdueCountrySliceFilter" style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"> Country Slice</label>
                    <select id="overdueCountrySliceFilter" style="width: 100%; padding: 10px; border: 2px solid var(--border); border-radius: 8px; background: var(--card); color: var(--text); font-weight: 600; font-size: 0.95rem; cursor: pointer;">
                        <option value="">All Countries</option>
                    </select>
                </div>
                <div>
                    <div style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"> Company Code</div>
                    <div class="multi-select-wrap" id="overdueCompanyWrap" style="background: var(--card); border-radius: 8px; border: 2px solid var(--border);">
                        <div class="multi-select-display" style="color: var(--text); font-weight: 600; font-size: 0.95rem; padding: 10px;" onclick="this.parentElement.classList.toggle('open')">All Companies</div>
                        <div class="multi-select-dropdown" id="overdueCompanyDropdown" style="background: var(--card); color: var(--text);">
                            <div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllOverdueCompany();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearOverdueCompany();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="kpi-grid" id="overdue-kpis"></div>

        <div class="chart-grid">
            <div class="chart-container" style="grid-column: 1 / -1;">
                <div class="chart-title"><i class="fa-solid fa-users"></i> Vendors Comparison by Owner</div>
                <div style="height: 350px; position: relative;">
                    <canvas id="overdueVendorsChart"></canvas>
                </div>
                <div class="chart-hint">Blue bars: Week 1  Dark blue bars: Week 2  Comparing vendor counts side-by-side</div>
            </div>
            <div class="chart-container" style="grid-column: 1 / -1;">
                <div class="chart-title"><i class="fa-solid fa-file-invoice"></i> Documents Comparison by Owner</div>
                <div style="height: 350px; position: relative;">
                    <canvas id="overdueDocsChart"></canvas>
                </div>
                <div class="chart-hint">Blue bars: Week 1  Dark blue bars: Week 2  Comparing document counts side-by-side</div>
            </div>
            <div class="chart-container" style="grid-column: 1 / -1">
                <div class="chart-title"><i class="fa-solid fa-users-gear"></i> Aging Exposure by Owner</div>
                <div style="height: 420px; position: relative;">
                    <canvas id="agingByOwnerChart"></canvas>
                </div>
                <div class="chart-hint">Shows absolute monetary exposure per aging bucket per owner. Stacked bars represent magnitude of both debits and credits.</div>
            </div>
        </div>

        <div class="table-container">
            <div class="table-header">
                <div class="table-title"><i class="fa-solid fa-table" style="color: var(--primary)"></i> Detailed Owner Comparison</div>
            </div>
            <div style="overflow-x:auto"><table id="overdueTable"></table></div>
        </div>
    </div>

    <!--  SYNTHETIC_REVIEW TAB  -->
    <div class="page" id="synthetic_review">
        <div class="page-header">
            <h1 class="page-title"><i class="fa-solid fa-magnifying-glass-dollar"></i> SyntheticReview - Invoice Intelligence</h1>
            <p class="page-subtitle">Duplicate invoices & invoice errors  Daily snapshot analysis</p>
        </div>

        <!-- Filter Bar -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 12px; margin-bottom: 24px; box-shadow: 0 4px 12px rgba(102,126,234,0.3);">
            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 12px;">
                <div>
                    <label for="synthetic_reviewDateFrom" style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-regular fa-calendar"></i> Date From</label>
                    <input type="date" id="synthetic_reviewDateFrom" style="width: 100%; padding: 10px; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; background: #0f172a; color: #e2e8f0; font-weight: 600; font-size: 0.95rem; cursor: pointer; box-sizing: border-box;">
                </div>
                <div>
                    <label for="synthetic_reviewDateTo" style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-regular fa-calendar-check"></i> Date To</label>
                    <input type="date" id="synthetic_reviewDateTo" style="width: 100%; padding: 10px; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; background: #0f172a; color: #e2e8f0; font-weight: 600; font-size: 0.95rem; cursor: pointer; box-sizing: border-box;">
                </div>
                <div>
                    <div style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-solid fa-layer-group"></i> Source Type</div>
                    <div class="xms" id="xms_source">
                        <div class="xms-btn" onclick="xmsToggle('xms_source')"><span class="xms-label" data-all="All Types">All Types</span><i class="fa-solid fa-chevron-down" style="font-size:0.65rem;opacity:0.5"></i></div>
                        <div class="xms-panel" id="xms_source_panel">
                            <label><input type="checkbox" value="Invoice Error" onchange="xmsUpdate('xms_source')"> Invoice Errors</label>
                            <label><input type="checkbox" value="Duplicate Invoice" onchange="xmsUpdate('xms_source')"> Duplicate Invoices</label>
                        </div>
                    </div>
                </div>
                <div>
                    <div style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-solid fa-triangle-exclamation"></i> Risk</div>
                    <div class="xms" id="xms_risk">
                        <div class="xms-btn" onclick="xmsToggle('xms_risk')"><span class="xms-label" data-all="All Risk">All Risk</span><i class="fa-solid fa-chevron-down" style="font-size:0.65rem;opacity:0.5"></i></div>
                        <div class="xms-panel" id="xms_risk_panel">
                            <label><input type="checkbox" value="High" onchange="xmsUpdate('xms_risk')"> High</label>
                            <label><input type="checkbox" value="Medium" onchange="xmsUpdate('xms_risk')"> Medium</label>
                            <label><input type="checkbox" value="Low" onchange="xmsUpdate('xms_risk')"> Low</label>
                        </div>
                    </div>
                </div>
                <div>
                    <div style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-solid fa-rotate"></i> Recovery</div>
                    <div class="xms" id="xms_recovery">
                        <div class="xms-btn" onclick="xmsToggle('xms_recovery')"><span class="xms-label" data-all="All">All</span><i class="fa-solid fa-chevron-down" style="font-size:0.65rem;opacity:0.5"></i></div>
                        <div class="xms-panel" id="xms_recovery_panel"></div>
                    </div>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px;">
                <div>
                    <div style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-solid fa-people-group"></i> Team</div>
                    <div class="xms" id="xms_team">
                        <div class="xms-btn" onclick="xmsToggle('xms_team')"><span class="xms-label" data-all="All Teams">All Teams</span><i class="fa-solid fa-chevron-down" style="font-size:0.65rem;opacity:0.5"></i></div>
                        <div class="xms-panel" id="xms_team_panel">
                            <label><input type="checkbox" value="ROL" onchange="xmsUpdate('xms_team')"> ROL</label>
                            <label><input type="checkbox" value="Key" onchange="xmsUpdate('xms_team')"> Key</label>
                        </div>
                    </div>
                </div>
                <div>
                    <div style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-solid fa-user"></i> Owner</div>
                    <div class="xms" id="xms_owner">
                        <div class="xms-btn" onclick="xmsToggle('xms_owner')"><span class="xms-label" data-all="All Owners">All Owners</span><i class="fa-solid fa-chevron-down" style="font-size:0.65rem;opacity:0.5"></i></div>
                        <div class="xms-panel" id="xms_owner_panel"></div>
                    </div>
                </div>
                <div>
                    <div style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-solid fa-earth-europe"></i> Country</div>
                    <div class="xms" id="xms_country">
                        <div class="xms-btn" onclick="xmsToggle('xms_country')"><span class="xms-label" data-all="All Countries">All Countries</span><i class="fa-solid fa-chevron-down" style="font-size:0.65rem;opacity:0.5"></i></div>
                        <div class="xms-panel" id="xms_country_panel"></div>
                    </div>
                </div>
                <div>
                    <div style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-solid fa-building"></i> Company Code</div>
                    <div class="xms" id="xms_cc">
                        <div class="xms-btn" onclick="xmsToggle('xms_cc')"><span class="xms-label" data-all="All Companies">All Companies</span><i class="fa-solid fa-chevron-down" style="font-size:0.65rem;opacity:0.5"></i></div>
                        <div class="xms-panel" id="xms_cc_panel"></div>
                    </div>
                </div>
                <div>
                    <div style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-solid fa-chart-pie"></i> Category</div>
                    <div class="xms" id="xms_cat">
                        <div class="xms-btn" onclick="xmsToggle('xms_cat')"><span class="xms-label" data-all="All Categories">All Categories</span><i class="fa-solid fa-chevron-down" style="font-size:0.65rem;opacity:0.5"></i></div>
                        <div class="xms-panel" id="xms_cat_panel"></div>
                    </div>
                </div>
                <div style="display: flex; align-items: flex-end;">
                    <button onclick="resetSyntheticReviewFilters()" style="width: 100%; padding: 10px; border: 2px solid rgba(255,255,255,0.3); border-radius: 8px; background: rgba(255,255,255,0.15); color: white; font-weight: 700; font-size: 0.95rem; cursor: pointer; transition: all 0.3s;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'"><i class="fa-solid fa-arrows-rotate"></i> Reset Filters</button>
                </div>
            </div>
        </div>

        <!-- KPI Cards -->
        <div class="kpi-grid" id="synthetic_review-kpis" style="grid-template-columns: repeat(6, 1fr);"></div>

        <!-- Charts -->
        <div class="chart-grid">
            <div class="chart-container">
                <div class="chart-title"><i class="fa-solid fa-people-group"></i> Items by Owner</div>
                <div style="height: 340px; position: relative;"><canvas id="synthetic_reviewOwnerChart"></canvas></div>
            </div>
            <div class="chart-container">
                <div class="chart-title"><i class="fa-solid fa-chart-pie"></i> Risk Distribution</div>
                <div style="height: 300px; position: relative;"><canvas id="synthetic_reviewRiskChart"></canvas></div>
            </div>
            <div class="chart-container">
                <div class="chart-title"><i class="fa-solid fa-tags"></i> Classification Breakdown</div>
                <div style="height: 300px; position: relative;"><canvas id="synthetic_reviewClassChart"></canvas></div>
            </div>
            <div class="chart-container">
                <div class="chart-title"><i class="fa-solid fa-earth-europe"></i> By Country</div>
                <div style="height: 300px; position: relative;"><canvas id="synthetic_reviewRegionChart"></canvas></div>
            </div>
            <div class="chart-container">
                <div class="chart-title"><i class="fa-solid fa-chart-line"></i> Weekly Trend</div>
                <div style="height:260px;position:relative;"><canvas id="synthetic_reviewWeeklyTrendChart"></canvas></div>
            </div>
        </div>

        <!-- Duplicate Invoices Table -->
        <div class="table-container" id="synthetic_reviewDupesContainer">
            <div class="table-header">
                <div class="table-title"><i class="fa-solid fa-copy" style="color: #0D6EFD"></i> Duplicate Invoices</div>
                <div style="display:flex;gap:12px;align-items:center;">
                    <select class="page-size-select" id="synthetic_reviewDupesPageSize" onchange="changeSyntheticReviewTableSize('synthetic_reviewDupes',+this.value)">
                        <option value="10">10 rows</option><option value="20">20 rows</option><option value="50">50 rows</option><option value="100">100 rows</option>
                    </select>
                    <button class="toggle-btn" onclick="exportSyntheticReviewTableCSV('dupes')" title="Export CSV"><i class="fa-solid fa-download"></i> CSV</button>
                </div>
            </div>
            <div style="overflow-x:auto"><table id="synthetic_reviewDupesTable"></table></div>
            <div id="synthetic_reviewDupesPagination" class="pagination-bar"></div>
        </div>

        <!-- Invoice Errors Table -->
        <div class="table-container" id="synthetic_reviewErrorsContainer">
            <div class="table-header">
                <div class="table-title"><i class="fa-solid fa-triangle-exclamation" style="color: #DC3545"></i> Invoice Errors</div>
                <div style="display:flex;gap:12px;align-items:center;">
                    <select class="page-size-select" id="synthetic_reviewErrorsPageSize" onchange="changeSyntheticReviewTableSize('synthetic_reviewErrors',+this.value)">
                        <option value="10">10 rows</option><option value="20">20 rows</option><option value="50">50 rows</option><option value="100">100 rows</option>
                    </select>
                    <button class="toggle-btn" onclick="exportSyntheticReviewTableCSV('errors')" title="Export CSV"><i class="fa-solid fa-download"></i> CSV</button>
                </div>
            </div>
            <div style="overflow-x:auto"><table id="synthetic_reviewErrorsTable"></table></div>
            <div id="synthetic_reviewErrorsPagination" class="pagination-bar"></div>
        </div>

        <!-- No Data Warning -->
        <div id="synthetic_reviewNoData" style="display:none; text-align:center; padding:60px 20px;">
            <i class="fa-solid fa-database" style="font-size:48px; color:#ccc; margin-bottom:16px; display:block;"></i>
            <h3 style="color:#666; margin-bottom:8px;">No SyntheticReview Data Available</h3>
            <p style="color:#999;">Run <code>synthetic_review_loader.py</code> to load Excel files into the database.</p>
        </div>
    </div>

    <!--  STATEMENT PAGE  -->
    <div class="page" id="statement">
        <div class="page-header">
            <h1 class="page-title"><i class="fa-solid fa-file-invoice-dollar"></i> Statement - Vendor Reconciliation</h1>
            <p class="page-subtitle">Vendor statement reconciliation  Weekly snapshot analysis</p>
        </div>

        <!-- Filter Bar -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 12px; margin-bottom: 24px; box-shadow: 0 4px 12px rgba(102,126,234,0.3);">
            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 12px;">
                <div>
                    <label for="stmtDateFrom" style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-regular fa-calendar"></i> Date From</label>
                    <input type="date" id="stmtDateFrom" style="width: 100%; padding: 10px; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; background: #0f172a; color: #e2e8f0; font-weight: 600; font-size: 0.95rem; cursor: pointer; box-sizing: border-box; color-scheme: dark;">
                </div>
                <div>
                    <label for="stmtDateTo" style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-regular fa-calendar-check"></i> Date To</label>
                    <input type="date" id="stmtDateTo" style="width: 100%; padding: 10px; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; background: #0f172a; color: #e2e8f0; font-weight: 600; font-size: 0.95rem; cursor: pointer; box-sizing: border-box; color-scheme: dark;">
                </div>
                <div>
                    <label for="stmtCountry" style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-solid fa-earth-europe"></i> Country</label>
                    <select id="stmtCountry" style="width: 100%; padding: 10px; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; background: #0f172a; color: #e2e8f0; font-weight: 600; font-size: 0.95rem; cursor: pointer; box-sizing: border-box;">
                        <option value="">All Countries</option>
                    </select>
                </div>
                <div>
                    <label for="stmtRecStatus" style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-solid fa-circle-check"></i> Rec Status</label>
                    <select id="stmtRecStatus" style="width: 100%; padding: 10px; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; background: #0f172a; color: #e2e8f0; font-weight: 600; font-size: 0.95rem; cursor: pointer; box-sizing: border-box;">
                        <option value="">All</option>
                        <option value="Unreconciled">Unreconciled</option>
                        <option value="Reconciled">Reconciled</option>
                    </select>
                </div>
                <div>
                    <label for="stmtTeam" style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-solid fa-people-group"></i> Team</label>
                    <select id="stmtTeam" style="width: 100%; padding: 10px; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; background: #0f172a; color: #e2e8f0; font-weight: 600; font-size: 0.95rem; cursor: pointer; box-sizing: border-box;">
                        <option value="">All Teams</option>
                        <option value="Key">Key</option>
                        <option value="ROL">ROL</option>
                    </select>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;">
                <div>
                    <div style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-solid fa-building"></i> Company Code</div>
                    <div class="xms" id="sms_cc">
                        <div class="xms-btn" onclick="xmsToggle('sms_cc')"><span class="xms-label" data-all="All Companies">All Companies</span><i class="fa-solid fa-chevron-down" style="font-size:0.65rem;opacity:0.5"></i></div>
                        <div class="xms-panel" id="sms_cc_panel"></div>
                    </div>
                </div>
                <div>
                    <label for="stmtOwner" style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-solid fa-user"></i> Owner</label>
                    <select id="stmtOwner" style="width: 100%; padding: 10px; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; background: #0f172a; color: #e2e8f0; font-weight: 600; font-size: 0.95rem; cursor: pointer; box-sizing: border-box;">
                        <option value="">All Owners</option>
                    </select>
                </div>
                <div>
                    <label for="stmtCategoryFilter" style="color: white; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px; opacity: 0.9;"><i class="fa-solid fa-tags"></i> Category</label>
                    <select id="stmtCategoryFilter" onchange="pageState.stmt=1; updateStatement()" style="width: 100%; padding: 10px; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; background: #0f172a; color: #e2e8f0; font-weight: 600; font-size: 0.95rem; cursor: pointer; box-sizing: border-box;">
                        <option value="">All Categories</option>
                    </select>
                </div>
                <div></div>
                <div style="display: flex; align-items: flex-end;">
                    <button onclick="resetStatementFilters()" style="width: 100%; padding: 10px; border: 2px solid rgba(255,255,255,0.3); border-radius: 8px; background: rgba(255,255,255,0.15); color: white; font-weight: 700; font-size: 0.95rem; cursor: pointer; transition: all 0.3s;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'"><i class="fa-solid fa-arrows-rotate"></i> Reset Filters</button>
                </div>
            </div>
        </div>

        <!-- KPI Cards -->
        <div class="kpi-grid" id="stmt-kpis" style="grid-template-columns: repeat(6, 1fr);"></div>

        <!-- Charts -->
        <div class="chart-grid">
            <div class="chart-container">
                <div class="chart-title"><i class="fa-solid fa-chart-pie"></i> Statements Received  Reconciliation Status</div>
                <div style="height: 300px; position: relative;"><canvas id="stmtStatusChart"></canvas></div>
            </div>
            <div class="chart-container">
                <div class="chart-title"><i class="fa-solid fa-earth-europe"></i> By Country</div>
                <div style="height: 300px; position: relative;"><canvas id="stmtCountryChart"></canvas></div>
            </div>
            <div class="chart-container">
                <div class="chart-title"><i class="fa-solid fa-people-group"></i> By Owner</div>
                <div style="height: 440px; position: relative;"><canvas id="stmtOwnerChart"></canvas></div>
            </div>
            <div class="chart-container">
                <div class="chart-title"><i class="fa-solid fa-scale-balanced"></i> Difference by Country</div>
                <div style="height: 300px; position: relative;"><canvas id="stmtDiffChart"></canvas></div>
            </div>
        </div>

        <!-- Statement Coverage Analysis -->
        <div class="chart-container" id="stmtCoverageSection" style="margin-bottom:24px; display:none;">
            <div class="chart-title"><i class="fa-solid fa-shield-halved"></i> Statement Coverage  Overdue Suppliers</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px; align-items:center;">
                <div style="height:280px; position:relative;"><canvas id="stmtCoverageChart"></canvas></div>
                <div id="stmtCoverageKPIs" style="display:flex; flex-direction:column; gap:12px; padding:20px;"></div>
            </div>
        </div>

        <!-- Statement Table -->
        <div class="table-container" id="stmtTableContainer">
            <div class="table-header">
                <div class="table-title"><i class="fa-solid fa-file-invoice-dollar" style="color: #0D6EFD"></i> Reconciliation Details</div>
                <div style="display:flex;gap:12px;align-items:center;">
                    <select class="page-size-select" id="stmtPageSize" onchange="changeStatementTableSize('stmt',+this.value)">
                        <option value="10">10 rows</option><option value="20">20 rows</option><option value="50">50 rows</option><option value="100">100 rows</option>
                    </select>
                    <button class="toggle-btn" onclick="exportStatementCSV()" title="Export CSV"><i class="fa-solid fa-download"></i> CSV</button>
                </div>
            </div>
            <div style="overflow-x:auto"><table id="stmtTable"></table></div>
            <div id="stmtPagination" class="pagination-bar"></div>
        </div>

        <!-- Overdue Suppliers Without Statement -->
        <div class="table-container" id="stmtNoStmtContainer" style="margin-top:24px; display:none;">
            <div class="table-header">
                <div class="table-title"><i class="fa-solid fa-triangle-exclamation" style="color:#F59E0B"></i> Overdue Suppliers Without Statement</div>
                <div style="display:flex;gap:12px;align-items:center;">
                    <div class="xms" id="xms_nostmt_bucket" style="min-width:140px;">
                        <div class="xms-btn" onclick="xmsToggle('xms_nostmt_bucket')"><span class="xms-label" data-all="All Buckets">All Buckets</span><i class="fa-solid fa-chevron-down" style="font-size:0.65rem;opacity:0.5"></i></div>
                        <div class="xms-panel" id="xms_nostmt_bucket_panel">
                            <label><input type="checkbox" value="0-30" onchange="xmsUpdate('xms_nostmt_bucket')"> 0-30</label>
                            <label><input type="checkbox" value="31-60" onchange="xmsUpdate('xms_nostmt_bucket')"> 31-60</label>
                            <label><input type="checkbox" value="61-90" onchange="xmsUpdate('xms_nostmt_bucket')"> 61-90</label>
                            <label><input type="checkbox" value="91-120" onchange="xmsUpdate('xms_nostmt_bucket')"> 91-120</label>
                            <label><input type="checkbox" value="121-180" onchange="xmsUpdate('xms_nostmt_bucket')"> 121-180</label>
                            <label><input type="checkbox" value="180+" onchange="xmsUpdate('xms_nostmt_bucket')"> 180+</label>
                        </div>
                    </div>
                    <select class="page-size-select" id="stmtNoStmtPageSize" onchange="changeNoStmtTableSize(+this.value)">
                        <option value="10">10 rows</option><option value="20">20 rows</option>
                        <option value="50">50 rows</option><option value="100">100 rows</option>
                    </select>
                    <button class="toggle-btn" onclick="exportNoStmtCSV()" title="Export CSV"><i class="fa-solid fa-download"></i> CSV</button>
                </div>
            </div>
            <div style="overflow-x:auto"><table id="stmtNoStmtTable"></table></div>
            <div id="stmtNoStmtPagination" class="pagination-bar"></div>
        </div>

        <!-- No Data Warning -->
        <div id="stmtNoData" style="display:none; text-align:center; padding:60px 20px;">
            <i class="fa-solid fa-database" style="font-size:48px; color:#ccc; margin-bottom:16px; display:block;"></i>
            <h3 style="color:#666; margin-bottom:8px;">No Statement Data Available</h3>
            <p style="color:#999;">Run <code>statement_loader.py</code> to load reconciliation history data.</p>
        </div>
    </div>

    <!-- Storebook / Z & R PAGE -->
    <div class="page" id="storebookZr">
        <div class="page-header">
            <h1 class="page-title"><i class="fa-solid fa-book-open"></i> Storebook / Z&amp;R</h1>
            <p class="page-subtitle" style="color:var(--text-muted);font-size:0.9rem;">Operational follow-up for Storebook and Z&amp;R normalized rows.</p>
        </div>

        <div class="chart-card" style="padding:12px;margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
                <div style="font-weight:800;font-size:0.95rem;"><i class="fa-solid fa-sliders"></i> Storebook / Z&amp;R Filters</div>
                <div style="display:inline-flex;gap:6px;align-items:center;">
                    <button id="sbzModeStorebook" class="toggle-btn active" type="button" style="padding:6px 12px;border-radius:7px;font-weight:800;">Storebook</button>
                    <button id="sbzModeZr" class="toggle-btn" type="button" style="padding:6px 12px;border-radius:7px;font-weight:800;">Z&amp;R</button>
                    <button id="sbzResetBtn" class="toggle-btn" type="button" style="padding:6px 12px;border-radius:7px;"><i class="fa-solid fa-rotate-left"></i> Reset</button>
                </div>
            </div>

            <div class="sbz-filter-bar">
                <div class="sbz-filter-field">
                    <label for="sbzDateFrom">From</label>
                    <input type="date" id="sbzDateFrom" class="sbz-filter-control">
                </div>
                <div class="sbz-filter-field">
                    <label for="sbzDateTo">To</label>
                    <input type="date" id="sbzDateTo" class="sbz-filter-control">
                </div>
                <div class="sbz-filter-field">
                    <label for="sbzLifecycle">Record View</label>
                    <select id="sbzLifecycle" class="sbz-filter-control">
                        <option value="ALL" selected>All</option>
                        <option value="OPEN">Open</option>
                        <option value="RESOLVED">Resolved</option>
                    </select>
                </div>
                <div class="sbz-filter-field xms xms-wrap" id="xms_sbz_status" data-all="All Statuses">
                    <div class="sbz-filter-label">Status</div>
                    <button type="button" class="xms-btn" onclick="xmsToggle('xms_sbz_status')"><span class="xms-label">All Statuses</span></button>
                    <div class="xms-panel" id="xms_sbz_status_panel"></div>
                </div>
                <div class="sbz-filter-field xms xms-wrap" id="xms_sbz_category" data-all="All Categories">
                    <div class="sbz-filter-label">Category</div>
                    <button type="button" class="xms-btn" onclick="xmsToggle('xms_sbz_category')"><span class="xms-label">All Categories</span></button>
                    <div class="xms-panel" id="xms_sbz_category_panel"></div>
                </div>
                <div class="sbz-filter-field xms xms-wrap" id="xms_sbz_company" data-all="All Companies">
                    <div class="sbz-filter-label">Company / Entity</div>
                    <button type="button" class="xms-btn" onclick="xmsToggle('xms_sbz_company')"><span class="xms-label">All Companies</span></button>
                    <div class="xms-panel" id="xms_sbz_company_panel"></div>
                </div>
                <div class="sbz-filter-field">
                    <label for="sbzSupplierSearch">Supplier Search</label>
                    <input type="text" id="sbzSupplierSearch" class="sbz-filter-control" placeholder="ID or name">
                </div>
            </div>
        </div>

        <div id="sbzAppliedFilters" class="sbz-applied-filters" style="display:none;"></div>
        <div id="sbzKPIs" class="sbz-kpi-grid"></div>

        <div class="sbz-chart-grid">
            <div class="chart-card sbz-chart-card">
                <div class="chart-title"><i class="fa-solid fa-chart-line"></i> Productivity by Action Date</div>
                <div class="sbz-chart-wrap"><canvas id="sbzProductivityChart"></canvas></div>
            </div>
            <div class="chart-card sbz-chart-card">
                <div class="chart-title"><i class="fa-solid fa-building-user"></i> Top 10 Suppliers</div>
                <div class="sbz-chart-wrap"><canvas id="sbzTopSupplierChart"></canvas></div>
            </div>
        </div>

        <div id="sbzDetailCard" class="chart-card" style="padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
                <div class="table-title" style="font-weight:700;"><i class="fa-solid fa-table"></i> Detail <span id="sbzRowCount" style="color:var(--text-muted);font-weight:500;font-size:0.85rem;margin-left:6px;"></span></div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <select class="page-size-select" id="sbzPageSize" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:#0f172a;color:#e2e8f0;">
                        <option value="25">25</option>
                        <option value="50">50</option>
                        <option value="100">100</option>
                    </select>
                    <button class="toggle-btn" onclick="exportStorebookZrCSV()" title="Export CSV" style="padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:var(--text);cursor:pointer;font-weight:600;"><i class="fa-solid fa-download"></i> CSV</button>
                </div>
            </div>
            <div style="overflow-x:auto;"><table id="sbzTable" class="data-table" style="width:100%;border-collapse:collapse;font-size:0.85rem;"></table></div>
            <div id="sbzPagination" class="pagination-bar" style="margin-top:8px;display:flex;gap:8px;justify-content:center;align-items:center;"></div>
        </div>

        <div id="sbzNoData" style="display:none;text-align:center;padding:60px 20px;">
            <i class="fa-solid fa-book-open" style="font-size:48px;color:#ccc;margin-bottom:16px;display:block;"></i>
            <h3 style="color:#666;margin-bottom:8px;">No Storebook / Z&amp;R Data Available</h3>
            <p style="color:#999;">Expected payload: <code>DASHBOARD_DATA.storebook_zr_compressed</code> with normalized rows tagged by <code>source</code>.</p>
        </div>
    </div>

    <!--  ESCALATIONS PAGE  -->
    <div class="page" id="escalation">
        <div class="page-header">
            <h1 class="page-title"><i class="fa-solid fa-triangle-exclamation"></i> Escalations</h1>
            <p class="page-subtitle" style="color:var(--text-muted);font-size:0.9rem;">Email-driven supplier escalations tracked from PA flows + manual logging.</p>
        </div>

        <div class="chart-card" style="padding:12px;margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
                <div style="font-weight:800;font-size:0.95rem;"><i class="fa-solid fa-filter"></i> Escalation Filters</div>
                <button id="escResetBtn" class="toggle-btn" style="padding:6px 12px;border-radius:7px;border:1px solid rgba(148,163,184,0.25);background:rgba(255,255,255,0.06);color:var(--text);cursor:pointer;font-weight:700;"><i class="fa-solid fa-rotate-left"></i> Reset</button>
            </div>

            <div class="esc-filter-bar">
                <div class="esc-filter-field" style="display:flex;gap:7px;align-items:center;min-height:34px;">
                    <input type="checkbox" id="escOnlyOpen" checked style="cursor:pointer;">
                    <label for="escOnlyOpen" style="margin:0;color:var(--text);font-size:0.82rem;text-transform:none;">Only Open</label>
                </div>
                <div class="esc-filter-field">
                    <label for="escDateFrom">Escalation From</label>
                    <input type="date" id="escDateFrom" class="esc-filter-control">
                </div>
                <div class="esc-filter-field">
                    <label for="escDateTo">Escalation To</label>
                    <input type="date" id="escDateTo" class="esc-filter-control">
                </div>
                <div class="esc-filter-field xms xms-wrap" id="xms_esc_status" data-all="All Statuses">
                    <div class="esc-filter-label">Status</div>
                    <button type="button" class="xms-btn" onclick="xmsToggle('xms_esc_status')"><span class="xms-label">All Statuses</span></button>
                    <div class="xms-panel" id="xms_esc_status_panel"></div>
                </div>
                <div class="esc-filter-field xms xms-wrap" id="xms_esc_priority" data-all="All Priorities">
                    <div class="esc-filter-label">Priority</div>
                    <button type="button" class="xms-btn" onclick="xmsToggle('xms_esc_priority')"><span class="xms-label">All Priorities</span></button>
                    <div class="xms-panel" id="xms_esc_priority_panel"></div>
                </div>
                <div class="esc-filter-field xms xms-wrap" id="xms_esc_mailbox" data-all="All Mailboxes">
                    <div class="esc-filter-label">Mailbox</div>
                    <button type="button" class="xms-btn" onclick="xmsToggle('xms_esc_mailbox')"><span class="xms-label">All Mailboxes</span></button>
                    <div class="xms-panel" id="xms_esc_mailbox_panel"></div>
                </div>
                <div class="esc-filter-field xms xms-wrap" id="xms_esc_country" data-all="All Countries">
                    <div class="esc-filter-label">Country</div>
                    <button type="button" class="xms-btn" onclick="xmsToggle('xms_esc_country')"><span class="xms-label">All Countries</span></button>
                    <div class="xms-panel" id="xms_esc_country_panel"></div>
                </div>
                <div class="esc-filter-field xms xms-wrap" id="xms_esc_action" data-all="All Action Types">
                    <div class="esc-filter-label">Action Type</div>
                    <button type="button" class="xms-btn" onclick="xmsToggle('xms_esc_action')"><span class="xms-label">All Action Types</span></button>
                    <div class="xms-panel" id="xms_esc_action_panel"></div>
                </div>
                <div class="esc-filter-field xms xms-wrap" id="xms_esc_category" data-all="All Categories">
                    <div class="esc-filter-label">Category</div>
                    <button type="button" class="xms-btn" onclick="xmsToggle('xms_esc_category')"><span class="xms-label">All Categories</span></button>
                    <div class="xms-panel" id="xms_esc_category_panel"></div>
                </div>
                <div class="esc-filter-field xms xms-wrap" id="xms_esc_entity" data-all="All Entities">
                    <div class="esc-filter-label">Entity</div>
                    <button type="button" class="xms-btn" onclick="xmsToggle('xms_esc_entity')"><span class="xms-label">All Entities</span></button>
                    <div class="xms-panel" id="xms_esc_entity_panel"></div>
                </div>
                <div class="esc-filter-field">
                    <label for="escVendorSearch">Vendor Search</label>
                    <input type="text" id="escVendorSearch" class="esc-filter-control" placeholder="Vendor # or name">
                </div>
            </div>
        </div>

        <div id="escAppliedFilters" class="esc-applied-filters" style="display:none;"></div>

        <div id="escKPIs" class="esc-kpi-grid"></div>

        <div class="esc-chart-grid esc-chart-grid-main">
            <div class="chart-card esc-chart-card">
                <div class="chart-title"><i class="fa-solid fa-chart-bar"></i> Aging  Open (business days)</div>
                <div class="esc-chart-wrap"><canvas id="escalationAgingChart"></canvas></div>
            </div>
            <div class="chart-card esc-chart-card esc-trend-wide">
                <div class="chart-title"><i class="fa-solid fa-chart-line"></i> Weekly Trend (created vs resolved)</div>
                <div class="esc-chart-wrap"><canvas id="escalationTrendChart"></canvas></div>
            </div>
            <div class="chart-card esc-chart-card">
                <div class="chart-title"><i class="fa-solid fa-building-user"></i> Top 10 Recurring Suppliers</div>
                <div class="esc-chart-wrap"><canvas id="escalationTopSupplierChart"></canvas></div>
            </div>
        </div>

        <div class="esc-chart-grid">
            <div class="chart-card esc-chart-card">
                <div class="chart-title"><i class="fa-solid fa-list-ol"></i> Top Action Types</div>
                <div class="esc-chart-wrap"><canvas id="escalationActionTypeChart"></canvas></div>
            </div>
            <div class="chart-card esc-chart-card">
                <div class="chart-title"><i class="fa-solid fa-building"></i> Top Entities</div>
                <div class="esc-chart-wrap"><canvas id="escalationEntityChart"></canvas></div>
            </div>
            <div class="chart-card esc-chart-card">
                <div class="chart-title"><i class="fa-solid fa-envelope"></i> Mailbox Split</div>
                <div class="esc-chart-wrap"><canvas id="escalationMailboxChart"></canvas></div>
            </div>
        </div>

        <div id="escDetailCard" class="chart-card" style="padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
                <div class="table-title" style="font-weight:700;"><i class="fa-solid fa-table"></i> Escalations Detail <span id="escRowCount" style="color:var(--text-muted);font-weight:500;font-size:0.85rem;margin-left:6px;"></span> <span id="escDetailFilterChip" class="esc-detail-filter-chip"></span></div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <select class="page-size-select" id="escPageSize" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:#0f172a;color:#e2e8f0;">
                        <option value="25">25</option>
                        <option value="50">50</option>
                        <option value="100">100</option>
                    </select>
                    <button class="toggle-btn" onclick="exportEscalationCSV()" title="Export CSV" style="padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:var(--text);cursor:pointer;font-weight:600;"><i class="fa-solid fa-download"></i> CSV</button>
                </div>
            </div>
            <div style="overflow-x:auto;"><table id="escTable" class="data-table" style="width:100%;border-collapse:collapse;font-size:0.85rem;"></table></div>
            <div id="escPagination" class="pagination-bar" style="margin-top:8px;display:flex;gap:8px;justify-content:center;align-items:center;"></div>
        </div>

        <div id="escNoData" style="display:none;text-align:center;padding:60px 20px;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size:48px;color:#ccc;margin-bottom:16px;display:block;"></i>
            <h3 style="color:#666;margin-bottom:8px;">No Escalation Data Available</h3>
            <p style="color:#999;">No escalation records were loaded.</p>
        </div>
    </div>
</div>

<script>
//  Compressed data  decompressed at init via native DecompressionStream
//  PART A: Per-week compressed blobs (lazy-load with LRU cache)
const COMPRESSED_WEEKS = {compressed_weeks_json};
const SORTED_WEEKS = {json.dumps(sorted_weeks)};
//  PART B: Pre-computed Year Trend Cube (sparse, full filters)
const YEAR_TREND_CUBE = {year_trend_cube_json};
const SYNTHETIC_REVIEW_COMPRESSED = '{synthetic_review_b64}';
const STATEMENT_COMPRESSED = '{stmt_b64}';

{_JS_STATE_VARS}

Chart.register(ChartDataLabels);

{_load_js()}

</script>
</body>
</html>'''

    # Inject inline libraries (placeholders are safe in f-string; library code has braces)
    _html = _html.replace('__CHART_JS_INLINE__', _chart_js)
    _html = _html.replace('__CHART_DL_INLINE__', _chart_dl)
    _html = _html.replace('__PAKO_JS_INLINE__', _pako_js)
    _html = _html.replace('__FA_CSS_INLINE__', _fa_css)
    return _html

def generate_html_dashboard_helper_mode(data: Dict[str, Any]) -> str:
    """
    Generate a lightweight HTML dashboard that fetches data from the
    Go helper server instead of embedding compressed data blobs.

    Strategy: Generate the full embedded HTML first, then surgically
    replace the data source layer (COMPRESSED_WEEKS, SORTED_WEEKS,
    YEAR_TREND_CUBE, getWeekData, decompressBlob, init sequence)
    while keeping 100% of the business logic intact.
    """
    weeks_data = data['weeks_data']
    countries, company_codes = data['countries'], data['company_codes']
    statuses, query_types, owners = data['statuses'], data['query_types'], data['owners']
    vendor_categories = data.get('vendor_categories', [])
    sorted_weeks = sorted(weeks_data.keys(), reverse=True)
    selector_weeks = sorted(data.get('all_weeks') or weeks_data.keys(), reverse=True)

    # HTML sidebar is generated by generate_html_dashboard()  these vars are used only for reference
    vc_checkboxes = ''.join(f'<label><input type="checkbox" value="{escape_html(vc)}" onchange="toggleVendorCategory(this)"> {escape_html(vc)}</label>' for vc in vendor_categories)
    payment_blocks = data.get('payment_blocks', [])
    pb_checkboxes = ''.join(f'<label><input type="checkbox" value="{escape_html(pb)}" onchange="togglePaymentBlock(this)"> {escape_html(pb)}</label>' for pb in payment_blocks)

    def format_week_display(w):
        parts = w.split('-')
        if len(parts) == 3:
            return f"{parts[2]}-{parts[1]}-{parts[0]}"
        return w

    week_opts = ''.join(f'<option value="{w}">{format_week_display(w)}</option>' for w in selector_weeks)

    #  Compute Year Trend Cube and save to file 
    year_trend_cube = compute_year_trend_cube(weeks_data, sorted_weeks)
    year_trend_cube_json = json.dumps(year_trend_cube, separators=(",", ":"), default=str)

    # Save cube to JSON file for the helper to serve
    OUTPUT_CUBE_LEDGER.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_CUBE_LEDGER.write_text(year_trend_cube_json, encoding='utf-8')
    log.info("  Cube saved: %s (%.1f KB)", OUTPUT_CUBE_LEDGER, len(year_trend_cube_json) / 1024)

    # SyntheticReview compressed blob for helper mode
    synthetic_review_data = data.get('synthetic_review')
    if synthetic_review_data:
        synthetic_review_json = json.dumps(synthetic_review_data, separators=(",", ":"), default=str)
        synthetic_review_bytes = zlib.compress(synthetic_review_json.encode("utf-8"), level=9)
        synthetic_review_b64 = base64.b64encode(synthetic_review_bytes).decode("ascii")
    else:
        synthetic_review_b64 = ''

    # Statement compressed blob for helper mode
    stmt_data = data.get('statement')
    if stmt_data:
        stmt_json = json.dumps(stmt_data, separators=(",", ":"), default=str)
        stmt_bytes = zlib.compress(stmt_json.encode("utf-8"), level=9)
        stmt_b64 = base64.b64encode(stmt_bytes).decode("ascii")
    else:
        stmt_b64 = ''

    #  Build the JavaScript section for helper mode 
    # This replaces COMPRESSED_WEEKS, SORTED_WEEKS, YEAR_TREND_CUBE,
    # decompressBlob, getWeekData, and the init sequence.
    helper_js = f'''
// 
// HELPER SERVER MODE - Data fetched from local Go helper
// 
const HELPER_URL = 'http://127.0.0.1/';
const DATASET = 'ledger';

let SORTED_WEEKS = [];
let YEAR_TREND_CUBE = {{weeks: [], combos: []}};
const SYNTHETIC_REVIEW_COMPRESSED = '{synthetic_review_b64}';
const STATEMENT_COMPRESSED = '{stmt_b64}';

{_JS_STATE_VARS}

Chart.register(ChartDataLabels);

//  LRU CACHE 
const LRU_LIMIT = 4;
const WEEK_CACHE = new Map();

//  FETCH WEEK DATA FROM HELPER 
async function getWeekData(week) {{
    if (!week) return {{ raw: [] }};
    if (WEEK_CACHE.has(week)) {{
        const v = WEEK_CACHE.get(week);
        WEEK_CACHE.delete(week);
        WEEK_CACHE.set(week, v);
        return v;
    }}
    const resp = await fetch(`${{HELPER_URL}}/week?ds=${{encodeURIComponent(DATASET)}}&week=${{encodeURIComponent(week)}}`, {{ cache: 'no-store' }});
    if (!resp.ok) throw new Error(`Failed to load week ${{week}}: ${{resp.status}}`);
    const data = await resp.json();
    WEEK_CACHE.set(week, data);
    while (WEEK_CACHE.size > LRU_LIMIT) {{
        const oldest = WEEK_CACHE.keys().next().value;
        WEEK_CACHE.delete(oldest);
    }}
    return data;
}}

'''

    #  Build the init sequence for helper mode 
    helper_init = '''
//  INIT: HELPER MODE  FETCH FROM SERVER 
(async function() {
    const overlay = document.getElementById('loadingOverlay');
    const barEl = document.getElementById('loadingBar');
    const statusEl = document.getElementById('loadingStatus');

    try {
        // Step 0: Wait for helper server to be ready (retry loop)
        if (statusEl) statusEl.textContent = 'Connecting to helper server...';
        if (barEl) barEl.style.width = '5%';

        let helperOk = false;
        for (let attempt = 0; attempt < 15; attempt++) {
            try {
                const resp = await fetch(`${HELPER_URL}/health`, { cache: 'no-store' });
                if (resp.ok) { helperOk = true; break; }
            } catch(e) { /* retry */ }
            await new Promise(r => setTimeout(r, 500));
        }
        if (!helperOk) {
            throw new Error('Helper server not running. Please use "Open Dashboard.lnk" to launch.');
        }

        // Step 1: Load metadata (weeks, filters)
        if (statusEl) statusEl.textContent = 'Loading metadata...';
        if (barEl) barEl.style.width = '15%';
        const metaResp = await fetch(`${HELPER_URL}/meta?ds=${DATASET}`, { cache: 'no-store' });
        if (!metaResp.ok) throw new Error(`Meta request failed: ${metaResp.status}`);
        const meta = await metaResp.json();
        SORTED_WEEKS = meta.weeks || [];

        if (!SORTED_WEEKS.length) throw new Error('No weeks found in database');

        // Populate week dropdown
        const weekDropdown = document.getElementById('weekSelector');
        weekDropdown.innerHTML = SORTED_WEEKS.map(w => {
            const parts = w.split('-');
            const display = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : w;
            return `<option value="${w}">${display}</option>`;
        }).join('');

        currentWeek = SORTED_WEEKS[0];
        overdueWeek1 = SORTED_WEEKS[0];
        overdueWeek2 = SORTED_WEEKS.length > 1 ? SORTED_WEEKS[1] : SORTED_WEEKS[0];

        // Populate overdue week dropdowns
        const overdueOpts = SORTED_WEEKS.map(w => {
            const parts = w.split('-');
            const display = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : w;
            return `<option value="${w}">${display}</option>`;
        }).join('');
        document.getElementById('overdueWeek1').innerHTML = overdueOpts;
        document.getElementById('overdueWeek2').innerHTML = overdueOpts;
        document.getElementById('overdueWeek2').value = overdueWeek2;

        // Populate country/company/owner multi-select dropdowns from meta
        if (meta.countries && meta.countries.length) {
            const coDD = document.querySelector('#countryWrap .multi-select-dropdown');
            if (coDD) coDD.innerHTML = '<div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllCountry();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearCountry();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>' +
                meta.countries.map(c => `<label><input type="checkbox" value="${c}" onchange="toggleCountry(this)"> ${c}</label>`).join('');
        }
        if (meta.company_codes && meta.company_codes.length) {
            const ccDD = document.querySelector('#companyCodeWrap .multi-select-dropdown');
            if (ccDD) ccDD.innerHTML = '<div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllCompanyCode();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearCompanyCode();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>' +
                meta.company_codes.map(c => `<label><input type="checkbox" value="${c}" onchange="toggleCompanyCode(this)"> ${c}</label>`).join('');
        }
        if (meta.owners && meta.owners.length) {
            const owDD = document.querySelector('#ownerWrap .multi-select-dropdown');
            if (owDD) owDD.innerHTML = '<div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllOwner();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearOwner();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>' +
                meta.owners.map(o => `<label><input type="checkbox" value="${o}" onchange="toggleOwner(this)"> ${o}</label>`).join('');
        }
        // vendorCategoryFilter is now multi-select, populated dynamically in update()
        if (meta.payment_blocks && meta.payment_blocks.length) {
            const dd = document.querySelector('#paymentBlockWrap .multi-select-dropdown');
            if (dd) {
                dd.innerHTML = '<div style="display:flex;gap:0.5rem;padding:0.3rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:0.3rem"><a href="#" onclick="selectAllPaymentBlock();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Select All</a><a href="#" onclick="clearPaymentBlock();return false" style="color:var(--accent);font-size:0.7rem;font-weight:600;text-decoration:none">Clear</a></div>' +
                    meta.payment_blocks.map(pb => `<label><input type="checkbox" value="${pb}" onchange="togglePaymentBlock(this)"> ${pb}</label>`).join('');
            }
        }

        // Step 2: Load year trend cube
        if (statusEl) statusEl.textContent = 'Loading trend data...';
        if (barEl) barEl.style.width = '30%';
        try {
            const cubeResp = await fetch(`${HELPER_URL}/cube?ds=${DATASET}`, { cache: 'no-store' });
            if (cubeResp.ok) {
                YEAR_TREND_CUBE = await cubeResp.json();
            }
        } catch(e) {
            console.warn('Cube not available, trend chart disabled:', e);
        }

        // Step 3: Load current week
        if (statusEl) statusEl.textContent = 'Loading current week...';
        if (barEl) barEl.style.width = '50%';
        await getWeekData(SORTED_WEEKS[0]);

        // Step 4: Load previous week (for deltas)
        if (SORTED_WEEKS.length > 1) {
            if (statusEl) statusEl.textContent = 'Loading previous week...';
            if (barEl) barEl.style.width = '60%';
            await getWeekData(SORTED_WEEKS[1]);
        }

        // Step 5: Render dashboard
        if (statusEl) statusEl.textContent = 'Rendering dashboard...';
        if (barEl) barEl.style.width = '70%';
        await populateStatusAndQueryType();
        await update();

        if (barEl) barEl.style.width = '85%';
        if (statusEl) statusEl.textContent = 'Loading overdue insights...';
        await updateOverdueInsights();

        if (statusEl) statusEl.textContent = 'Loading SyntheticReview data...';
        if (barEl) barEl.style.width = '90%';
        await updateSyntheticReview();

        if (statusEl) statusEl.textContent = 'Loading Statement data...';
        if (barEl) barEl.style.width = '95%';
        await updateStatement();

        // Done
        if (barEl) barEl.style.width = '100%';
        if (statusEl) statusEl.textContent = 'Done!';
        if (overlay) {
            setTimeout(() => {
                overlay.classList.add('hidden');
                setTimeout(() => overlay.remove(), 600);
            }, 200);
        }
    } catch (err) {
        console.error('Dashboard init error:', err);
        if (statusEl) statusEl.textContent = 'Error: ' + err.message;
        if (barEl) barEl.style.background = '#DC3545';
    }
})();
'''

    #  Now generate the full HTML using the existing function 
    # but we'll produce a modified version
    html = generate_html_dashboard(data)

    #  SURGICAL REPLACEMENTS 

    # 1. Replace the embedded data constants + decompressBlob + getWeekData
    #    Find the script block and replace the data section
    old_data_section_start = '//  Compressed data'
    old_data_section_end = 'Chart.register(ChartDataLabels);'

    idx_start = html.find(old_data_section_start)
    idx_end = html.find(old_data_section_end)

    if idx_start == -1 or idx_end == -1:
        # Fallback: look for the COMPRESSED_WEEKS constant directly
        old_data_section_start = 'const COMPRESSED_WEEKS'
        idx_start = html.find(old_data_section_start)
        if idx_start == -1:
            raise ValueError("Cannot find COMPRESSED_WEEKS in generated HTML for replacement")
        # Find backwards to the start of the comment
        script_tag_pos = html.rfind('<script>', 0, idx_start)
        if script_tag_pos != -1:
            idx_start = script_tag_pos + len('<script>') + 1
        idx_end = html.find(old_data_section_end)

    if idx_start != -1 and idx_end != -1:
        # The section to replace spans from the compressed data comment
        # through all variables, decompressBlob, getWeekData, and up to
        # (but not including) showLoading.
        # Our helper_js replaces all of that + includes Chart.register.

        # Find showLoading which marks the end of what we need to replace
        show_loading_marker = 'function showLoading(show)'
        end_of_replacement = html.find(show_loading_marker, idx_start)
        if end_of_replacement != -1:
            html = html[:idx_start] + helper_js + '\n' + html[end_of_replacement:]
        else:
            # Fallback: replace up to and including Chart.register line
            end_after_chart_register = idx_end + len(old_data_section_end)
            # Skip to end of line
            newline_after = html.find('\n', end_after_chart_register)
            if newline_after != -1:
                end_after_chart_register = newline_after + 1
            html = html[:idx_start] + helper_js + '\n' + html[end_after_chart_register:]

    # 3. Replace the init IIFE at the end
    old_init_start = '//  INIT: LAZY-LOAD 1-2 WEEKS + RENDER '
    old_init_end = '</script>'

    init_start_idx = html.find(old_init_start)
    init_end_idx = html.find(old_init_end, init_start_idx) if init_start_idx != -1 else -1

    if init_start_idx != -1 and init_end_idx != -1:
        html = html[:init_start_idx] + helper_init + '\n</script>' + html[init_end_idx + len('</script>'):]

    # 4. Update the version label
    html = html.replace('V13 HYBRID', 'V19 HELPER')

    return html
