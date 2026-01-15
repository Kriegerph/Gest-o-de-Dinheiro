export type InvestmentType = 'fixed_income' | 'savings' | 'cdb' | 'treasury_selic' | 'manual';
export type InvestmentStatus = 'active' | 'inactive';
export type InvestmentYieldMode = 'manual_monthly' | 'manual_yearly' | 'cdi_percent' | 'selic';
export type InvestmentCompounding = 'daily' | 'monthly';

export interface Investment {
  id?: string;
  userId?: string;
  name: string;
  type: InvestmentType;
  status: InvestmentStatus;
  realStartDate: string;
  systemStartDate: string;
  hadBeforeApp: boolean;
  principalBase: number;
  preAppYield: number;
  totalInvestedToDate?: number | null;
  currentValueAtOnboarding?: number | null;
  yieldMode: InvestmentYieldMode;
  manualRate?: number | null;
  cdiPercent?: number | null;
  compounding?: InvestmentCompounding | null;
  createdAt?: any;
  updatedAt?: any;
  lastCalculatedAt?: string | null;
  lastCalculatedValue?: number | null;
}
