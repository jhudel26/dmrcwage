export interface Tranche {
  order: number;
  amount: number;
  effectiveDate: string;
  coverage: string;
  status: 'current' | 'upcoming';
}

export interface SectorRate {
  type: 'Non-Agriculture' | 'Agriculture';
  amount: number | null;
  coverage: string;
  tranches: Tranche[];
}

export interface WageSchedule {
  id?: number;
  wageOrder: string;
  dateEffective: string;
  pdfUrl?: string | null;
  rates: SectorRate[];
}

export interface Region {
  id: string;
  name: string;
  notes: string;
  wageOrder: string;
  dateEffective: string;
  pdfUrl?: string | null;
  rates: SectorRate[];
  wageSchedules: WageSchedule[];
}

export interface WageMetrics {
  totalRegions: number;
  highestWage: number;
  averageWage: number;
  updatedThisYear: number;
}

export interface WageDataResponse {
  lastUpdated: string;
  metrics: WageMetrics;
  regions: Region[];
}

export interface RateMovement {
  regionId: string;
  regionName: string;
  sector: string;
  coverage: string;
  previousAmount: number | null;
  previousWageOrder: string;
  previousEffectiveDate: string;
  currentAmount: number;
  currentWageOrder: string;
  currentEffectiveDate: string;
  change: number | null;
  changePercent: number | null;
  status: string;
}

export interface MovementSummary {
  totalIncreases: number;
  avgIncrease: number;
  regionsChanged: number;
  lastMovementDays: number;
}

export interface RateMovementsResponse {
  summary: MovementSummary;
  movements: RateMovement[];
}
