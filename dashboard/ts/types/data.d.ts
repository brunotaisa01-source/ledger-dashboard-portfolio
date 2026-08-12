//  CORE DATA TYPES 
// Source of truth: dashboard_data.py column mapping (lines 29-83)

/** Row level in the dashboard data. HEADER = supplier summary, DETAIL = individual document. */
type RowLevel = 'Header' | 'Detail';

/** Team/sheet identifier. Maps to DB source table. */
type SheetTeam = 'ROL' | 'KEY';

/**
 * A single data row from the dashboard (both HEADER and DETAIL).
 * Short keys mapped from dashboard_data.py column aliases.
 */
interface LedgerRow {
    //  Identity 
    s: string;        // Supplier Number
    sn: string;       // Supplier Name
    cc: string;       // Company Code
    co: string;       // Country
    cn?: string;      // Country Name (legacy, same as co)
    cur?: string;     // Currency
    sys?: string;     // ERP system (ERP1, ERP2, ERP3, ERP4, ERP5)

    //  Classification 
    rl: string;       // Row Level ('Header' | 'Detail')
    sh: string;       // Sheet/Team ('ROL' | 'KEY')
    st?: string;      // Status
    qt?: string;      // Query Type
    o?: string;       // Owner
    vc?: string;      // Vendor Category
    pb?: string;      // Payment Block
    dc?: string;      // Doc Category (computed from docCategory())

    //  Values (primarily HEADER) 
    tv?: number;      // Total Value (HEADER-level balance)
    vv?: number;      // Doc Volume (HEADER-level doc count)

    //  Aging Buckets (HEADER and DETAIL) 
    a030?: number;    // 0-30 Days overdue
    a3160?: number;   // 31-60 Days overdue
    a6190?: number;   // 61-90 Days overdue
    a91120?: number;  // 91-120 Days overdue
    a121180?: number; // 121-180 Days overdue
    a180?: number;    // 180+ Days overdue

    //  Document fields (primarily DETAIL) 
    a?: number;       // Amount (DETAIL-level document amount)
    ur?: string;      // Unique Reference
    dn?: string;      // Document Number
    rn?: string;      // Reference Number
    dt?: string;      // Document Type
    dd?: string;      // Document Date
    nd?: string;      // Net Due Date (DD-MM-YYYY)
    nde?: number;     // Net Due Estimated flag (1 = estimated via DD+30d)
    ad?: string;      // Action Date
    cm?: string;      // Comment
    ns?: string;      // Next Step

    //  Trend cube combo field 
    bal?: string;     // Balance Type (DEBIT/CREDIT, used in trend cube combos)

    // Allow dynamic key access (e.g. kpis[cfg.agingKeys[i]])
    [key: string]: string | number | undefined;
}

/** Decompressed week data (from COMPRESSED_WEEKS or chunk files). */
interface WeekData {
    raw: LedgerRow[];
}

/** Aggregated supplier record from aggregateSuppliers(). */
interface AggregatedSupplier {
    Supplier: string;
    SupplierNumber: string;
    SupplierName: string;
    Owner: string;
    Sheet: string;
    CompanyCode: string;
    Country: string;
    Currency: string;
    Status: string;
    QueryType: string;
    Comment: string;
    TotalAmount: number;
    TotalVol: number;
    Aged_0_30: number;
    Aged_31_60: number;
    Aged_61_90: number;
    Aged_91_120: number;
    Aged_121_180: number;
    Aged_180_plus: number;
    docs_0_30?: number;
    docs_31_60?: number;
    docs_61_90?: number;
    docs_91_120?: number;
    docs_121_180?: number;
    docs_180_plus?: number;
    overdueDocs?: number;
    VendorCategory?: string;
    ActionDate?: string;
    NextStep?: string;
    total_overdue?: number;
    Priority?: 'HIGH' | 'MEDIUM' | 'LOW';
    doc_count?: number;
    // Movement comparison (added by updateMovement)
    change_value?: number;
    change_vol?: number;
    // Allow dynamic access to aging fields
    [key: string]: string | number | undefined;
}

/** Single combo in the Year Trend Cube (pre-aggregated by filter dimensions). */
interface TrendCombo {
    co: string;       // Country
    cc: string;       // Company Code
    st: string;       // Status
    qt: string;       // Query Type
    ow: string;       // Owner
    bal: string;      // Balance Type
    vc: string;       // Vendor Category
    pb: string;       // Payment Block
    dc: string;       // Doc Category
    sh: string;       // Sheet/Team
    tv: number[];     // Total Value per week
    sv: number[];     // Supplier count per week
    dv: number[];     // Doc volume per week
}

/** Year Trend Cube  pre-aggregated weekly data for fast trend rendering. */
interface TrendCube {
    weeks: string[];
    combos: TrendCombo[];
}

/** Dashboard data object injected by dashboard_data.js. */
interface DashboardData {
    sorted_weeks: string[];
    chunk_weeks: string[];
    countries: string[];
    company_codes: string[];
    statuses: string[];
    query_types: string[];
    owners: string[];
    vendor_categories: string[];
    payment_blocks: string[];
    doc_categories: string[];
    escalation_compressed?: string;
    storebook_zr_compressed?: string;
    productivity_trend_compressed?: string;
    productivity_scorecard_compressed?: string;
    resolved_carryover_compressed?: string;
    [weekKey: string]: string | string[] | undefined;
}

/** Movement row (supplier-level comparison between two weeks). */
interface MovementSupplier {
    Supplier: string;
    SupplierName: string;
    Owner: string;
    Sheet: string;
    CompanyCode: string;
    Country?: string;
    Currency?: string;
    Comment?: string;
    prevBal: number;
    currBal: number;
    prevVal: number;
    currVal: number;
    change: number;
    prevVol: number;
    currVol: number;
    status: string;
}

/** Movement row (TX mode  document-level). */
interface MovementDoc {
    Supplier: string;
    SupplierName: string;
    CompanyCode: string;
    Reference: string;
    DocNumber: string;
    DocType: string;
    Amount: number;
    Owner: string;
    Sheet: string;
    Comment: string;
    status: string;
}

/** ERP system document-type classification map. */
interface DocTypeMap {
    payment: Set<string>;
    invoice: Set<string>;
    credit_note: Set<string>;
}

/** Escalation row from the Local Fixture Store Escalations_Email_log workbook (Wave 1 mockup shape). */
interface EscalationRow {
    uniqueKey: string;
    category?: string | null;
    mailbox?: string | null;
    country?: string | null;
    fromEmail?: string | null;
    vendorNo?: string | null;
    vendorName?: string | null;
    entity?: string | null;
    entityCode?: string | null;
    reference?: string | null;
    docDate?: string | null;
    invRef?: string | null;
    value?: number | null;
    valueRaw?: string | null;
    actionType?: string | null;
    status?: string | null;
    isOpen: 0 | 1;
    priority?: string | null;
    apOwner?: string | null;
    receivedDate?: string | null;
    escalationDate?: string | null;
    workingNotes?: string | null;
    dateResolved?: string | null;
    daysToResolve?: number | null;
    daysOpen?: number | null;
    internetMsgId?: string | null;
    flags: string[];
    [key: string]: string | number | string[] | null | undefined;
}

/** Storebook / Z & R normalized row emitted by the dashboard data publisher. */
interface StorebookZrRow {
    source: 'STOREBOOK' | 'ZR';
    snapshot_date?: string | null;
    source_key?: string | null;
    owner?: string | null;
    supplier_id?: string | null;
    supplier_name?: string | null;
    company_or_entity?: string | null;
    category?: string | null;
    value?: number | null;
    opened_date?: string | null;
    action_date?: string | null;
    action_date_source?: string | null;
    resolved_date?: string | null;
    resolution_source?: string | null;
    status?: string | null;
    comments?: string | null;
    days_open?: number | null;
    days_resolve?: number | null;
    [key: string]: string | number | null | undefined;
}
