import { Transaction } from './transaction.model';

export interface CategoryReportItem {
  categoryId: string;
  categoryName: string;
  total: number;
}

export interface FinancialSummary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
}

export interface ReportResult {
  summary: FinancialSummary;
  byCategory: CategoryReportItem[];
  transactions: Transaction[];
}
