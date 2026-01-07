import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { catchError, map, of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { TransactionsService } from '../../core/services/transactions.service';
import { Transaction } from '../../core/models/transaction.model';
import { formatPtBrFromYmd } from '../../shared/utils/date.util';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent {
  private auth = inject(AuthService);
  private transactionsService = inject(TransactionsService);

  readonly now = new Date();
  readonly month = this.now.getMonth() + 1;
  readonly year = this.now.getFullYear();

  transactions$ = this.auth.user$.pipe(
    switchMap((user) =>
      user ? this.transactionsService.listMonth$(user.uid, this.month, this.year) : of([])
    ),
    catchError(() => of([]))
  );

  summary$ = this.transactions$.pipe(
    map((items) => {
      const totalIncome = items
        .filter((t) => t.type === 'income')
        .reduce((acc, cur) => acc + cur.amount, 0);
      const totalExpense = items
        .filter((t) => t.type === 'expense')
        .reduce((acc, cur) => acc + cur.amount, 0);
      return {
        totalIncome,
        totalExpense,
        balance: totalIncome - totalExpense
      };
    }),
    catchError(() => of({ totalIncome: 0, totalExpense: 0, balance: 0 }))
  );

  recent$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.transactionsService.listRecent$(user.uid, 5) : of([]))),
    catchError(() => of([]))
  );

  trackById(_: number, item: Transaction) {
    return item.id;
  }

  formatDate(ymd: string): string {
    return formatPtBrFromYmd(ymd);
  }
}
