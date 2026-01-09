import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, startWith, switchMap, tap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { TransactionsService } from '../../core/services/transactions.service';
import { AccountsService } from '../../core/services/accounts.service';
import { CategoriesService } from '../../core/services/categories.service';
import { Transaction } from '../../core/models/transaction.model';
import { Account } from '../../core/models/account.model';
import { formatPtBrFromYmd } from '../../shared/utils/date.util';
import { DashboardChartsComponent } from './dashboard-charts.component';

type AverageState =
  | { ready: false; message: string }
  | { ready: true; months: number; average: number; current: number; diffPercent: number };
type LargestExpense = (Transaction & { categoryName: string }) | null;
type LargestExpenseState = { ready: boolean; value: LargestExpense };

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, DashboardChartsComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent {
  private auth = inject(AuthService);
  private transactionsService = inject(TransactionsService);
  private accountsService = inject(AccountsService);
  private categoriesService = inject(CategoriesService);

  readonly now = new Date();
  readonly month = this.now.getMonth() + 1;
  readonly year = this.now.getFullYear();
  loadingDashboard = true;
  readonly skeletonCards = Array.from({ length: 3 });
  readonly skeletonRows = Array.from({ length: 4 });
  average: AverageState | null = null;

  get averageMessage(): string {
    if (!this.average || this.average.ready) {
      return '';
    }
    return this.average.message;
  }

  transactions$ = this.auth.user$.pipe(
    tap(() => (this.loadingDashboard = true)),
    switchMap((user) =>
      user ? this.transactionsService.listMonth$(user.uid, this.month, this.year) : of([])
    ),
    tap(() => (this.loadingDashboard = false)),
    catchError(() => {
      this.loadingDashboard = false;
      return of([]);
    })
  );

  hasTransactions$ = this.transactions$.pipe(
    map((items) => items.length > 0),
    catchError(() => of(false))
  );

  allTransactions$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.transactionsService.listAll$(user.uid) : of([]))),
    catchError(() => of([]))
  );

  accounts$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.accountsService.list$(user.uid) : of([]))),
    catchError(() => of([]))
  );

  categories$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.categoriesService.list$(user.uid) : of([]))),
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

  accountsWithBalance$ = combineLatest([this.accounts$, this.allTransactions$]).pipe(
    map(([accounts, transactions]) => this.buildAccountBalances(accounts, transactions)),
    catchError(() => of([]))
  );

  balancesByAccount$ = this.accountsWithBalance$.pipe(
    map((accounts) =>
      [...accounts].sort((a, b) => b.currentBalance - a.currentBalance).slice(0, 5)
    ),
    catchError(() => of([]))
  );

  totalBalance$ = this.accountsWithBalance$.pipe(
    map((accounts) => accounts.reduce((acc, account) => acc + account.currentBalance, 0)),
    catchError(() => of(0))
  );

  topCategories$ = combineLatest([
    this.auth.user$.pipe(
      switchMap((user) =>
        user
          ? this.transactionsService.listMonthExpensesByCategory$(user.uid, this.month, this.year)
          : of({} as Record<string, number>)
      )
    ),
    this.categories$
  ]).pipe(
    map(([expenses, categories]) =>
      Object.entries(expenses)
        .map(([categoryId, total]) => {
          const category = categories.find((c) => c.id === categoryId);
          return {
            categoryId,
            categoryName: category?.name || 'Categoria',
            categoryColor: category?.color || '#6c7a89',
            total
          };
        })
        .sort((a, b) => b.total - a.total)
        .slice(0, 5)
    ),
    catchError(() => of([]))
  );

  dailySeries$ = this.transactions$.pipe(
    map((items) => {
      const totalDays = new Date(this.year, this.month, 0).getDate();
      const income = Array.from({ length: totalDays }, (_, idx) => ({ day: idx + 1, total: 0 }));
      const expense = Array.from({ length: totalDays }, (_, idx) => ({ day: idx + 1, total: 0 }));
      items.forEach((tx) => {
        const day = Number(tx.date?.split('-')[2] ?? 0);
        if (!day || day < 1 || day > totalDays) {
          return;
        }
        if (tx.type === 'income') {
          income[day - 1].total += tx.amount;
        }
        if (tx.type === 'expense') {
          expense[day - 1].total += tx.amount;
        }
      });
      return { income, expense };
    }),
    catchError(() => of({ income: [], expense: [] }))
  );

  charts$ = combineLatest([this.topCategories$, this.dailySeries$, this.accountsWithBalance$]).pipe(
    map(([topCategories, dailySeries, accounts]) => ({
      topCategories,
      dailyIncome: dailySeries.income,
      dailyExpense: dailySeries.expense,
      accounts
    })),
    catchError(() =>
      of({
        topCategories: [],
        dailyIncome: [],
        dailyExpense: [],
        accounts: []
      })
    )
  );

  largestExpense$ = combineLatest([this.transactions$, this.categories$]).pipe(
    map(([items, categories]) => {
      const largest = items
        .filter((tx) => tx.type === 'expense')
        .reduce<Transaction | null>(
          (max, cur) => (!max || cur.amount > max.amount ? cur : max),
          null
        );
      if (!largest) {
        return null;
      }
      return {
        ...largest,
        categoryName: categories.find((c) => c.id === largest.categoryId)?.name || 'Categoria'
      };
    }),
    catchError(() => of(null))
  );
  largestExpenseState$ = this.largestExpense$.pipe(
    map((value): LargestExpenseState => ({ ready: true, value })),
    startWith({ ready: false, value: null })
  );

  insights$ = combineLatest([
    this.transactions$,
    this.allTransactions$,
    this.topCategories$,
    this.largestExpense$
  ]).pipe(
    map(([currentTransactions, allTransactions, topCategories, largestExpense]) => {
      const currentExpense = currentTransactions
        .filter((tx) => tx.type === 'expense')
        .reduce((acc, cur) => acc + cur.amount, 0);
      const previous = this.getPreviousMonth(this.month, this.year);
      const previousExpense = this.sumExpensesForMonth(
        allTransactions,
        previous.month,
        previous.year
      );
      const hasHistory = previousExpense > 0;
      const diffPercent = hasHistory
        ? Math.round(((currentExpense - previousExpense) / previousExpense) * 100)
        : 0;

      return {
        comparison: {
          hasHistory,
          percent: Math.abs(diffPercent),
          direction: diffPercent >= 0 ? 'mais' : 'menos'
        },
        largestExpense,
        topCategory: topCategories.length > 0 ? topCategories[0] : null
      };
    }),
    catchError(() =>
      of({
        comparison: { hasHistory: false, percent: 0, direction: 'mais' },
        largestExpense: null,
        topCategory: null
      })
    )
  );

  averageComparison$ = this.allTransactions$.pipe(
    map((transactions): AverageState => {
      const months = this.buildRecentMonths(6);
      const totals = months.map(({ month, year }) => ({
        month,
        year,
        total: this.sumExpensesForMonth(transactions, month, year)
      }));
      const available = totals.filter((item) => item.total > 0);
      if (available.length < 2) {
        return { ready: false, message: 'Média disponivel a partir de 2 meses de dados.' };
      }

      const windowSize = available.length >= 6 ? 6 : Math.min(3, available.length);
      const window = available.slice(0, windowSize);
      const average = window.reduce((acc, cur) => acc + cur.total, 0) / window.length;
      const currentTotal = totals[0]?.total ?? 0;
      const diffPercent = average ? ((currentTotal - average) / average) * 100 : 0;

      return {
        ready: true,
        months: windowSize,
        average,
        current: currentTotal,
        diffPercent
      };
    }),
    catchError(() =>
      of<AverageState>({ ready: false, message: 'Média disponivel a partir de 2 meses de dados.' })
    ),
    tap((average) => {
      this.average = average;
    })
  );

  trackById(_: number, item: Transaction) {
    return item.id;
  }

  formatDate(ymd: string): string {
    return formatPtBrFromYmd(ymd);
  }

  private buildAccountBalances(accounts: Account[], transactions: Transaction[]) {
    return accounts.map((account) => {
      const income = transactions
        .filter((tx) => tx.type === 'income' && tx.accountId === account.id)
        .reduce((acc, cur) => acc + cur.amount, 0);
      const expense = transactions
        .filter((tx) => tx.type === 'expense' && tx.accountId === account.id)
        .reduce((acc, cur) => acc + cur.amount, 0);
      const transferOut = transactions
        .filter((tx) => tx.type === 'transfer' && tx.accountOriginId === account.id)
        .reduce((acc, cur) => acc + cur.amount, 0);
      const transferIn = transactions
        .filter((tx) => tx.type === 'transfer' && tx.accountDestinationId === account.id)
        .reduce((acc, cur) => acc + cur.amount, 0);
      const initialBalance = Number(account.initialBalance ?? 0);
      return {
        ...account,
        currentBalance: initialBalance + income - expense - transferOut + transferIn
      };
    });
  }

  private getMonthYear(ymd?: string | null) {
    if (!ymd) {
      return null;
    }
    const [year, month] = ymd.split('-').map(Number);
    if (!year || !month) {
      return null;
    }
    return { year, month };
  }

  private getPreviousMonth(month: number, year: number) {
    if (month === 1) {
      return { month: 12, year: year - 1 };
    }
    return { month: month - 1, year };
  }

  private buildRecentMonths(count: number) {
    const result: Array<{ month: number; year: number }> = [];
    let month = this.month;
    let year = this.year;
    for (let i = 0; i < count; i += 1) {
      result.push({ month, year });
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
    }
    return result;
  }

  private sumExpensesForMonth(transactions: Transaction[], month: number, year: number) {
    return transactions
      .filter((tx) => {
        if (tx.type !== 'expense') {
          return false;
        }
        const parsed = this.getMonthYear(tx.date);
        return parsed ? parsed.month === month && parsed.year === year : false;
      })
      .reduce((acc, cur) => acc + cur.amount, 0);
  }
}
