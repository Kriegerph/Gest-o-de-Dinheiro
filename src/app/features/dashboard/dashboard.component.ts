import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, switchMap, tap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { TransactionsService } from '../../core/services/transactions.service';
import { AccountsService } from '../../core/services/accounts.service';
import { CategoriesService } from '../../core/services/categories.service';
import { BudgetsService } from '../../core/services/budgets.service';
import { CreditService } from '../credit/credit.service';
import { Transaction } from '../../core/models/transaction.model';
import { Account } from '../../core/models/account.model';
import { Category } from '../../core/models/category.model';
import { formatPtBrFromYmd } from '../../shared/utils/date.util';

type AlertTone = 'info' | 'warning' | 'danger' | 'success';

type KpiState = {
  totalBalance: number;
  income: number;
  expense: number;
  result: number;
  incomeCommitmentPercent: number;
  fixedVariable: string | null;
  creditPaid: number | null;
  creditOpen: number | null;
  creditTotal: number | null;
  billPaid: number | null;
  billOpen: number | null;
  billTotal: number | null;
  upcoming7: number | null;
  upcoming15: number | null;
};

type AlertItem = {
  tone: AlertTone;
  title: string;
  detail?: string;
};

type DonutSlice = {
  label: string;
  total: number;
  color: string;
  percent: number;
};

type DonutChart = {
  total: number;
  gradient: string;
  slices: DonutSlice[];
  empty: boolean;
};

type LineChart = {
  empty: boolean;
  path: string;
  labels: Array<{ x: number; text: string }>;
  grid: number[];
  viewBox: string;
  width: number;
  height: number;
  labelY: number;
};

type MonthlyComparisonRow = {
  label: string;
  income: number;
  expense: number;
  result: number;
  incomePct: number;
  expensePct: number;
  resultPct: number;
};

type MonthProgressWeek = {
  label: string;
  value: number;
  percent: number;
};

type MonthProgressForecast = {
  avgPerDay: number | null;
  projectedTotal: number | null;
  remainingDays: number;
};

type MonthProgress = {
  weeklySpend: MonthProgressWeek[];
  topCategories: CategoryBreakdown[];
  forecast: MonthProgressForecast;
  totalExpense: number;
};

type CategoryBreakdown = {
  categoryId: string;
  name: string;
  total: number;
  color: string;
  percent: number;
};

type BestCategory = {
  categoryId: string;
  categoryName: string;
  total: number;
  percent: number;
};

type TransactionView = {
  id?: string;
  date: string;
  description: string;
  type: string;
  amount: number;
  accountName: string;
  categoryName: string;
};

type UpcomingInstallmentView = {
  id?: string;
  dueDate: string;
  amount: number;
  cardName: string;
  paid: boolean;
};

type BudgetProgressView = {
  id?: string;
  categoryName: string;
  limit: number;
  spent: number;
  remaining: number;
  percent: number;
};

type CreditCardSummaryView = {
  id?: string;
  name: string;
  limit: number | null;
  used: number;
  available: number | null;
  percent: number | null;
};

type AccountSummaryView = {
  id?: string;
  name: string;
  currentBalance: number;
  income: number;
  expense: number;
  net: number;
  diffPercent: number | null;
};

type DashboardView = {
  monthLabel: string;
  kpis: KpiState;
  alerts: AlertItem[];
  charts: {
    dailyBalance: LineChart;
    categoryDonut: DonutChart;
    monthlyComparison: MonthlyComparisonRow[];
    topCategories: CategoryBreakdown[];
  };
  monthProgress: MonthProgress;
  lists: {
    recentTransactions: TransactionView[];
    upcomingInstallments: UpcomingInstallmentView[];
    budgets: BudgetProgressView[];
    creditCards: CreditCardSummaryView[];
  };
  accounts: AccountSummaryView[];
};

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent {
  private auth = inject(AuthService);
  private transactionsService = inject(TransactionsService);
  private accountsService = inject(AccountsService);
  private categoriesService = inject(CategoriesService);
  private budgetsService = inject(BudgetsService);
  private creditService = inject(CreditService);

  readonly now = new Date();
  readonly month = this.now.getMonth() + 1;
  readonly year = this.now.getFullYear();
  readonly today = new Date(this.now.getFullYear(), this.now.getMonth(), this.now.getDate());
  readonly previous = this.getPreviousMonth(this.month, this.year);
  readonly next7 = this.addDays(this.today, 7);
  readonly next15 = this.addDays(this.today, 15);

  loadingDashboard = true;
  readonly skeletonCards = Array.from({ length: 6 });
  readonly skeletonRows = Array.from({ length: 5 });

  transactions$ = this.auth.user$.pipe(
    tap(() => (this.loadingDashboard = true)),
    switchMap((user) =>
      user ? this.transactionsService.listMonth$(user.uid, this.month, this.year) : of([])
    ),
    catchError(() => of([]))
  );

  allTransactions$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.transactionsService.listAll$(user.uid) : of([]))),
    catchError(() => of([]))
  );

  recentTransactions$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.transactionsService.listRecent$(user.uid, 10) : of([]))),
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

  budgets$ = this.auth.user$.pipe(
    switchMap((user) =>
      user ? this.budgetsService.listByMonth$(user.uid, this.month, this.year) : of([])
    ),
    catchError(() => of([]))
  );

  creditCards$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.creditService.listCards$(user.uid) : of([]))),
    catchError(() => of([]))
  );

  creditInstallments$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.creditService.listInstallments$(user.uid) : of([]))),
    catchError(() => of([]))
  );

  view$ = combineLatest([
    this.accounts$,
    this.transactions$,
    this.allTransactions$,
    this.categories$,
    this.budgets$,
    this.creditCards$,
    this.creditInstallments$,
    this.recentTransactions$
  ]).pipe(
    map(
      ([
        accounts,
        monthTransactions,
        allTransactions,
        categories,
        budgets,
        creditCards,
        creditInstallments,
        recentTransactions
      ]) => {
        const accountsWithBalance = this.buildAccountBalances(accounts, allTransactions);
        const accountMap = new Map(accounts.map((acc) => [acc.id || '', acc]));
        const categoryMap = new Map(categories.map((cat) => [cat.id || '', cat]));
        const cardMap = new Map(creditCards.map((card) => [card.id || '', card]));

        const totalBalance = this.sum(accountsWithBalance.map((acc) => acc.currentBalance));
        const income = this.sum(
          monthTransactions.filter((tx) => tx.type === 'income').map((tx) => tx.amount)
        );
        const expense = this.sum(
          monthTransactions.filter((tx) => tx.type === 'expense').map((tx) => tx.amount)
        );
        const result = income - expense;
        const incomeCommitmentPercent = income > 0 ? (expense / income) * 100 : 0;

        const expensesByCategory = this.sumByCategory(monthTransactions);
        const prevExpensesByCategory = this.sumByCategory(
          allTransactions.filter((tx) => this.isInMonth(tx.date, this.previous.month, this.previous.year))
        );

        const categoryBreakdown = this.buildCategoryBreakdown(expensesByCategory, categories);
        const categoryDonut = this.buildCategoryDonut(categoryBreakdown);
        const dailyBalance = this.buildDailyBalanceChart(monthTransactions);
        const monthlyComparison = this.buildMonthlyComparison(allTransactions);
        const prevExpenseTotal = this.sum(Array.from(prevExpensesByCategory.values()));
        const topCategoryAlert = this.getTopCategory(expensesByCategory, categories, expense);
        const monthProgress = this.buildMonthProgress(monthTransactions, categoryBreakdown);

        const monthInstallments = creditInstallments.filter((inst) =>
          this.isInMonth(inst.dueDate, this.month, this.year)
        );
        const creditTotalValue = this.sum(monthInstallments.map((i) => Number(i.amount ?? 0)));
        const creditBillOpenValue = this.sum(
          monthInstallments.filter((i) => !i.paid).map((i) => Number(i.amount ?? 0))
        );
        const creditPaidValue = this.sum(
          creditInstallments
            .filter((inst) => {
              if (!inst.paid) {
                return false;
              }
              const paidDate = this.toDate(inst.paidAt);
              return paidDate
                ? paidDate.getMonth() + 1 === this.month && paidDate.getFullYear() === this.year
                : false;
            })
            .map((inst) => Number(inst.amount ?? 0))
        );
        const hasCreditMonth =
          creditTotalValue > 0 || creditPaidValue > 0 || creditBillOpenValue > 0;

        const creditTotal = hasCreditMonth ? creditTotalValue : null;
        const creditPaid = hasCreditMonth ? creditPaidValue : null;
        const creditOpen = hasCreditMonth
          ? Math.max(0, creditTotalValue - creditPaidValue)
          : null;
        const creditBillOpen = hasCreditMonth ? creditBillOpenValue : null;

        const upcomingInstallments = creditInstallments
          .map((inst) => {
            const due = this.toDate(inst.dueDate);
            if (!due) {
              return null;
            }
            const isUpcoming = this.inRange(due, this.today, this.next15);
            if (!isUpcoming) {
              return null;
            }
            const cardName = cardMap.get(inst.cardId)?.name || 'Cartão';
            return {
              id: inst.id,
              dueDate: inst.dueDate,
              amount: Number(inst.amount ?? 0),
              cardName,
              paid: Boolean(inst.paid)
            } as UpcomingInstallmentView;
          })
          .filter((item): item is UpcomingInstallmentView => Boolean(item))
          .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

        const upcoming7Value = this.sum(
          creditInstallments
            .filter((inst) => {
              const due = this.toDate(inst.dueDate);
              return due ? this.inRange(due, this.today, this.next7) : false;
            })
            .filter((inst) => !inst.paid)
            .map((inst) => inst.amount)
        );
        const upcoming15Value = this.sum(
          creditInstallments
            .filter((inst) => {
              const due = this.toDate(inst.dueDate);
              return due ? this.inRange(due, this.today, this.next15) : false;
            })
            .filter((inst) => !inst.paid)
            .map((inst) => inst.amount)
        );
        const hasUpcoming = creditInstallments.length > 0;

        const kpis: KpiState = {
          totalBalance,
          income,
          expense,
          result,
          incomeCommitmentPercent,
          fixedVariable: null,
          creditPaid,
          creditOpen,
          creditTotal,
          billPaid: creditPaid,
          billOpen: creditBillOpen,
          billTotal: creditTotal,
          upcoming7: hasUpcoming ? upcoming7Value : null,
          upcoming15: hasUpcoming ? upcoming15Value : null
        };

        const budgetProgress = budgets.map((budget) => {
          const spent = expensesByCategory.get(budget.categoryId) ?? 0;
          const remaining = budget.limitAmount - spent;
          const percent = budget.limitAmount > 0 ? Math.min(100, (spent / budget.limitAmount) * 100) : 0;
          return {
            id: budget.id,
            categoryName: categoryMap.get(budget.categoryId)?.name || 'Categoria',
            limit: budget.limitAmount,
            spent,
            remaining,
            percent
          } as BudgetProgressView;
        });

        const creditByCard = new Map<string, number>();
        creditInstallments
          .filter((inst) => !inst.paid)
          .forEach((inst) => {
            const current = creditByCard.get(inst.cardId) ?? 0;
            creditByCard.set(inst.cardId, current + Number(inst.amount ?? 0));
          });

        const creditCardSummary = creditCards.map((card) => {
          const used = creditByCard.get(card.id || '') ?? 0;
          const limit = card.limit ?? null;
          const available = limit !== null ? limit - used : null;
          const percent = limit && limit > 0 ? (used / limit) * 100 : null;
          return {
            id: card.id,
            name: card.name,
            limit,
            used,
            available,
            percent
          } as CreditCardSummaryView;
        });

        const alerts: AlertItem[] = [];
        if (topCategoryAlert) {
          alerts.push({
            tone: 'info',
            title: `Maior gasto do mês: ${topCategoryAlert.categoryName}`,
            detail: `${this.formatCurrency(topCategoryAlert.total)} (${topCategoryAlert.percent.toFixed(0)}%)`
          });
        }

        if (prevExpenseTotal > 0) {
          const diff = ((expense - prevExpenseTotal) / prevExpenseTotal) * 100;
          alerts.push({
            tone: diff >= 0 ? 'warning' : 'success',
            title: 'Despesas vs mês anterior',
            detail: `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%`
          });
        }

        const lowestAccount = [...accountsWithBalance].sort(
          (a, b) => a.currentBalance - b.currentBalance
        )[0];
        if (lowestAccount) {
          alerts.push({
            tone: 'danger',
            title: `Menor saldo: ${lowestAccount.name}`,
            detail: this.formatCurrency(lowestAccount.currentBalance)
          });
        }

        const upcomingInstallments7 = creditInstallments.filter((inst) => {
          const due = this.toDate(inst.dueDate);
          return due ? this.inRange(due, this.today, this.next7) && !inst.paid : false;
        });
        const upcomingBills7 = allTransactions.filter((tx) => {
          const anyTx = tx as { type?: string; kind?: string; isBill?: boolean; date?: unknown };
          if (!(anyTx?.type === 'bill' || anyTx?.kind === 'due' || anyTx?.isBill === true)) {
            return false;
          }
          const due = this.toDate(anyTx.date);
          return due ? this.inRange(due, this.today, this.next7) : false;
        });
        const upcomingTotal =
          this.sum(upcomingInstallments7.map((inst) => inst.amount)) +
          this.sum(upcomingBills7.map((tx) => tx.amount));
        const upcomingCount = upcomingInstallments7.length + upcomingBills7.length;
        if (upcomingCount > 0) {
          alerts.push({
            tone: 'warning',
            title: 'Vencimentos nos próximos 7 dias',
            detail: `${upcomingCount} itens - ${this.formatCurrency(upcomingTotal)}`
          });
        }

        const budgetAlerts = budgetProgress
          .filter((budget) => budget.percent >= 80)
          .sort((a, b) => b.percent - a.percent)
          .slice(0, 2);
        budgetAlerts.forEach((budget) => {
          alerts.push({
            tone: budget.percent >= 100 ? 'danger' : 'warning',
            title: `Meta: ${budget.categoryName}`,
            detail: `${budget.percent.toFixed(0)}% usado`
          });
        });

        const recentView = recentTransactions.map((tx) => {
          const categoryName = tx.categoryId
            ? categoryMap.get(tx.categoryId)?.name || 'Categoria'
            : 'Sem categoria';
          let accountName = '-';
          if (tx.type === 'transfer') {
            const origin = accountMap.get(tx.accountOriginId || '')?.name || '-';
            const dest = accountMap.get(tx.accountDestinationId || '')?.name || '-';
            accountName = `${origin} -> ${dest}`;
          } else {
            accountName = accountMap.get(tx.accountId || '')?.name || '-';
          }

          return {
            id: tx.id,
            date: tx.date,
            description: tx.description,
            type: tx.type,
            amount: tx.amount,
            accountName,
            categoryName
          } as TransactionView;
        });

        const accountsSummary = accountsWithBalance.map((account) => {
          const currentTotals = this.sumAccountMonth(allTransactions, account.id, this.month, this.year);
          const prevTotals = this.sumAccountMonth(
            allTransactions,
            account.id,
            this.previous.month,
            this.previous.year
          );
          const diffPercent =
            prevTotals.net !== 0 ? ((currentTotals.net - prevTotals.net) / Math.abs(prevTotals.net)) * 100 : null;
          return {
            id: account.id,
            name: account.name,
            currentBalance: account.currentBalance,
            income: currentTotals.income,
            expense: currentTotals.expense,
            net: currentTotals.net,
            diffPercent
          } as AccountSummaryView;
        });

        return {
          monthLabel: `${this.month}/${this.year}`,
          kpis,
          alerts: alerts.slice(0, 6),
          charts: {
            dailyBalance,
            categoryDonut,
            monthlyComparison,
            topCategories: categoryBreakdown
          },
          monthProgress,
          lists: {
            recentTransactions: recentView,
            upcomingInstallments,
            budgets: budgetProgress,
            creditCards: creditCardSummary
          },
          accounts: accountsSummary
        } as DashboardView;
      }
    ),
    tap(() => (this.loadingDashboard = false)),
    catchError(() => {
      this.loadingDashboard = false;
      return of(this.emptyView());
    })
  );

  formatDate(ymd: string): string {
    return formatPtBrFromYmd(ymd);
  }

  private emptyView(): DashboardView {
      return {
        monthLabel: `${this.month}/${this.year}`,
        kpis: {
          totalBalance: 0,
          income: 0,
          expense: 0,
          result: 0,
          incomeCommitmentPercent: 0,
          fixedVariable: null,
          creditPaid: null,
          creditOpen: null,
        creditTotal: null,
        billPaid: null,
        billOpen: null,
        billTotal: null,
        upcoming7: null,
        upcoming15: null
      },
      alerts: [],
      charts: {
        dailyBalance: this.emptyLineChart(),
        categoryDonut: { total: 0, gradient: '', slices: [], empty: true },
        monthlyComparison: [],
        topCategories: []
      },
      monthProgress: {
        weeklySpend: [],
        topCategories: [],
        forecast: { avgPerDay: null, projectedTotal: null, remainingDays: 0 },
        totalExpense: 0
      },
      lists: {
        recentTransactions: [],
        upcomingInstallments: [],
        budgets: [],
        creditCards: []
      },
      accounts: []
    };
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

  private sumAccountMonth(
    transactions: Transaction[],
    accountId: string | undefined,
    month: number,
    year: number
  ) {
    if (!accountId) {
      return { income: 0, expense: 0, net: 0 };
    }
    const inMonth = transactions.filter((tx) => this.isInMonth(tx.date, month, year));
    const income = inMonth
      .filter((tx) => tx.type === 'income' && tx.accountId === accountId)
      .reduce((acc, cur) => acc + cur.amount, 0);
    const expense = inMonth
      .filter((tx) => tx.type === 'expense' && tx.accountId === accountId)
      .reduce((acc, cur) => acc + cur.amount, 0);
    const transferOut = inMonth
      .filter((tx) => tx.type === 'transfer' && tx.accountOriginId === accountId)
      .reduce((acc, cur) => acc + cur.amount, 0);
    const transferIn = inMonth
      .filter((tx) => tx.type === 'transfer' && tx.accountDestinationId === accountId)
      .reduce((acc, cur) => acc + cur.amount, 0);
    const net = income - expense - transferOut + transferIn;
    return { income, expense, net };
  }

  private sumByCategory(transactions: Transaction[]) {
    const mapResult = new Map<string, number>();
    transactions
      .filter((tx) => tx.type === 'expense')
      .forEach((tx) => {
        const key = tx.categoryId || 'uncategorized';
        mapResult.set(key, (mapResult.get(key) ?? 0) + tx.amount);
      });
    return mapResult;
  }

  private buildCategoryBreakdown(expenses: Map<string, number>, categories: Category[]) {
    const items = Array.from(expenses.entries()).map(([categoryId, total]) => {
      const category = categories.find((cat) => cat.id === categoryId);
      return {
        categoryId,
        name: category?.name || 'Categoria',
        total,
        color: category?.color || '#5ad1ff',
        percent: 0
      } as CategoryBreakdown;
    });
    const sorted = items.sort((a, b) => b.total - a.total).slice(0, 5);
    const maxValue = Math.max(...sorted.map((item) => item.total), 0);
    return sorted.map((item) => ({
      ...item,
      percent: maxValue > 0 ? (item.total / maxValue) * 100 : 0
    }));
  }

  private buildCategoryDonut(items: CategoryBreakdown[]): DonutChart {
    const filtered = items.filter((item) => item.total > 0);
    const total = filtered.reduce((acc, cur) => acc + cur.total, 0);
    if (filtered.length === 0 || total <= 0) {
      return { total: 0, gradient: '', slices: [], empty: true };
    }

    const slices = filtered.map((item) => ({
      label: item.name,
      total: item.total,
      color: item.color,
      percent: (item.total / total) * 100
    }));

    let start = 0;
    const gradient = slices
      .map((slice) => {
        const end = start + slice.percent;
        const seg = `${slice.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
        start = end;
        return seg;
      })
      .join(', ');

    return {
      total,
      gradient: `conic-gradient(${gradient})`,
      slices,
      empty: false
    };
  }

  private buildDailyBalanceChart(transactions: Transaction[]): LineChart {
    const width = 360;
    const height = 160;
    const paddingTop = 14;
    const paddingBottom = 24;
    const paddingX = 16;
    const plotWidth = width - paddingX * 2;
    const plotHeight = height - paddingTop - paddingBottom;
    const totalDays = new Date(this.year, this.month, 0).getDate();

    if (totalDays <= 0) {
      return this.emptyLineChart();
    }

    const dailyNet = Array.from({ length: totalDays }, () => 0);
    transactions.forEach((tx) => {
      const day = Number(tx.date?.split('-')[2] ?? 0);
      if (!day || day < 1 || day > totalDays) {
        return;
      }
      if (tx.type === 'income') {
        dailyNet[day - 1] += tx.amount;
      }
      if (tx.type === 'expense') {
        dailyNet[day - 1] -= tx.amount;
      }
    });

    let running = 0;
    const values = dailyNet.map((value) => {
      running += value;
      return running;
    });

    const maxValue = Math.max(...values, 0);
    const minValue = Math.min(...values, 0);
    if (maxValue === 0 && minValue === 0) {
      return this.emptyLineChart();
    }

    const range = maxValue - minValue || 1;
    const points = values.map((value, index) => {
      const x =
        totalDays === 1
          ? paddingX + plotWidth / 2
          : paddingX + (index / (totalDays - 1)) * plotWidth;
      const y = paddingTop + (1 - (value - minValue) / range) * plotHeight;
      return { x, y };
    });

    const path = points.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    const labels = this.buildLineLabels(totalDays, paddingX, plotWidth);

    return {
      empty: false,
      path,
      labels,
      grid: [paddingTop, paddingTop + plotHeight / 2, paddingTop + plotHeight],
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      labelY: height - 8
    };
  }

  private buildLineLabels(totalDays: number, paddingX: number, plotWidth: number) {
    if (totalDays <= 0) {
      return [];
    }
    const midIndex = Math.floor((totalDays - 1) / 2);
    const indices = totalDays <= 2 ? [0, totalDays - 1] : [0, midIndex, totalDays - 1];
    const uniqueIndices = Array.from(new Set(indices.filter((idx) => idx >= 0)));

    return uniqueIndices.map((idx) => {
      const x =
        totalDays === 1
          ? paddingX + plotWidth / 2
          : paddingX + (idx / (totalDays - 1)) * plotWidth;
      const text = (idx + 1).toString().padStart(2, '0');
      return { x, text };
    });
  }

  private buildMonthlyComparison(transactions: Transaction[]): MonthlyComparisonRow[] {
    const months = this.buildRecentMonths(6);
    const rows = months.map(({ month, year }) => {
      const data = transactions.filter((tx) => this.isInMonth(tx.date, month, year));
      const income = data
        .filter((tx) => tx.type === 'income')
        .reduce((acc, cur) => acc + cur.amount, 0);
      const expense = data
        .filter((tx) => tx.type === 'expense')
        .reduce((acc, cur) => acc + cur.amount, 0);
      const result = income - expense;
      return {
        label: `${month.toString().padStart(2, '0')}/${year}`,
        income,
        expense,
        result,
        incomePct: 0,
        expensePct: 0,
        resultPct: 0
      } as MonthlyComparisonRow;
    });

    const maxValue = Math.max(
      ...rows.flatMap((row) => [row.income, row.expense, Math.abs(row.result)]),
      0
    );

    return rows.map((row) => ({
      ...row,
      incomePct: maxValue > 0 ? (row.income / maxValue) * 100 : 0,
      expensePct: maxValue > 0 ? (row.expense / maxValue) * 100 : 0,
      resultPct: maxValue > 0 ? (Math.abs(row.result) / maxValue) * 100 : 0
    }));
  }

  private buildMonthProgress(
    transactions: Transaction[],
    topCategories: CategoryBreakdown[]
  ): MonthProgress {
    const expenses = transactions.filter((tx) => tx.type === 'expense');
    const totalExpense = this.sum(expenses.map((tx) => tx.amount));
    const weeklyBuckets = [0, 0, 0, 0, 0];

    expenses.forEach((tx) => {
      const day = Number(tx.date?.split('-')[2] ?? 0);
      if (!day) {
        return;
      }
      const index = day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : day <= 28 ? 3 : 4;
      weeklyBuckets[index] += tx.amount;
    });

    const maxWeek = Math.max(...weeklyBuckets, 0);
    const weeklySpend = weeklyBuckets.map((value, index) => ({
      label: `Sem ${index + 1}`,
      value,
      percent: maxWeek > 0 ? (value / maxWeek) * 100 : 0
    }));

    const totalDays = new Date(this.year, this.month, 0).getDate();
    const daysPassed = Math.min(this.today.getDate(), totalDays);
    const expenseToDate = this.sum(
      expenses
        .filter((tx) => {
          const date = this.toDate(tx.date);
          return date ? date <= this.today : false;
        })
        .map((tx) => tx.amount)
    );
    const avgPerDay =
      daysPassed > 0 && expenseToDate > 0 ? expenseToDate / daysPassed : null;
    const projectedTotal = avgPerDay !== null ? avgPerDay * totalDays : null;
    const remainingDays = Math.max(0, totalDays - daysPassed);

    return {
      weeklySpend,
      topCategories,
      forecast: {
        avgPerDay,
        projectedTotal,
        remainingDays
      },
      totalExpense
    };
  }

  private getTopCategory(
    expenses: Map<string, number>,
    categories: Category[],
    totalExpense: number
  ): BestCategory | null {
    let best: BestCategory | null = null;
    expenses.forEach((value, key) => {
      if (value <= 0) {
        return;
      }
      if (!best || value > best.total) {
        const categoryName = categories.find((cat) => cat.id === key)?.name || 'Categoria';
        const percent = totalExpense > 0 ? (value / totalExpense) * 100 : 0;
        best = {
          categoryId: key,
          categoryName,
          total: value,
          percent
        };
      }
    });
    return best;
  }

  private getLatestTransactionDate(transactions: Transaction[]) {
    const dates = transactions
      .map((tx) => this.toDate(tx.date))
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => b.getTime() - a.getTime());
    return dates[0] ?? null;
  }

  private isInMonth(dateValue: string | null | undefined, month: number, year: number) {
    const parsed = this.getMonthYear(dateValue);
    return parsed ? parsed.month === month && parsed.year === year : false;
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

  private sum(values: number[]) {
    return values.reduce((acc, cur) => acc + cur, 0);
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }

  private isDateLike(value: unknown): value is Date {
    return value instanceof Date;
  }

  private toDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }
    if (this.isDateLike(value)) {
      return value;
    }
    if (typeof value === 'number') {
      return new Date(value);
    }
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split('-').map(Number);
        return new Date(year, month - 1, day);
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const anyVal = value as { toDate?: () => Date };
    if (anyVal?.toDate && typeof anyVal.toDate === 'function') {
      return anyVal.toDate();
    }
    return null;
  }

  private inRange(date: Date, start: Date, end: Date): boolean {
    return date >= start && date <= end;
  }

  private daysBetween(start: Date, end: Date): number {
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const diff = endDay.getTime() - startDay.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
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

  private emptyLineChart(): LineChart {
    return {
      empty: true,
      path: '',
      labels: [],
      grid: [],
      viewBox: '0 0 360 160',
      width: 360,
      height: 160,
      labelY: 152
    };
  }
}
