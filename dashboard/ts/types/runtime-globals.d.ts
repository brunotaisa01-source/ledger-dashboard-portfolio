/** Ambient contracts for functions and state supplied by the preceding dashboard scripts. */

type ViewMode = string;

interface ChartDataset {
    data?: unknown[];
    [key: string]: unknown;
}

interface ChartInstance {
    destroy(): void;
    resize?(): void;
}

declare const Chart: new (
    target: HTMLCanvasElement | CanvasRenderingContext2D,
    configuration: unknown,
) => ChartInstance;

declare function decompressBlob(encoded: string): Promise<unknown>;
declare function xmsGetValues(id: string): string[];
declare function xmsPopulate(id: string, values: string[]): void;

declare function update(): Promise<void>;
declare function updateOverdueInsights(): Promise<void> | void;
declare function updateSyntheticReview(): Promise<void> | void;
declare function updateStatement(): Promise<void> | void;
declare function updateEscalation(): Promise<void> | void;
declare function updateMovement(): Promise<void> | void;
declare function populateStatusAndQueryType(): Promise<void>;
declare function setKeyBalanceType(value: string): void;
declare function resetSyntheticReviewFilters(): void;
declare function applyChartDefaults(): void;

declare let currentWeek: string;
declare let movWeek1: string;
declare let movWeek2: string;
declare let viewModeFilter: ViewMode;
declare let supplierSearchFilter: string;
declare let prodTeamFilter: string;
declare let workedCategoryFilter: string;
declare let prodDateFrom: string;
declare let prodDateTo: string;
declare let overdueWeek1: string;
declare let overdueWeek2: string;
declare let overdueCountrySlice: string;
declare let overviewTeamFilter: string;
declare let topSupplierBalanceType: string;
declare let rolBalanceTypeFilter: string;
declare let keyBalanceTypeFilter: string;

declare const SORTED_WEEKS: string[];
declare const pageState: Record<string, number>;
declare const tableLimits: Record<string, number>;
declare const charts: Record<string, ChartInstance>;
