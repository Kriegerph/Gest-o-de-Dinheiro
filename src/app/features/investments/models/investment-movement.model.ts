export type InvestmentMovementType = 'deposit' | 'withdraw';
export type InvestmentMovementSource = 'investment_only' | 'ledger';

export interface InvestmentMovement {
  id?: string;
  userId: string;
  investmentId: string;
  type: InvestmentMovementType;
  amount: number;
  date: string;
  accountId?: string | null;
  accountNameSnapshot?: string | null;
  note?: string | null;
  relatedTransactionId?: string | null;
  isHistorical?: boolean;
  affectsAccounts?: boolean;
  source?: InvestmentMovementSource;
  grossAmount?: number | null;
  netAmount?: number | null;
  irEstimated?: number | null;
  irRate?: number | null;
  createdAt?: any;
  updatedAt?: any;
}
