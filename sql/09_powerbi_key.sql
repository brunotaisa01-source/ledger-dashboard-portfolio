-- ============================================================
-- POWER BI KEY DATA - SQL OPTIMIZADO
-- ============================================================
-- Substitui SELECT * FROM key_detail + 4 passos M Query:
--    Unified  "0-30 Days overdue"  (elimina 2 passos M)
--    Filtro Owner != 'Fuel'          (menos rows transferidas)
--    SupplierKey calculado            (elimina 1 passo M)
--    Colunas Unnamed removidas        (SELECT explicito)
--
-- Usar no Power BI Python.Execute:
--   db_path = "data/sample/key_weekly.sqlite"
--   query = <conteudo deste ficheiro>
-- ============================================================

SELECT
    Country,
    "Vendor category",
    "Company Code",
    CAST(Supplier AS INTEGER)               AS Supplier,
    "Name 1",
    "Document Date",
    "Document Number",
    Reference,
    "Amount in doc. curr.",
    "Document Type",
    "Net due date",
    "Document currency",
    "Posting Date",
    "Payment Block",

    -- Aging: Unified  "0-30 Days overdue" (BI espera este nome)
    COALESCE("07-30 Days overdue (Unified)",
             "07-30 Days overdue",
             "0-30 Days overdue", 0)        AS "0-30 Days overdue",
    "31-60 Days overdue",
    "61-90 Days overdue",
    "91-120 Days Overdue",
    "121-180 Days Overdue",
    "180> Days Overdue",

    "TOTAL VALUE",
    "TOTAL VOL",

    "Query type",
    Status,
    "AP Specialist comment",
    "Next Step",
    "Action Date",
    "TL Comment",
    "Open Payment",

    Sheet,
    Owner,
    Text,
    "Unique Ref",
    System,
    "User name",

    SourceFile,
    SourceTab,
    SnapshotDateISO,
    WeekStartISO,
    ISOYear,
    ISOWeek,
    RowLevel,
    DocClass,

    -- SupplierKey (antes calculado pelo M Query)
    "Company Code" || ' ' || CAST(CAST(Supplier AS INTEGER) AS TEXT)
        AS SupplierKey

FROM key_lines
WHERE RowLevel = 'Detail'
  AND COALESCE(Owner, '') != 'Fuel'
