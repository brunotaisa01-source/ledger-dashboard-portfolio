//  NAVIGATION 
/** Navigation: switches active tab and page, triggers SyntheticReview/Statement re-render on tab show. */
document.querySelectorAll('.nav-item').forEach((item: Element) => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach((n: Element) => n.classList.remove('active'));
        item.classList.add('active');
        document.querySelectorAll('.page').forEach((p: Element) => p.classList.remove('active'));
        const page = (item as HTMLElement).dataset.page;
        if (page) document.getElementById(page)!.classList.add('active');
        // Sync URL hash for bookmarking  ONLY under http(s). Chrome treats every
        // file:// URL as a unique opaque origin, so even a same-page replaceState
        // emits "Unsafe attempt to load URL ... from frame with URL ..." warnings.
        if (page && (location.protocol === 'http:' || location.protocol === 'https:')) {
            history.replaceState(null, '', '#' + page);
        }
        window.scrollTo(0, 0);
        // Re-render SyntheticReview/Statement when tab becomes visible; otherwise render active page
        if ((item as HTMLElement).dataset.page === 'overdue') {
            setTimeout(() => updateOverdueInsights(), 0);
        } else if ((item as HTMLElement).dataset.page === 'synthetic_review') {
            setTimeout(() => updateSyntheticReview(), 0);
        } else if ((item as HTMLElement).dataset.page === 'statement') {
            setTimeout(() => updateStatement(), 0);
        } else if ((item as HTMLElement).dataset.page === 'storebookZr') {
            setTimeout(() => updateStorebookZr(), 0);
        } else if ((item as HTMLElement).dataset.page === 'escalation') {
            setTimeout(() => updateEscalation(), 0);
        } else {
            // Render the newly active page with current filters  yield to paint first
            setTimeout(() => update(), 0);
        }
    });
});

//  FILTER LISTENERS (async) 
document.getElementById('weekSelector')!.addEventListener('change', async (e: Event) => {
    currentWeek = (e.target as HTMLSelectElement).value;
    // Sync Movement weeks: Week1 = current, Week2 = previous
    movWeek1 = currentWeek;
    const idx = SORTED_WEEKS.indexOf(currentWeek);
    movWeek2 = idx >= 0 && idx < SORTED_WEEKS.length - 1 ? SORTED_WEEKS[idx + 1] : currentWeek;
    (document.getElementById('movWeek1') as HTMLSelectElement).value = movWeek1;
    (document.getElementById('movWeek2') as HTMLSelectElement).value = movWeek2;
    await populateStatusAndQueryType();
    await update();
});
document.getElementById('viewModeFilter')!.addEventListener('change', async (e: Event) => { viewModeFilter = (e.target as HTMLSelectElement).value as ViewMode; await update(); });
// countryFilter, companyFilter, statusFilter, queryTypeFilter, ownerFilter, balanceTypeFilter
// are now multi-select Sets  handled by toggle*/clear*/selectAll* in 05_pagination.ts
let _searchTimer: ReturnType<typeof setTimeout> | null = null;
document.getElementById('supplierSearch')!.addEventListener('input', (e: Event) => {
    supplierSearchFilter = (e.target as HTMLInputElement).value.toLowerCase();
    if (_searchTimer) clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => update(), 300);
});
document.getElementById('rolPriorityFilter')!.addEventListener('change', async (_e: Event) => { await update(); });
document.getElementById('keyPriorityFilter')!.addEventListener('change', async (_e: Event) => { await update(); });
document.getElementById('prodTeamFilter')!.addEventListener('change', async (e: Event) => { prodTeamFilter = (e.target as HTMLSelectElement).value; await update(); });
document.getElementById('workedCategoryFilter')!.addEventListener('change', async (e: Event) => { workedCategoryFilter = (e.target as HTMLSelectElement).value; await update(); });
document.getElementById('prodDateFrom')!.addEventListener('change', async (e: Event) => { prodDateFrom = (e.target as HTMLInputElement).value; await update(); });
document.getElementById('prodDateTo')!.addEventListener('change', async (e: Event) => { prodDateTo = (e.target as HTMLInputElement).value; await update(); });
document.getElementById('overdueWeek1')!.addEventListener('change', async (e: Event) => { overdueWeek1 = (e.target as HTMLSelectElement).value; await updateOverdueInsights(); });
document.getElementById('overdueWeek2')!.addEventListener('change', async (e: Event) => { overdueWeek2 = (e.target as HTMLSelectElement).value; await updateOverdueInsights(); });
// overdueTeamFilter is now a multi-select (handled via toggleOverdueTeam/clearOverdueTeam)
document.getElementById('overdueCountrySliceFilter')!.addEventListener('change', async (e: Event) => { overdueCountrySlice = (e.target as HTMLSelectElement).value; await updateOverdueInsights(); });

document.getElementById('movWeek1')!.addEventListener('change', async (e: Event) => { movWeek1 = (e.target as HTMLSelectElement).value; await updateMovement(); });
document.getElementById('movWeek2')!.addEventListener('change', async (e: Event) => { movWeek2 = (e.target as HTMLSelectElement).value; await updateMovement(); });

document.getElementById('overviewTeamFilter')!.addEventListener('change', async (e: Event) => { overviewTeamFilter = (e.target as HTMLSelectElement).value; await update(); });

// V15.1: Event listeners for aging bucket filters
document.getElementById('topSupplierBalanceType')!.addEventListener('change', async (e: Event) => { topSupplierBalanceType = (e.target as HTMLSelectElement).value; await update(); });
document.getElementById('rolBalanceTypeFilter')!.addEventListener('change', async (e: Event) => { rolBalanceTypeFilter = (e.target as HTMLSelectElement).value; await update(); });
document.getElementById('keyBalanceTypeDropdown')!.addEventListener('change', async (e: Event) => { keyBalanceTypeFilter = (e.target as HTMLSelectElement).value; setKeyBalanceType((e.target as HTMLSelectElement).value); });

// SyntheticReview date filters (multi-select dropdowns handle their own events via xmsUpdate)
['synthetic_reviewDateFrom','synthetic_reviewDateTo'].forEach((id: string) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
        pageState.synthetic_review = 1;
        pageState.synthetic_reviewDupes = 1;
        pageState.synthetic_reviewErrors = 1;
        updateSyntheticReview();
    });
});

// Statement filters (sms_ multi-selects handle their own events via xmsUpdate with sms_ prefix detection)
['stmtDateFrom','stmtDateTo','stmtCountry','stmtRecStatus','stmtTeam','stmtOwner'].forEach((id: string) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { pageState.stmt = 1; updateStatement(); });
});

/**
 * Default values for all filter state variables.
 * Used by the Reset Filters handler to restore initial state in a single loop.
 * "set" type creates a new empty Set; "string" type assigns the default string value.
 */
const FILTER_DEFAULTS: Array<{ global: string; type: 'string' | 'set'; default?: string }> = [
    { global: 'countryFilter',          type: 'set' },
    { global: 'companyFilter',          type: 'set' },
    { global: 'statusFilter',           type: 'set' },
    { global: 'queryTypeFilter',        type: 'set' },
    { global: 'docCategoryFilter',      type: 'set' },
    { global: 'ownerFilter',            type: 'set' },
    { global: 'vendorCategoryFilter',   type: 'set' },
    { global: 'paymentBlockFilter',     type: 'set' },
    { global: 'balanceTypeFilter',      type: 'set' },
    { global: 'viewModeFilter',         type: 'string', default: 'VALUE' },
    { global: 'prodTeamFilter',         type: 'string', default: '' },
    { global: 'workedCategoryFilter',   type: 'string', default: '' },
    { global: 'prodDateFrom',           type: 'string', default: '' },
    { global: 'prodDateTo',             type: 'string', default: '' },
    { global: 'supplierSearchFilter',   type: 'string', default: '' },
    { global: 'movementTeamFilter',     type: 'string', default: '' },
    { global: 'movementStatusFilter',   type: 'string', default: '' },
    { global: 'globalBucketFilter',     type: 'set' },
    { global: 'overdueTeamFilter',      type: 'set' },
    { global: 'overdueAgingFilter',     type: 'set' },
    { global: 'overdueCountrySlice',    type: 'string', default: '' },
    { global: 'overdueCompanyFilter',   type: 'set' },
    { global: 'topSupplierBalanceType', type: 'string', default: 'ALL' },
    { global: 'rolBalanceTypeFilter',   type: 'string', default: 'ALL' },
    { global: 'overviewTeamFilter',     type: 'string', default: '' },
    { global: 'overviewTableTeamFilter',type: 'string', default: '' },
    { global: 'keyBalanceTypeFilter',   type: 'string', default: 'ALL' }
];

// REFRESH FILTERS BUTTON  Single click = Full Reset ALL filters
document.getElementById('refreshFiltersBtn')!.addEventListener('click', async () => {
    // Yield to main thread immediately so browser can paint button feedback (INP fix)
    const btn = document.getElementById('refreshFiltersBtn')!;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Resetting...';
    await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    // Reset all filter variables via FILTER_DEFAULTS config
    for (const f of FILTER_DEFAULTS) {
        (window as any)[f.global] = f.type === 'set' ? new Set() : f.default;
    }
    tableLimits.overview = 10;
    tableLimits.key = 10;
    tableLimits.movement = 10;
    tableLimits.rol = 10;
    tableLimits.prod = 9999;
    if (tableLimits.workedSuppliers) tableLimits.workedSuppliers = 10;

    // Reset all select/input elements
    (document.getElementById('supplierSearch') as HTMLInputElement).value = '';
    document.getElementById('movTeamAll')!.classList.add('active');
    document.getElementById('movTeamKey')!.classList.remove('active');
    document.getElementById('movTeamROL')!.classList.remove('active');
    (document.getElementById('overviewTeamFilter') as HTMLSelectElement).value = '';
    document.getElementById('ovTableTeamAll')!.classList.add('active');
    document.getElementById('ovTableTeamKey')!.classList.remove('active');
    document.getElementById('ovTableTeamROL')!.classList.remove('active');
    document.getElementById('keyBtAll')!.classList.add('active');
    document.getElementById('keyBtDebit')!.classList.remove('active');
    document.getElementById('keyBtCredit')!.classList.remove('active');
    (document.getElementById('keyBalanceTypeDropdown') as HTMLSelectElement).value = 'ALL';
    (document.getElementById('keyPriorityFilter') as HTMLSelectElement).value = '';
    document.querySelectorAll('#movStatusFilter .toggle-btn').forEach((b: Element, i: number) => b.classList.toggle('active', i === 0));
    document.querySelectorAll('#countryWrap input[type="checkbox"]').forEach((cb: Element) => (cb as HTMLInputElement).checked = false);
    const coDisp = document.querySelector('#countryWrap .multi-select-display');
    if (coDisp) coDisp.textContent = 'All Countries';
    document.getElementById('countryWrap')!.classList.remove('open');
    document.querySelectorAll('#companyCodeWrap input[type="checkbox"]').forEach((cb: Element) => (cb as HTMLInputElement).checked = false);
    const ccDisp = document.querySelector('#companyCodeWrap .multi-select-display');
    if (ccDisp) ccDisp.textContent = 'All Companies';
    document.getElementById('companyCodeWrap')!.classList.remove('open');
    document.querySelectorAll('#statusWrap input[type="checkbox"]').forEach((cb: Element) => (cb as HTMLInputElement).checked = false);
    const stDisp = document.querySelector('#statusWrap .multi-select-display');
    if (stDisp) stDisp.textContent = 'All Statuses';
    document.getElementById('statusWrap')!.classList.remove('open');
    document.querySelectorAll('#queryTypeWrap input[type="checkbox"]').forEach((cb: Element) => (cb as HTMLInputElement).checked = false);
    const qtDisp = document.querySelector('#queryTypeWrap .multi-select-display');
    if (qtDisp) qtDisp.textContent = 'All Query Types';
    document.getElementById('queryTypeWrap')!.classList.remove('open');
    document.querySelectorAll('#docCategoryWrap input[type="checkbox"]').forEach((cb: Element) => (cb as HTMLInputElement).checked = false);
    document.querySelector('#docCategoryWrap .multi-select-display')!.textContent = 'All';
    document.getElementById('docCategoryWrap')!.classList.remove('open');
    document.querySelectorAll('#ownerWrap input[type="checkbox"]').forEach((cb: Element) => (cb as HTMLInputElement).checked = false);
    const owDisp = document.querySelector('#ownerWrap .multi-select-display');
    if (owDisp) owDisp.textContent = 'All Owners';
    document.getElementById('ownerWrap')!.classList.remove('open');
    document.querySelectorAll('#vendorCategoryWrap input[type="checkbox"]').forEach((cb: Element) => (cb as HTMLInputElement).checked = false);
    const vcDisp = document.querySelector('#vendorCategoryWrap .multi-select-display');
    if (vcDisp) vcDisp.textContent = 'All Categories';
    const vcWrap = document.getElementById('vendorCategoryWrap');
    if (vcWrap) vcWrap.classList.remove('open');
    document.querySelectorAll('#paymentBlockWrap input[type="checkbox"]').forEach((cb: Element) => (cb as HTMLInputElement).checked = false);
    document.querySelector('#paymentBlockWrap .multi-select-display')!.textContent = 'All';
    document.getElementById('paymentBlockWrap')!.classList.remove('open');
    document.querySelectorAll('#balanceTypeWrap input[type="checkbox"]').forEach((cb: Element) => (cb as HTMLInputElement).checked = false);
    const btDisp = document.querySelector('#balanceTypeWrap .multi-select-display');
    if (btDisp) btDisp.textContent = 'All';
    document.getElementById('balanceTypeWrap')!.classList.remove('open');
    (document.getElementById('viewModeFilter') as HTMLSelectElement).value = 'VALUE';
    (document.getElementById('prodTeamFilter') as HTMLSelectElement).value = '';
    (document.getElementById('workedCategoryFilter') as HTMLSelectElement).value = '';
    (document.getElementById('prodDateFrom') as HTMLInputElement).value = '';
    (document.getElementById('prodDateTo') as HTMLInputElement).value = '';
    document.querySelectorAll('#overdueTeamWrap input[type="checkbox"]').forEach((cb: Element) => (cb as HTMLInputElement).checked = false);
    document.querySelector('#overdueTeamWrap .multi-select-display')!.textContent = 'All Teams';
    document.getElementById('overdueTeamWrap')!.classList.remove('open');
    document.querySelectorAll('#overdueAgingWrap input[type="checkbox"]').forEach((cb: Element) => (cb as HTMLInputElement).checked = false);
    document.querySelector('#overdueAgingWrap .multi-select-display')!.textContent = 'All Buckets';
    document.getElementById('overdueAgingWrap')!.classList.remove('open');
    (document.getElementById('overdueCountrySliceFilter') as HTMLSelectElement).value = '';
    document.querySelectorAll('#overdueCompanyWrap input[type="checkbox"]').forEach((cb: Element) => (cb as HTMLInputElement).checked = false);
    document.querySelector('#overdueCompanyWrap .multi-select-display')!.textContent = 'All Companies';
    document.getElementById('overdueCompanyWrap')!.classList.remove('open');
    document.querySelectorAll('#globalBucketWrap input[type="checkbox"]').forEach((cb: Element) => (cb as HTMLInputElement).checked = false);
    document.querySelector('#globalBucketWrap .multi-select-display')!.textContent = 'All Buckets';
    document.getElementById('globalBucketWrap')!.classList.remove('open');
    (document.getElementById('topSupplierBalanceType') as HTMLSelectElement).value = 'ALL';
    (document.getElementById('overviewPageSize') as HTMLSelectElement).value = '10';
    (document.getElementById('movementPageSize') as HTMLSelectElement).value = '10';
    (document.getElementById('rolPageSize') as HTMLSelectElement).value = '10';
    const workedEl = document.getElementById('workedSuppliersPageSize') as HTMLSelectElement | null;
    if (workedEl) workedEl.value = '10';
    (document.getElementById('rolBalanceTypeFilter') as HTMLSelectElement).value = 'ALL';

    const rolPrio = document.getElementById('rolPriorityFilter') as HTMLSelectElement | null;
    if (rolPrio) rolPrio.value = '';
    const prio = document.getElementById('priorityFilter') as HTMLSelectElement | null;
    if (prio) prio.value = '';

    await update();
    await updateOverdueInsights();
    resetSyntheticReviewFilters();

    btn.innerHTML = '<i class="fa-solid fa-trash-can"></i> All Reset!';
    (btn as HTMLElement).style.background = 'linear-gradient(135deg, var(--red), var(--orange))';
    setTimeout(() => {
        btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh Filters';
        (btn as HTMLElement).style.background = 'linear-gradient(135deg, var(--accent), var(--primary))';
    }, 1500);
});

//  AUTO-RESIZE: Adapta apenas quando realmente redimensionar 
//  THEME TOGGLE 
/**
 * Toggles between light and dark theme via data-theme attribute on <html>.
 * Persists preference to localStorage and re-renders charts with theme-aware colors.
 */
function toggleTheme(): void {
    const html = document.documentElement;
    const btn = document.getElementById('themeToggleBtn');
    const isDark = html.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';

    html.setAttribute('data-theme', newTheme);
    try { localStorage.setItem('rol_dashboard_theme', newTheme); } catch(_e) {}

    if (btn) {
        if (newTheme === 'dark') {
            btn.textContent = '';
            btn.style.background = 'rgba(30,41,59,0.85)';
            btn.style.borderColor = 'rgba(255,255,255,0.1)';
        } else {
            btn.textContent = '';
            btn.style.background = 'rgba(255,255,255,0.9)';
            btn.style.borderColor = 'rgba(128,128,128,0.3)';
        }
    }

    // Update Chart.js defaults and re-render all charts with new theme colors
    applyChartDefaults();
    setTimeout(() => { if (typeof update === 'function') update(); }, 50);
}

// Apply saved theme preference on load
(function initTheme(): void {
    let saved: string | null = null;
    try { saved = localStorage.getItem('rol_dashboard_theme'); } catch(_e) {}

    const html = document.documentElement;
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;

    // Normalize old values: 'modern'  'dark', 'classic'  'light'
    if (saved === 'modern') saved = 'dark';
    if (saved === 'classic') saved = 'light';

    // Default to 'light' if no preference
    const theme = saved || 'light';
    html.setAttribute('data-theme', theme);

    if (theme === 'dark') {
        btn.textContent = '';
        btn.style.background = 'rgba(30,41,59,0.85)';
        btn.style.borderColor = 'rgba(255,255,255,0.1)';
    } else {
        btn.textContent = '';
        btn.style.background = 'rgba(255,255,255,0.9)';
        btn.style.borderColor = 'rgba(128,128,128,0.3)';
    }
})();

let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
let lastWidth: number = window.innerWidth;
let lastHeight: number = window.innerHeight;

/**
 * Debounced window resize handler. Only triggers chart resize when
 * dimensions change by more than 50px to avoid unnecessary re-renders.
 */
function handleResize(): void {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight;

        if (Math.abs(newWidth - lastWidth) > 50 || Math.abs(newHeight - lastHeight) > 50) {
            lastWidth = newWidth;
            lastHeight = newHeight;

            // Resize all active charts (try-catch: canvas may be detached on hidden pages)
            Object.values(charts).forEach((c: ChartInstance) => {
                try { if (c && typeof c.resize === 'function') c.resize(); } catch(_) {}
            });
        }
    }, 250);
}

// Listeners apenas para mudancas reais
window.addEventListener('resize', handleResize);

// Close multi-select dropdowns on click outside
document.addEventListener('click', (e: MouseEvent) => {
    document.querySelectorAll('.multi-select-wrap.open').forEach((w: Element) => {
        if (!w.contains(e.target as Node)) w.classList.remove('open');
    });
});

//  HEALTH CHECK BADGE 
/**
 * Fetches status.json and displays a health badge in the sidebar footer.
 * Non-blocking  silently ignores fetch failures.
 */
function _loadHealthBadge(): void {
    if (location.protocol === 'file:') return;
    fetch('status.json')
        .then((r: Response) => r.ok ? r.json() : null)
        .then((data: Record<string, unknown> | null) => {
            if (!data) return;
            const footer = document.querySelector('.sidebar-footer');
            if (!footer) return;

            const isOk = data.overall === 'ok';
            const color = isOk ? '#28a745' : '#ffc107';
            const icon = isOk ? '\u2714' : '\u26a0';
            const label = isOk ? 'Data OK' : 'Data Stale';

            // Build tooltip with details
            const details = Object.entries(data.checks as Record<string, Record<string, unknown>> || {})
                .map(([k, v]: [string, Record<string, unknown>]) => {
                    const s = v.ok ? 'OK' : 'STALE';
                    const age = v.age_hours != null ? v.age_hours + 'h' : 'N/A';
                    return k.replace('_', ' ') + ': ' + s + ' (' + age + ')';
                })
                .join('\n');

            const badge = document.createElement('span');
            badge.style.cssText = 'margin-left:8px;padding:2px 6px;border-radius:4px;font-size:11px;cursor:help;color:#fff;background:' + color;
            badge.textContent = icon + ' ' + label;
            badge.title = 'Health Check: ' + data.checked_at + '\n' + details;
            footer.appendChild(badge);
        })
        .catch(() => { /* silently ignore  status.json may not exist */ });
}
