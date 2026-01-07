import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject, catchError, combineLatest, map, of, switchMap, tap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ReportsService } from '../../core/services/reports.service';
import { CategoriesService } from '../../core/services/categories.service';
import { ReportResult } from '../../core/models/report.model';
import { formatPtBrFromYmd, localDateFromYmd, toYmdFromLocalDate } from '../../shared/utils/date.util';
import { LancamentoRelatorio, ReportExportService } from '../../services/report-export.service';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.css'
})
export class ReportsComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private reportsService = inject(ReportsService);
  private categoriesService = inject(CategoriesService);
  private reportExportService = inject(ReportExportService);

  message = '';
  lastReport: ReportResult | null = null;

  form = this.fb.group({
    start: [toYmdFromLocalDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), Validators.required],
    end: [toYmdFromLocalDate(new Date()), Validators.required]
  });

  private filters$ = new BehaviorSubject<{ start: string; end: string }>({
    start: this.form.value.start || toYmdFromLocalDate(new Date()),
    end: this.form.value.end || toYmdFromLocalDate(new Date())
  });

  categories$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.categoriesService.list$(user.uid) : of([])))
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
    catchError(() => of(null)),
    tap((report) => (this.lastReport = report))
  );

  applyFilters() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { start, end } = this.form.value;
    const startDate = localDateFromYmd(start!);
    const endDate = localDateFromYmd(end!);
    if (!startDate || !endDate || startDate > endDate) {
      this.message = 'Data inicial deve ser anterior a final.';
      return;
    }
    this.message = '';
    this.filters$.next({ start: start!, end: end! });
  }

  async exportXlsx() {
    if (!this.lastReport) {
      return;
    }
    const { start, end } = this.form.value;
    const filtrosTexto =
      start && end ? `Periodo: ${this.formatDate(start)} a ${this.formatDate(end)}` : undefined;
    const rows: LancamentoRelatorio[] = this.lastReport.transactions.map((t) => ({
      data: t.date,
      descricao: t.description,
      categoria:
        this.lastReport?.byCategory.find((c) => c.categoryId === t.categoryId)?.categoryName ||
        '',
      tipo: t.type === 'income' ? 'entrada' : 'saida',
      valor: t.amount
    }));

    await this.reportExportService.exportRelatorioXlsx({
      titulo: 'Relatorio',
      filtrosTexto,
      rows
    });
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
}
