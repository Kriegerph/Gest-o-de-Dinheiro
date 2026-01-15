export type TransactionType = 'income' | 'expense' | 'transfer';

export interface Transaction {
  id?: string;
  type: TransactionType;
  description: string;
  amount: number;
  date: string;
  categoryId?: string | null;
  accountId?: string | null;
  accountOriginId?: string | null;
  accountDestinationId?: string | null;
  notes?: string;
  investmentId?: string | null;
  investmentAction?: 'deposit' | 'withdraw' | null;
  source?: string | null;
  createdAt?: any;
}
