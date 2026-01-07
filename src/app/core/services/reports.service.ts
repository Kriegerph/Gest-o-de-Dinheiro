import { Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ReportResult } from '../models/report.model';
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
}
