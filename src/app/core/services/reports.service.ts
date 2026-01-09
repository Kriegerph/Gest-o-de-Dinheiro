import { Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { AnnualReportResult, ReportResult } from '../models/report.model';
import { TransactionsService } from './transactions.service';

@Injectable({
  providedIn: 'root'
})
export class ReportsService {
  constructor(private transactionsService: TransactionsService) {}

  getReport(uid: string, start: Date, end: Date): Observable<ReportResult> {
    return this.transactionsService.listByRange$(uid, start, end).pipe(
      map((transactions) => {
        const totalIncome = transactions
          .filter((t) => t.type === 'income')
          .reduce((acc, cur) => acc + cur.amount, 0);
        const totalExpense = transactions
          .filter((t) => t.type === 'expense')
          .reduce((acc, cur) => acc + cur.amount, 0);
        const byCategoryMap = transactions
          .filter((t) => t.type === 'expense' && !!t.categoryId)
          .reduce<Record<string, number>>((acc, tx) => {
            const key = tx.categoryId as string;
            acc[key] = (acc[key] || 0) + tx.amount;
            return acc;
          }, {});

        const byCategory = Object.entries(byCategoryMap).map(([categoryId, total]) => ({
          categoryId,
          categoryName: '',
          total
        }));

        return {
          summary: {
            totalIncome,
            totalExpense,
            balance: totalIncome - totalExpense
          },
          byCategory,
          transactions
        } as ReportResult;
      })
    );
  }

  getAnnualReport(uid: string, year: number): Observable<AnnualReportResult> {
    const start = new Date(year, 0, 1, 0, 0, 0);
    const end = new Date(year, 11, 31, 23, 59, 59);
    return this.transactionsService.listByRange$(uid, start, end).pipe(
      map((transactions) => {
        const months = Array.from({ length: 12 }, (_, idx) => ({
          month: idx + 1,
          income: 0,
          expense: 0,
          balance: 0
        }));

        transactions.forEach((tx) => {
          const [txYear, txMonth] = (tx.date || '').split('-').map(Number);
          if (txYear !== year || !txMonth) {
            return;
          }
          if (tx.type === 'income') {
            months[txMonth - 1].income += tx.amount;
          }
          if (tx.type === 'expense') {
            months[txMonth - 1].expense += tx.amount;
          }
        });

        months.forEach((m) => {
          m.balance = m.income - m.expense;
        });

        const totals = months.reduce(
          (acc, cur) => {
            acc.totalIncome += cur.income;
            acc.totalExpense += cur.expense;
            acc.balance += cur.balance;
            return acc;
          },
          { totalIncome: 0, totalExpense: 0, balance: 0 }
        );

        const hasData = months.some((m) => m.income > 0 || m.expense > 0);

        return {
          year,
          months,
          totals,
          hasData
        } as AnnualReportResult;
      })
    );
  }
}
