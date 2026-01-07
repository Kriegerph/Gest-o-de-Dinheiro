export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id?: string;
  type: TransactionType;
  description: string;
  amount: number;
  date: string;
  categoryId?: string | null;
  notes?: string;
  createdAt?: any;
}
