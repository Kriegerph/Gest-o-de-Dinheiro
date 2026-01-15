import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  firstValueFrom,
  map,
  of,
  switchMap,
  tap
} from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ReportsService } from '../../core/services/reports.service';
import { CategoriesService } from '../../core/services/categories.service';
import { AccountsService } from '../../core/services/accounts.service';
import { CreditService } from '../credit/credit.service';
import { Account } from '../../core/models/account.model';
import { CreditInstallment } from '../../core/models/credit-installment.model';
import { CreditPurchase } from '../../core/models/credit-purchase.model';
import { AnnualReportResult, ReportResult } from '../../core/models/report.model';
import { formatPtBrFromYmd, localDateFromYmd, toYmdFromLocalDate } from '../../shared/utils/date.util';
import {
  LancamentoRelatorio,
  LancamentoRelatorioCsv,
  LancamentoRelatorioCsvAnual,
  ReportExportService
} from '../../services/report-export.service';
import { NotificationService } from '../../core/services/notification.service';
import { saveAs } from 'file-saver';

type CreditStatusFilter = 'all' | 'paid' | 'pending';
type CreditViewFilter = 'due' | 'payment';

type CreditFilters = {
  month: number;
  year: number;
  cardId: string;
  status: CreditStatusFilter;
  view: CreditViewFilter;
};

type CreditSummary = {
  total: number;
  paid: number;
  pending: number;
  countTotal: number;
  countPaid: number;
  countPending: number;
};

type CreditCardSummary = {
  cardId: string;
  cardName: string;
  summary: CreditSummary;
};

type CreditBillRow = {
  dueDate: string;
  description: string;
  categoryName: string;
  installmentLabel: string;
  amount: number;
  status: string;
  paidAt?: string;
  accountName: string;
  cardName: string;
  purchaseId?: string;
  purchaseDate?: string;
};

type CreditPaymentRow = {
  paidAt: string;
  dueDate?: string;
  amount: number;
  description: string;
  installmentLabel: string;
  cardName: string;
  accountName: string;
  movementId?: string;
  purchaseId?: string;
};

type CreditCategoryRow = {
  categoryName: string;
  total: number;
  percent: number;
};

type CreditReportView = {
  periodLabel: string;
  cardLabel: string;
  summary: CreditSummary;
  cardSummaries: CreditCardSummary[];
  billRows: CreditBillRow[];
  billRowsAll: CreditBillRow[];
  paymentRows: CreditPaymentRow[];
  paymentRowsAll: CreditPaymentRow[];
  topCategories: CreditCategoryRow[];
  cardsCount: number;
  hasData: boolean;
  filters: CreditFilters;
};

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.css'
})
export class ReportsComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private reportsService = inject(ReportsService);
  private categoriesService = inject(CategoriesService);
  private accountsService = inject(AccountsService);
  private creditService = inject(CreditService);
  private reportExportService = inject(ReportExportService);
  private notifications = inject(NotificationService);

  lastReport: ReportResult | null = null;
  lastAnnualReport: AnnualReportResult | null = null;
  loadingReport = true;
  loadingAnnualReport = true;
  exportingXlsx = false;
  exportingCsv = false;
  exportingAnnualXlsx = false;
  exportingAnnualCsv = false;
  exportingCreditCsv = false;
  exportingCreditXlsx = false;
  lastCreditReport: CreditReportView | null = null;
  readonly skeletonCards = Array.from({ length: 3 });
  readonly skeletonRows = Array.from({ length: 4 });
  readonly monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  readonly currentMonth = new Date().getMonth() + 1;
  readonly currentYear = new Date().getFullYear();
  viewMode: 'default' | 'credit' = 'default';
  periodMode: 'period' | 'annual' = 'period';
  annualYear = this.currentYear;
  annualYears = Array.from({ length: 6 }).map((_, i) => this.currentYear - 2 + i);
  creditYears = Array.from({ length: 6 }).map((_, i) => this.currentYear - 2 + i);

  form = this.fb.group({
    start: [toYmdFromLocalDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), Validators.required],
    end: [toYmdFromLocalDate(new Date()), Validators.required]
  });

  creditForm = this.fb.group({
    month: [this.currentMonth, Validators.required],
    year: [this.currentYear, Validators.required],
    cardId: ['all'],
    status: ['all'],
    view: ['due']
  });

  private filters$ = new BehaviorSubject<{ start: string; end: string }>({
    start: this.form.value.start || toYmdFromLocalDate(new Date()),
    end: this.form.value.end || toYmdFromLocalDate(new Date())
  });
  private annualYear$ = new BehaviorSubject<number>(this.annualYear);
  private creditFilters$ = new BehaviorSubject<CreditFilters>(
    this.normalizeCreditFilters(this.creditForm.value)
  );

  categories$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.categoriesService.list$(user.uid) : of([])))
  );

  accounts$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.accountsService.list$(user.uid) : of([]))),
    map((items) => items ?? [])
  );

  creditCards$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.creditService.listCards$(user.uid) : of([]))),
    map((items) => items ?? [])
  );

  creditPurchases$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.creditService.listPurchases$(user.uid) : of([]))),
    map((items) => items ?? [])
  );

  creditInstallments$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.creditService.listInstallments$(user.uid) : of([]))),
    map((items) => items ?? [])
  );

  report$ = combineLatest([this.auth.user$, this.filters$]).pipe(
    switchMap(([user, filters]) =>
      user
        ? this.reportsService.getReport(
            user.uid,
            localDateFromYmd(filters.start) ?? new Date(),
            localDateFromYmd(filters.end) ?? new Date()
          )
        : of(null)
    ),
    switchMap((report) =>
      combineLatest([of(report), this.categories$, this.accounts$]).pipe(
        map(([rep, categories, accounts]) => {
          if (!rep) {
            return null;
          }
          const byCategory = rep.byCategory.map((item) => ({
            ...item,
            categoryName: categories.find((c) => c.id === item.categoryId)?.name || 'Categoria'
          }));
          const openingBalance = this.getSaldoInicialTotal(accounts);
          const totalIncome = rep.summary.totalIncome ?? 0;
          const totalExpense = rep.summary.totalExpense ?? 0;
          return {
            ...rep,
            summary: {
              ...rep.summary,
              balance: openingBalance + totalIncome - totalExpense
            },
            byCategory
          } as ReportResult;
        })
      )
    ),
    tap((report) => {
      this.lastReport = report;
      this.loadingReport = false;
    }),
    catchError(() => {
      this.loadingReport = false;
      this.lastReport = null;
      return of(null);
    })
  );

  annualReport$ = combineLatest([this.auth.user$, this.annualYear$]).pipe(
    switchMap(([user, year]) =>
      user ? this.reportsService.getAnnualReport(user.uid, year) : of(null)
    ),
    switchMap((report) =>
      combineLatest([of(report), this.accounts$]).pipe(
        map(([annual, accounts]) => {
          if (!annual) {
            return null;
          }
          const saldoInicialTotal = this.getSaldoInicialTotal(accounts);
          const now = new Date();
          const currentYear = now.getFullYear();
          const currentMonthIndex = now.getMonth();
          const selectedYear = Number(annual.year ?? this.annualYear);
          const limitMonth =
            selectedYear < currentYear ? 11 : selectedYear > currentYear ? -1 : currentMonthIndex;
          let accIncome = 0;
          let accExpense = 0;
          const months = (annual.months ?? []).map((month, index) => {
            const income = Number(month.income ?? 0);
            const expense = Number(month.expense ?? 0);
            const monthIndex = Number(month.month ?? index + 1) - 1;
            let balance = 0;
            if (monthIndex <= limitMonth) {
              accIncome += income;
              accExpense += expense;
              balance = saldoInicialTotal + accIncome - accExpense;
            }
            return {
              ...month,
              income,
              expense,
              balance
            };
          });
          const totalIncome = annual.totals?.totalIncome ?? 0;
          const totalExpense = annual.totals?.totalExpense ?? 0;
          return {
            ...annual,
            months,
            totals: {
              totalIncome,
              totalExpense,
              balance: saldoInicialTotal + (totalIncome - totalExpense)
            }
          } as AnnualReportResult;
        })
      )
    ),
    tap((report) => {
      this.lastAnnualReport = report;
      this.loadingAnnualReport = false;
    }),
    catchError(() => {
      this.loadingAnnualReport = false;
      this.lastAnnualReport = null;
      return of(null);
    })
  );

  creditReport$ = combineLatest([
    this.creditCards$,
    this.creditPurchases$,
    this.creditInstallments$,
    this.categories$,
    this.accounts$,
    this.creditFilters$
  ]).pipe(
    map(([cards, purchases, installments, categories, accounts, rawFilters]) => {
      const filters = this.normalizeCreditFilters(rawFilters);
      const range = this.buildMonthRange(filters.month, filters.year);
      const cardMap = new Map(cards.map((card) => [card.id || '', card]));
      const purchaseMap = new Map(purchases.map((purchase) => [purchase.id || '', purchase]));
      const categoryMap = new Map(categories.map((category) => [category.id || '', category]));
      const accountMap = new Map(accounts.map((account) => [account.id || '', account]));

      const selectedCardId = filters.cardId !== 'all' ? filters.cardId : null;
      const matchesCard = (inst: CreditInstallment) => {
        if (!selectedCardId) {
          return true;
        }
        if (inst.cardId === selectedCardId) {
          return true;
        }
        const purchase = purchaseMap.get(inst.purchaseId || '');
        return purchase?.cardId === selectedCardId;
      };

      const dueInstallments = installments.filter((inst) => {
        const dueDate = this.toJsDate((inst as any).dueDate ?? (inst as any).date);
        if (!dueDate) {
          return false;
        }
        return matchesCard(inst) && this.inRange(dueDate, range.start, range.end);
      });

      const paidInstallments = installments.filter((inst) => {
        const paidAt = this.toJsDate((inst as any).paidAt);
        if (!paidAt) {
          return false;
        }
        return matchesCard(inst) && this.inRange(paidAt, range.start, range.end);
      });

      const totalDue = this.sum(dueInstallments.map((inst) => Number(inst.amount ?? 0)));
      const totalPaid = this.sum(paidInstallments.map((inst) => Number(inst.amount ?? 0)));
      const countTotal = dueInstallments.length;
      const countPaid = dueInstallments.filter((inst) => inst.paid).length;
      const countPending = countTotal - countPaid;

      const summary: CreditSummary = {
        total: totalDue,
        paid: totalPaid,
        pending: totalDue - totalPaid,
        countTotal,
        countPaid,
        countPending
      };

      const dueByCard = new Map<string, CreditSummary>();
      const paidByCard = new Map<string, number>();

      dueInstallments.forEach((inst) => {
        const amount = Number(inst.amount ?? 0);
        const cardId = inst.cardId || purchaseMap.get(inst.purchaseId || '')?.cardId || '';
        if (!cardId) {
          return;
        }
        const current = dueByCard.get(cardId) ?? {
          total: 0,
          paid: 0,
          pending: 0,
          countTotal: 0,
          countPaid: 0,
          countPending: 0
        };
        current.total += amount;
        current.countTotal += 1;
        if (inst.paid) {
          current.countPaid += 1;
        } else {
          current.countPending += 1;
        }
        dueByCard.set(cardId, current);
      });

      paidInstallments.forEach((inst) => {
        const amount = Number(inst.amount ?? 0);
        const cardId = inst.cardId || purchaseMap.get(inst.purchaseId || '')?.cardId || '';
        if (!cardId) {
          return;
        }
        const current = paidByCard.get(cardId) ?? 0;
        paidByCard.set(cardId, current + amount);
      });

      const cardSummaries = Array.from(dueByCard.entries())
        .map(([cardId, cardSummary]) => {
          const paidTotal = paidByCard.get(cardId) ?? 0;
          return {
            cardId,
            cardName: cardMap.get(cardId)?.name || 'Cartao',
            summary: {
              ...cardSummary,
              paid: paidTotal,
              pending: cardSummary.total - paidTotal
            }
          };
        })
        .sort((a, b) => a.cardName.localeCompare(b.cardName));

      const statusMatches = (row: CreditBillRow) => {
        if (filters.status === 'paid') {
          return row.status === 'Pago';
        }
        if (filters.status === 'pending') {
          return row.status !== 'Pago';
        }
        return true;
      };

      const buildBillRow = (inst: CreditInstallment): CreditBillRow => {
        const purchase = purchaseMap.get(inst.purchaseId || '');
        const cardName = cardMap.get(inst.cardId)?.name || 'Cartao';
        const categoryName = purchase?.categoryId
          ? categoryMap.get(purchase.categoryId)?.name || '—'
          : '—';
        const installmentLabel = this.buildInstallmentLabel(inst, purchase);
        const dueDate = this.toYmd((inst as any).dueDate ?? (inst as any).date);
        const paidAt = inst.paidAt ? this.toYmd(inst.paidAt) : '';
        const accountId = inst.paymentAccountId || cardMap.get(inst.cardId || '')?.paymentAccountId || '';
        const accountName = accountMap.get(accountId || '')?.name || '—';
        const purchaseDate = purchase?.purchaseDate ? this.toYmd(purchase.purchaseDate) : '';
        return {
          dueDate,
          description: purchase?.description || 'Compra',
          categoryName,
          installmentLabel,
          amount: Number(inst.amount ?? 0),
          status: inst.paid ? 'Pago' : 'Pendente',
          paidAt: paidAt || undefined,
          accountName,
          cardName,
          purchaseId: inst.purchaseId || '',
          purchaseDate: purchaseDate || undefined
        } as CreditBillRow;
      };

      const billRowsAll = dueInstallments
        .map((inst) => buildBillRow(inst))
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

      const billRows = billRowsAll.filter((row) => statusMatches(row));

      const buildPaymentRow = (inst: CreditInstallment): CreditPaymentRow => {
        const purchase = purchaseMap.get(inst.purchaseId || '');
        const cardName = cardMap.get(inst.cardId)?.name || 'Cartao';
        const accountId = inst.paymentAccountId || cardMap.get(inst.cardId || '')?.paymentAccountId || '';
        const accountName = accountMap.get(accountId || '')?.name || '—';
        const paidAt = this.toYmd(inst.paidAt);
        const dueDate = this.toYmd((inst as any).dueDate ?? (inst as any).date);
        return {
          paidAt,
          dueDate: dueDate || undefined,
          amount: Number(inst.amount ?? 0),
          description: purchase?.description || 'Compra',
          installmentLabel: this.buildInstallmentLabel(inst, purchase),
          cardName,
          accountName,
          movementId: inst.paymentMovementId ?? '',
          purchaseId: inst.purchaseId || ''
        } as CreditPaymentRow;
      };

      const paymentRowsAll = paidInstallments
        .map((inst) => buildPaymentRow(inst))
        .sort((a, b) => (a.paidAt < b.paidAt ? -1 : 1));

      const paymentRows = filters.status === 'pending' ? [] : paymentRowsAll;

      const categoryTotals = new Map<string, number>();
      dueInstallments.forEach((inst) => {
        const purchase = purchaseMap.get(inst.purchaseId || '');
        const categoryId = purchase?.categoryId ?? '';
        const key = categoryId || 'uncategorized';
        categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + Number(inst.amount ?? 0));
      });

      const topCategories = Array.from(categoryTotals.entries())
        .map(([categoryId, total]) => ({
          categoryName: categoryId ? categoryMap.get(categoryId)?.name || '—' : '—',
          total,
          percent: totalDue > 0 ? (total / totalDue) * 100 : 0
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      const cardLabel = selectedCardId ? cardMap.get(selectedCardId)?.name || 'Cartao' : 'Todos';
      const periodLabel = `${String(filters.month).padStart(2, '0')}/${filters.year}`;
      const hasData = dueInstallments.length > 0 || paidInstallments.length > 0;

      return {
        periodLabel,
        cardLabel,
        summary,
        cardSummaries,
        billRows,
        billRowsAll,
        paymentRows,
        paymentRowsAll,
        topCategories,
        cardsCount: cards.length,
        hasData,
        filters
      } as CreditReportView;
    }),
    tap((report) => {
      this.lastCreditReport = report;
    })
  );

  applyFilters() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.warning('Preencha os campos obrigatórios.');
      return;
    }
    const { start, end } = this.form.value;
    const startDate = localDateFromYmd(start!);
    const endDate = localDateFromYmd(end!);
    if (!startDate || !endDate || startDate > endDate) {
      this.notifications.warning('Data inicial deve ser anterior a final.');
      return;
    }
    this.loadingReport = true;
    this.filters$.next({ start: start!, end: end! });
  }

  setViewMode(mode: 'default' | 'credit') {
    this.viewMode = mode;
  }

  applyCreditFilters() {
    if (this.creditForm.invalid) {
      this.creditForm.markAllAsTouched();
      this.notifications.warning('Preencha os filtros de cartão.');
      return;
    }

    const normalized = this.normalizeCreditFilters(this.creditForm.value);
    if (!normalized.month || !normalized.year) {
      this.notifications.warning('Informe mês e ano válidos.');
      return;
    }

    this.creditForm.patchValue(normalized, { emitEvent: false });
    this.creditFilters$.next(normalized);
  }

  resetCreditFilters() {
    const defaults = this.getDefaultCreditFilters();
    this.creditForm.reset(defaults, { emitEvent: false });
    this.creditFilters$.next(defaults);
  }

  setPeriodMode(mode: 'period' | 'annual') {
    this.periodMode = mode;
    if (mode === 'annual') {
      this.loadingAnnualReport = true;
      this.annualYear$.next(this.annualYear);
    }
  }

  changeAnnualYear() {
    this.loadingAnnualReport = true;
    this.annualYear$.next(this.annualYear);
  }

  async exportXlsx() {
    if (!this.lastReport || this.lastReport.transactions.length === 0) {
      this.notifications.info('Sem dados para exportar.');
      return;
    }
    this.exportingXlsx = true;
    try {
      const { start, end } = this.form.value;
      const filtrosTexto =
        start && end ? `Período: ${this.formatDate(start)} a ${this.formatDate(end)}` : undefined;
      const categories = await firstValueFrom(this.categories$);
      const accounts = await firstValueFrom(this.accounts$);
      const rows: LancamentoRelatorio[] = this.lastReport.transactions.map((t) => {
        const accountName = accounts.find((a) => a.id === t.accountId)?.name || '';
        const originName = accounts.find((a) => a.id === t.accountOriginId)?.name || '';
        const destinationName = accounts.find((a) => a.id === t.accountDestinationId)?.name || '';
        return {
          data: t.date,
          descricao: t.description,
          categoria: t.type === 'transfer' ? '-' : categories.find((c) => c.id === t.categoryId)?.name || '',
          contaOrigem: t.type === 'transfer' ? originName : accountName,
          destino: t.type === 'transfer' ? destinationName : '',
          tipo: t.type === 'income' ? 'entrada' : t.type === 'expense' ? 'saida' : 'transferencia',
          valor: t.amount
        };
      });
      const saldoInicialTotal = this.getSaldoInicialTotal(accounts);
      const yearMonth = start ? start.slice(0, 7) : this.buildCurrentYearMonth();
      const fileName = this.buildFileName('periodo', yearMonth);

      await this.reportExportService.exportRelatorioXlsx({
        titulo: 'Relat\u00f3rio',
        filtrosTexto,
        rows,
        saldoInicial: saldoInicialTotal,
        fileName
      });
      this.notifications.success('Salvo com sucesso');
    } catch (err: any) {
      this.notifications.error('N\u00e3o foi poss\u00edvel concluir. Tente novamente.');
    } finally {
      this.exportingXlsx = false;
    }
  }

  async exportCsv() {
    if (!this.lastReport || this.lastReport.transactions.length === 0) {
      this.notifications.info('Sem dados para exportar.');
      return;
    }
    this.exportingCsv = true;
    try {
      const categories = await firstValueFrom(this.categories$);
      const accounts = await firstValueFrom(this.accounts$);
      const rows: LancamentoRelatorioCsv[] = this.lastReport.transactions.map((t) => {
        const accountName = accounts.find((a) => a.id === t.accountId)?.name || '';
        const originName = accounts.find((a) => a.id === t.accountOriginId)?.name || '';
        const destinationName = accounts.find((a) => a.id === t.accountDestinationId)?.name || '';
        return {
          data: t.date,
          tipo: t.type === 'income' ? 'entrada' : t.type === 'expense' ? 'saida' : 'transferencia',
          descricao: t.description,
          categoria: t.type === 'transfer' ? '-' : categories.find((c) => c.id === t.categoryId)?.name || '',
          contaOrigem: t.type === 'transfer' ? originName : accountName,
          destino: t.type === 'transfer' ? destinationName : '',
          valor: t.amount
        };
      });
      const yearMonth = this.form.value.start ? this.form.value.start.slice(0, 7) : this.buildCurrentYearMonth();
      const fileName = this.buildFileName('período', yearMonth);
      this.reportExportService.exportRelatorioCsv({ rows, fileName });
      this.notifications.success('Salvo com sucesso');
    } catch (err: any) {
      this.notifications.error('N\u00e3o foi poss\u00edvel concluir. Tente novamente.');
    } finally {
      this.exportingCsv = false;
    }
  }

  async exportAnnualCsv() {
    if (!this.lastAnnualReport || !this.lastAnnualReport.hasData) {
      this.notifications.info('Sem dados para exportar.');
      return;
    }
    this.exportingAnnualCsv = true;
    try {
      const user = await firstValueFrom(this.auth.user$);
      if (!user) {
        this.notifications.info('Sem dados para exportar.');
        return;
      }
      const categories = await firstValueFrom(this.categories$);
      const accounts = await firstValueFrom(this.accounts$);
      const startDate = new Date(this.annualYear, 0, 1);
      const endDate = new Date(this.annualYear, 11, 31);
      const report = await firstValueFrom(this.reportsService.getReport(user.uid, startDate, endDate));
      if (!report || report.transactions.length === 0) {
        this.notifications.info('Sem dados para exportar.');
        return;
      }
      const rows: LancamentoRelatorioCsvAnual[] = report.transactions.map((t) => {
        const accountName = accounts.find((a) => a.id === t.accountId)?.name || '';
        const originName = accounts.find((a) => a.id === t.accountOriginId)?.name || '';
        const destinationName = accounts.find((a) => a.id === t.accountDestinationId)?.name || '';
        const anoMes = this.buildYearMonth(t.date);
        return {
          anoMes,
          data: t.date,
          tipo: t.type === 'income' ? 'entrada' : t.type === 'expense' ? 'saida' : 'transferencia',
          descricao: t.description,
          categoria: t.type === 'transfer' ? '-' : categories.find((c) => c.id === t.categoryId)?.name || '',
          contaOrigem: t.type === 'transfer' ? originName : accountName,
          destino: t.type === 'transfer' ? destinationName : '',
          valor: t.amount
        };
      });
      const fileName = this.buildFileName('anual', `${this.annualYear}`);
      this.reportExportService.exportRelatorioAnualCsv({ rows, fileName });
      this.notifications.success('Salvo com sucesso');
    } catch (err: any) {
      this.notifications.error('N\u00e3o foi poss\u00edvel concluir. Tente novamente.');
    } finally {
      this.exportingAnnualCsv = false;
    }
  }

  async exportAnnualXlsx() {
    if (!this.lastAnnualReport || !this.lastAnnualReport.hasData) {
      this.notifications.info('Sem dados para exportar.');
      return;
    }
    this.exportingAnnualXlsx = true;
    try {
      const user = await firstValueFrom(this.auth.user$);
      if (!user) {
        this.notifications.info('Sem dados para exportar.');
        return;
      }
      const categories = await firstValueFrom(this.categories$);
      const accounts = await firstValueFrom(this.accounts$);
      const saldoInicialTotal = this.getSaldoInicialTotal(accounts);
      const startDate = new Date(this.annualYear, 0, 1);
      const endDate = new Date(this.annualYear, 11, 31);
      const report = await firstValueFrom(this.reportsService.getReport(user.uid, startDate, endDate));
      if (!report || report.transactions.length === 0) {
        this.notifications.info('Sem dados para exportar.');
        return;
      }
      const rows: LancamentoRelatorio[] = report.transactions.map((t) => {
        const accountName = accounts.find((a) => a.id === t.accountId)?.name || '';
        const originName = accounts.find((a) => a.id === t.accountOriginId)?.name || '';
        const destinationName = accounts.find((a) => a.id === t.accountDestinationId)?.name || '';
        return {
          data: t.date,
          descricao: t.description,
          categoria: t.type === 'transfer' ? '-' : categories.find((c) => c.id === t.categoryId)?.name || '',
          contaOrigem: t.type === 'transfer' ? originName : accountName,
          destino: t.type === 'transfer' ? destinationName : '',
          tipo: t.type === 'income' ? 'entrada' : t.type === 'expense' ? 'saida' : 'transferencia',
          valor: t.amount
        };
      });
      const fileName = this.buildFileName('anual', `${this.annualYear}`);
      await this.reportExportService.exportRelatorioAnualXlsx({
        titulo: 'Relat\u00f3rio anual',
        rows,
        year: this.annualYear,
        saldoInicial: saldoInicialTotal,
        fileName
      });
      this.notifications.success('Salvo com sucesso');
    } catch (err: any) {
      this.notifications.error('N\u00e3o foi poss\u00edvel concluir. Tente novamente.');
    } finally {
      this.exportingAnnualXlsx = false;
    }
  }

  async exportCreditCsv() {
    if (!this.lastCreditReport || !this.lastCreditReport.hasData) {
      this.notifications.info('Sem dados para exportar.');
      return;
    }
    this.exportingCreditCsv = true;
    try {
      const report = this.lastCreditReport;
      const yearMonth = this.buildYearMonthFromMonth(report.filters.month, report.filters.year);
      if (report.filters.view === 'payment') {
        const headers = ['Data do pagamento', 'Valor', 'Cartão', 'Compra', 'Parcela', 'Conta'];
        const rows = report.paymentRows.map((row) => [
          this.formatDateShort(row.paidAt),
          this.formatCsvNumber(row.amount),
          row.cardName,
          row.description,
          row.installmentLabel,
          row.accountName
        ]);
        this.exportCsvCustom(headers, rows, this.buildFileName('cartao_pagamentos', yearMonth));
      } else {
        const headers = [
          'Cartão',
          'Compra',
          'Categoria',
          'Parcela',
          'Vencimento',
          'Valor',
          'Status',
          'Pago em',
          'Conta'
        ];
        const rows = report.billRows.map((row) => [
          row.cardName,
          row.description,
          row.categoryName,
          row.installmentLabel,
          this.formatDateShort(row.dueDate),
          this.formatCsvNumber(row.amount),
          row.status,
          row.paidAt ? this.formatDateShort(row.paidAt) : '',
          row.accountName
        ]);
        this.exportCsvCustom(headers, rows, this.buildFileName('cartao_fatura', yearMonth));
      }
      this.notifications.success('Salvo com sucesso');
    } catch (err: any) {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      this.exportingCreditCsv = false;
    }
  }

  async exportCreditExcel() {
    if (!this.lastCreditReport || !this.lastCreditReport.hasData) {
      this.notifications.info('Sem dados para exportar.');
      return;
    }
    this.exportingCreditXlsx = true;
    try {
      const report = this.lastCreditReport;
      const yearMonth = this.buildYearMonthFromMonth(report.filters.month, report.filters.year);
      const dash = '—';
      const billRowsAll = report.billRowsAll ?? report.billRows;
      const paymentRowsAll = report.paymentRowsAll ?? report.paymentRows;

      const formatCurrency = (value: number) => {
        if (!Number.isFinite(value)) {
          return dash;
        }
        return `R$ ${Number(value).toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })}`;
      };

      const formatPercent = (value: number) => {
        if (!Number.isFinite(value)) {
          return dash;
        }
        return `${Number(value).toLocaleString('pt-BR', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1
        })}%`;
      };

      const formatDateValue = (ymd?: string) => {
        const formatted = ymd ? this.formatDate(ymd) : '';
        return formatted || dash;
      };

      const minMaxYmd = <T>(rows: T[], getYmd: (row: T) => string | undefined) => {
        let minDate: Date | null = null;
        let maxDate: Date | null = null;
        let minYmd = '';
        let maxYmd = '';
        rows.forEach((row) => {
          const ymd = getYmd(row);
          if (!ymd) {
            return;
          }
          const date = localDateFromYmd(ymd);
          if (!date) {
            return;
          }
          if (!minDate || date < minDate) {
            minDate = date;
            minYmd = ymd;
          }
          if (!maxDate || date > maxDate) {
            maxDate = date;
            maxYmd = ymd;
          }
        });
        return { minYmd, maxYmd };
      };

      const buildPurchaseKey = (row: CreditBillRow) =>
        row.purchaseId || `${row.cardName}::${row.description}::${row.categoryName}`;

      type PurchaseSummary = {
        cardName: string;
        description: string;
        categoryName: string;
        total: number;
        paidTotal: number;
        countTotal: number;
        countPaid: number;
        firstDue?: string;
        lastDue?: string;
      };

      const purchaseSummary = new Map<string, PurchaseSummary>();

      billRowsAll.forEach((row) => {
        const key = buildPurchaseKey(row);
        const current =
          purchaseSummary.get(key) ??
          {
            cardName: row.cardName || dash,
            description: row.description || dash,
            categoryName: row.categoryName || dash,
            total: 0,
            paidTotal: 0,
            countTotal: 0,
            countPaid: 0,
            firstDue: row.dueDate,
            lastDue: row.dueDate
          };

        current.total += Number(row.amount ?? 0);
        current.countTotal += 1;
        if (row.status === 'Pago') {
          current.paidTotal += Number(row.amount ?? 0);
          current.countPaid += 1;
        }

        const dueDate = row.dueDate;
        if (dueDate) {
          const due = localDateFromYmd(dueDate);
          if (due) {
            const first = current.firstDue ? localDateFromYmd(current.firstDue) : null;
            const last = current.lastDue ? localDateFromYmd(current.lastDue) : null;
            if (!first || due < first) {
              current.firstDue = dueDate;
            }
            if (!last || due > last) {
              current.lastDue = dueDate;
            }
          }
        }

        purchaseSummary.set(key, current);
      });

      const { minYmd: firstDueYmd, maxYmd: lastDueYmd } = minMaxYmd(
        billRowsAll,
        (row) => row.dueDate
      );
      const { minYmd: firstPaidYmd, maxYmd: lastPaidYmd } = minMaxYmd(
        paymentRowsAll,
        (row) => row.paidAt
      );

      const paidInstallmentsCount = paymentRowsAll.length;

      const ticketMedio =
        report.summary.countTotal > 0 ? report.summary.total / report.summary.countTotal : null;
      const valorMedioPago = paidInstallmentsCount > 0 ? report.summary.paid / paidInstallmentsCount : null;

      const accountTotals = new Map<string, number>();
      paymentRowsAll.forEach((row) => {
        const name = row.accountName || dash;
        accountTotals.set(name, (accountTotals.get(name) ?? 0) + row.amount);
      });

      const sortedAccounts = Array.from(accountTotals.entries()).sort((a, b) => b[1] - a[1]);
      const topAccounts = sortedAccounts.slice(0, 3).map(([name, total]) => ({ name, total }));
      while (topAccounts.length < 3) {
        topAccounts.push({ name: dash, total: Number.NaN });
      }
      const mostUsedAccount = sortedAccounts.length
        ? { name: sortedAccounts[0][0], total: sortedAccounts[0][1] }
        : { name: dash, total: Number.NaN };

      const topCategories = report.topCategories.map((row) => ({
        name: row.categoryName || dash,
        total: row.total,
        percent: row.percent
      }));
      while (topCategories.length < 5) {
        topCategories.push({ name: dash, total: Number.NaN, percent: Number.NaN });
      }

      const normalizeValue = (value: string | number | null | undefined) => {
        if (value === null || value === undefined || value === '') {
          return dash;
        }
        if (typeof value === 'number' && !Number.isFinite(value)) {
          return dash;
        }
        return value;
      };

      const formatCategoryObservation = (total: number, percent: number) => {
        if (!Number.isFinite(total) || !Number.isFinite(percent)) {
          return dash;
        }
        return `${formatCurrency(total)} (${formatPercent(percent)})`;
      };

      const summaryRows: Array<Array<string | number>> = [];
      const addSummaryRow = (
        group: string,
        metric: string,
        value: string | number | null | undefined,
        observation?: string | number | null
      ) => {
        summaryRows.push([
          group,
          metric,
          normalizeValue(value),
          normalizeValue(observation ?? dash)
        ]);
      };
      const addSpacer = () => {
        summaryRows.push(['', '', '', '']);
      };

      addSummaryRow('Período', 'Período', report.periodLabel || dash);
      addSummaryRow('Período', 'Cartão selecionado', report.cardLabel || dash);
      addSpacer();

      addSummaryRow('Totais do Cartão', 'Total gasto no período', formatCurrency(report.summary.total));
      addSummaryRow('Totais do Cartão', 'Total pago no período', formatCurrency(report.summary.paid));
      addSummaryRow('Totais do Cartão', 'Total pendente no período', formatCurrency(report.summary.pending));
      addSpacer();

      addSummaryRow('Parcelas', 'Parcelas totais', report.summary.countTotal);
      addSummaryRow('Parcelas', 'Parcelas pagas', report.summary.countPaid);
      addSummaryRow('Parcelas', 'Parcelas pendentes', report.summary.countPending);
      addSummaryRow('Parcelas', 'Ticket médio da parcela', formatCurrency(ticketMedio ?? Number.NaN));
      addSummaryRow('Parcelas', 'Valor médio pago', formatCurrency(valorMedioPago ?? Number.NaN));
      addSpacer();

      addSummaryRow('Datas', 'Primeiro vencimento do período', formatDateValue(firstDueYmd));
      addSummaryRow('Datas', 'Último vencimento do período', formatDateValue(lastDueYmd));
      addSummaryRow('Datas', 'Primeiro pagamento do período', formatDateValue(firstPaidYmd));
      addSummaryRow('Datas', 'Último pagamento do período', formatDateValue(lastPaidYmd));
      addSpacer();

      addSummaryRow('Fatura', 'Total da fatura no período', formatCurrency(report.summary.total));
      addSummaryRow(
        'Fatura',
        '% quitada',
        report.summary.total > 0 ? formatPercent((report.summary.paid / report.summary.total) * 100) : dash
      );
      addSummaryRow(
        'Fatura',
        '% pendente',
        report.summary.total > 0 ? formatPercent((report.summary.pending / report.summary.total) * 100) : dash
      );
      addSpacer();

      addSummaryRow(
        'Contas vinculadas',
        'Conta mais utilizada',
        mostUsedAccount.name,
        formatCurrency(mostUsedAccount.total)
      );
      addSummaryRow(
        'Contas vinculadas',
        'Total debitado (Top 1)',
        topAccounts[0].name,
        formatCurrency(topAccounts[0].total)
      );
      addSummaryRow(
        'Contas vinculadas',
        'Total debitado (Top 2)',
        topAccounts[1].name,
        formatCurrency(topAccounts[1].total)
      );
      addSummaryRow(
        'Contas vinculadas',
        'Total debitado (Top 3)',
        topAccounts[2].name,
        formatCurrency(topAccounts[2].total)
      );
      addSpacer();

      addSummaryRow(
        'Categorias',
        'Top 1',
        topCategories[0].name,
        formatCategoryObservation(topCategories[0].total, topCategories[0].percent)
      );
      addSummaryRow(
        'Categorias',
        'Top 2',
        topCategories[1].name,
        formatCategoryObservation(topCategories[1].total, topCategories[1].percent)
      );
      addSummaryRow(
        'Categorias',
        'Top 3',
        topCategories[2].name,
        formatCategoryObservation(topCategories[2].total, topCategories[2].percent)
      );
      addSummaryRow(
        'Categorias',
        'Top 4',
        topCategories[3].name,
        formatCategoryObservation(topCategories[3].total, topCategories[3].percent)
      );
      addSummaryRow(
        'Categorias',
        'Top 5',
        topCategories[4].name,
        formatCategoryObservation(topCategories[4].total, topCategories[4].percent)
      );

      const billRows = report.billRows.map((row) => {
        const key = buildPurchaseKey(row);
        const summary = purchaseSummary.get(key);
        const status =
          summary?.countPaid === 0
            ? 'Pendente'
            : summary && summary.countPaid === summary.countTotal
              ? 'Quitada no período'
              : summary
                ? 'Parcial'
                : dash;
        const purchaseTotal = summary ? summary.total : dash;
        return [
          row.cardName,
          row.description,
          row.categoryName,
          row.installmentLabel,
          formatDateValue(row.dueDate),
          row.amount,
          row.status,
          formatDateValue(row.paidAt),
          row.accountName || dash,
          purchaseTotal,
          status,
          formatDateValue(row.purchaseDate),
          row.accountName || dash
        ];
      });

      const paymentRows = report.paymentRows.map((row) => {
        const paidDate = row.paidAt ? localDateFromYmd(row.paidAt) : null;
        const dueDate = row.dueDate ? localDateFromYmd(row.dueDate) : null;
        const isEarly = paidDate && dueDate ? paidDate < dueDate : false;
        const type = paidDate && dueDate ? (isEarly ? 'Adiantamento' : 'Pagamento') : 'Pagamento';
        const paidBefore = paidDate && dueDate ? (isEarly ? 'Sim' : 'Não') : dash;
        const daysDiff =
          paidDate && dueDate ? Math.round((dueDate.getTime() - paidDate.getTime()) / 86400000) : null;

        return [
          formatDateValue(row.paidAt),
          row.amount,
          row.cardName,
          row.description,
          row.installmentLabel,
          row.accountName || dash,
          row.movementId || '',
          type,
          paidBefore,
          daysDiff ?? dash
        ];
      });

      const purchaseRows = Array.from(purchaseSummary.values())
        .sort((a, b) => a.cardName.localeCompare(b.cardName) || a.description.localeCompare(b.description))
        .map((item) => [
          item.cardName || dash,
          item.description || dash,
          item.categoryName || dash,
          item.total,
          item.paidTotal,
          item.total - item.paidTotal,
          item.countTotal > 0 ? `${item.countPaid}/${item.countTotal}` : dash,
          formatDateValue(item.firstDue),
          formatDateValue(item.lastDue),
          item.total - item.paidTotal <= 0 ? 'Quitada' : 'Em aberto'
        ]);

      const categoryRows = report.topCategories.map((row) => [
        row.categoryName,
        row.total,
        report.summary.total > 0 ? row.percent / 100 : 0
      ]);

      await this.reportExportService.exportRelatorioCartaoXlsx({
        fileName: this.buildFileName('cartao', yearMonth),
        sheets: [
          {
            name: 'Resumo',
            headers: ['Grupo', 'Métrica', 'Valor', 'Observação'],
            rows: summaryRows,
            columnWidths: [20, 36, 22, 28]
          },
          {
            name: 'Fatura (Vencimentos)',
            headers: [
              'Cartão',
              'Compra/Descrição',
              'Categoria',
              'Parcela',
              'Vencimento',
              'Valor',
              'Status',
              'Pago em',
              'Conta',
              'Valor acumulado da compra',
              'Situação da compra',
              'Data de compra',
              'Conta debitada'
            ],
            rows: billRows,
            columnFormats: { 6: '"R$" #,##0.00', 10: '"R$" #,##0.00' }
          },
          {
            name: 'Pagamentos (Adiantamentos)',
            headers: [
              'Data do pagamento',
              'Valor',
              'Cartão',
              'Compra/Descrição',
              'Parcela',
              'Conta debitada',
              'ID do movimento',
              'Tipo de pagamento',
              'Pago antes do vencimento',
              'Dias de antecipação'
            ],
            rows: paymentRows,
            columnFormats: { 2: '"R$" #,##0.00' }
          },
          {
            name: 'Compras (Resumo)',
            headers: [
              'Cartão',
              'Compra/Descrição',
              'Categoria',
              'Total da compra',
              'Total pago',
              'Total pendente',
              'Parcelas (pagas/total)',
              'Primeiro vencimento',
              'Último vencimento',
              'Status geral'
            ],
            rows: purchaseRows,
            columnFormats: { 4: '"R$" #,##0.00', 5: '"R$" #,##0.00', 6: '"R$" #,##0.00' }
          },
          {
            name: 'Categorias',
            headers: ['Categoria', 'Total', '% do total'],
            rows: categoryRows,
            columnFormats: { 2: '"R$" #,##0.00', 3: '0%' }
          }
        ]
      });
      this.notifications.success('Salvo com sucesso');
    } catch (err: any) {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      this.exportingCreditXlsx = false;
    }
  }

  private normalizeCreditFilters(raw: any): CreditFilters {
    const month = Number(raw?.month ?? this.currentMonth);
    const year = Number(raw?.year ?? this.currentYear);
    const cardId = typeof raw?.cardId === 'string' ? raw.cardId : 'all';
    const status: CreditStatusFilter =
      raw?.status === 'paid' || raw?.status === 'pending' ? raw.status : 'all';
    const view: CreditViewFilter = raw?.view === 'payment' ? 'payment' : 'due';

    return {
      month: Number.isFinite(month) ? Math.min(Math.max(month, 1), 12) : this.currentMonth,
      year: Number.isFinite(year) ? year : this.currentYear,
      cardId,
      status,
      view
    };
  }

  private getDefaultCreditFilters(): CreditFilters {
    return {
      month: this.currentMonth,
      year: this.currentYear,
      cardId: 'all',
      status: 'all',
      view: 'due'
    };
  }

  private buildMonthRange(month: number, year: number) {
    const safeMonth = Math.min(Math.max(month, 1), 12);
    const safeYear = Number.isFinite(year) ? year : this.currentYear;
    const start = new Date(safeYear, safeMonth - 1, 1, 0, 0, 0, 0);
    const end = new Date(safeYear, safeMonth, 0, 23, 59, 59, 999);
    return { start, end };
  }

  private buildYearMonthFromMonth(month: number, year: number) {
    const mm = String(Math.min(Math.max(month, 1), 12)).padStart(2, '0');
    return `${year}-${mm}`;
  }

  private parseLocalYmd(value: string): Date | null {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }
    return new Date(year, month, day, 12, 0, 0, 0);
  }

  private toJsDate(value: any): Date | null {
    if (!value) return null;
    if (value?.toDate && typeof value.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === 'string') {
      const local = this.parseLocalYmd(value);
      if (local) return local;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  private toYmd(value: any): string {
    const d = this.toJsDate(value);
    return d ? toYmdFromLocalDate(d) : '';
  }

  private inRange(date: Date, start: Date, end: Date): boolean {
    return date >= start && date <= end;
  }

  private sum(values: number[]): number {
    return (values ?? []).reduce((acc, value) => acc + (Number(value) || 0), 0);
  }

  private buildInstallmentLabel(inst: CreditInstallment, purchase?: CreditPurchase | null): string {
    const number = Number(inst.installmentNumber ?? 0);
    const total = Number(purchase?.installmentsCount ?? 0);
    if (number > 0 && total > 0) {
      return `${number}/${total}`;
    }
    if (number > 0) {
      return `${number}`;
    }
    return '—';
  }

  private exportCsvCustom(
    headers: string[],
    rows: Array<Array<string | number>>,
    fileName: string
  ) {
    const csv = this.buildCsv(headers, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const safeName = fileName.replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '_');
    const finalName = safeName.toLowerCase().endsWith('.csv') ? safeName : `${safeName}.csv`;
    saveAs(blob, finalName);
  }

  private buildCsv(headers: string[], rows: Array<Array<string | number>>, delimiter = ';') {
    const bom = '\uFEFF';
    const lines = rows.map((row) => row.map((value) => this.escapeCsv(value, delimiter)).join(delimiter));
    return `${bom}${[headers.join(delimiter), ...lines].join('\n')}`;
  }

  private escapeCsv(value: string | number, delimiter = ';') {
    const str = `${value ?? ''}`;
    if (str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/\"/g, '""')}"`;
    }
    return str;
  }

  private formatCsvNumber(value: number) {
    if (!Number.isFinite(value)) {
      return '0.00';
    }
    return Number(value).toFixed(2);
  }

  private buildYearMonth(value: string) {
    if (!value) {
      return '';
    }
    if (value.length >= 7) {
      return value.slice(0, 7);
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${date.getFullYear()}-${month}`;
  }

  private buildFileName(type: string, yearMonth: string) {
    const exportDate = toYmdFromLocalDate(new Date()).replace(/-/g, '');
    return `relatorio_${type}_${yearMonth}_${exportDate}`;
  }

  private buildCurrentYearMonth() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-${month}`;
  }

  formatDate(ymd: string): string {
    return formatPtBrFromYmd(ymd);
  }

  formatDateShort(ymd: string): string {
    const d = localDateFromYmd(ymd);
    if (!d) {
      return '';
    }
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(d);
  }

  private getSaldoInicialTotal(accounts: Account[]): number {
    return (accounts ?? []).reduce((sum, account) => sum + (Number(account?.initialBalance) || 0), 0);
  }
}
