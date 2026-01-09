import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject, catchError, combineLatest, firstValueFrom, map, of, switchMap, tap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ReportsService } from '../../core/services/reports.service';
import { CategoriesService } from '../../core/services/categories.service';
import { AccountsService } from '../../core/services/accounts.service';
import { Account } from '../../core/models/account.model';
import { AnnualReportResult, ReportResult } from '../../core/models/report.model';
import { formatPtBrFromYmd, localDateFromYmd, toYmdFromLocalDate } from '../../shared/utils/date.util';
import {
  LancamentoRelatorio,
  LancamentoRelatorioCsv,
  LancamentoRelatorioCsvAnual,
  ReportExportService
} from '../../services/report-export.service';
import { NotificationService } from '../../core/services/notification.service';

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
  readonly skeletonCards = Array.from({ length: 3 });
  readonly skeletonRows = Array.from({ length: 4 });
  readonly monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  viewMode: 'period' | 'annual' = 'period';
  annualYear = new Date().getFullYear();
  annualYears = Array.from({ length: 6 }).map((_, i) => this.annualYear - 2 + i);

  form = this.fb.group({
    start: [toYmdFromLocalDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), Validators.required],
    end: [toYmdFromLocalDate(new Date()), Validators.required]
  });

  private filters$ = new BehaviorSubject<{ start: string; end: string }>({
    start: this.form.value.start || toYmdFromLocalDate(new Date()),
    end: this.form.value.end || toYmdFromLocalDate(new Date())
  });
  private annualYear$ = new BehaviorSubject<number>(this.annualYear);

  categories$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.categoriesService.list$(user.uid) : of([])))
  );

  accounts$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.accountsService.list$(user.uid) : of([]))),
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
      combineLatest([of(report), this.categories$]).pipe(
        map(([rep, categories]) => {
          if (!rep) {
            return null;
          }
          const byCategory = rep.byCategory.map((item) => ({
            ...item,
            categoryName: categories.find((c) => c.id === item.categoryId)?.name || 'Categoria'
          }));
          return { ...rep, byCategory } as ReportResult;
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
          const totalIncome = annual.totals?.totalIncome ?? 0;
          const totalExpense = annual.totals?.totalExpense ?? 0;
          return {
            ...annual,
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

  setViewMode(mode: 'period' | 'annual') {
    this.viewMode = mode;
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























