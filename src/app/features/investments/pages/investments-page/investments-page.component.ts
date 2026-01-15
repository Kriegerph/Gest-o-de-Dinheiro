import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, combineLatest, firstValueFrom, map, of, switchMap, tap } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { InvestmentsService } from '../../services/investments.service';
import {
  IndexContext,
  InvestmentCalculation,
  InvestmentSummary,
  InvestmentsCalculatorService
} from '../../services/investments-calculator.service';
import { IndicesService } from '../../services/indices.service';
import {
  Investment,
  InvestmentStatus,
  InvestmentYieldMode,
  InvestmentType
} from '../../models/investment.model';
import { NotificationService } from '../../../../core/services/notification.service';
import { formatPtBrFromYmd, toYmdFromLocalDate } from '../../../../shared/utils/date.util';

type InvestmentView = Investment &
  InvestmentCalculation & {
    typeLabel: string;
    statusLabel: string;
    updatedLabel: string;
  };

type InvestmentsPageView = {
  summary: InvestmentSummary & { updatedLabel: string };
  items: InvestmentView[];
};

@Component({
  selector: 'app-investments-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './investments-page.component.html',
  styleUrl: './investments-page.component.css'
})
export class InvestmentsPageComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private investmentsService = inject(InvestmentsService);
  private indicesService = inject(IndicesService);
  private calculator = inject(InvestmentsCalculatorService);
  private notifications = inject(NotificationService);

  readonly todayYmd = toYmdFromLocalDate(new Date());
  readonly skeletonRows = Array.from({ length: 4 });

  editingId: string | null = null;
  saving = false;
  togglingId: string | null = null;
  loadingInvestments = true;

  readonly typeOptions = [
    { value: 'savings', label: 'Poupanca' },
    { value: 'cdb', label: 'CDB' },
    { value: 'treasury_selic', label: 'Tesouro Selic' },
    { value: 'manual', label: 'Manual' }
  ] as const;

  readonly yieldOptions = [
    { value: 'manual_monthly', label: 'Manual (a.m.)' },
    { value: 'manual_yearly', label: 'Manual (a.a.)' },
    { value: 'cdi_percent', label: '% do CDI' },
    { value: 'selic', label: 'Selic' }
  ] as const;

  readonly statusOptions = [
    { value: 'active', label: 'Ativo' },
    { value: 'inactive', label: 'Inativo' }
  ] as const;

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    type: ['savings', Validators.required],
    realStartDate: [this.todayYmd, Validators.required],
    status: ['active', Validators.required],
    hadBeforeApp: [false],
    systemStartDate: [this.todayYmd],
    currentValueAtOnboarding: [null as number | null],
    totalInvestedToDate: [null as number | null],
    preAppYield: [null as number | null],
    principalBase: [0, [Validators.min(0)]],
    yieldMode: ['manual_monthly', Validators.required],
    manualRate: [0],
    cdiPercent: [100],
    compounding: ['monthly']
  });

  private latestCdi$ = this.indicesService.latest$('cdi');
  private latestSelic$ = this.indicesService.latest$('selic');

  investments$ = this.auth.user$.pipe(
    tap(() => (this.loadingInvestments = true)),
    switchMap((user) => (user ? this.investmentsService.list$(user.uid) : of([]))),
    map((items) => items ?? []),
    catchError(() => of([]))
  );

  view$ = combineLatest([this.investments$, this.latestCdi$, this.latestSelic$]).pipe(
    map(([investments, cdi, selic]) => this.buildView(investments, { cdi, selic })),
    tap(() => (this.loadingInvestments = false)),
    catchError(() => {
      this.loadingInvestments = false;
      return of(this.emptyView());
    })
  );

  get isBeforeApp() {
    return Boolean(this.form.get('hadBeforeApp')?.value);
  }

  get yieldMode() {
    return this.form.get('yieldMode')?.value as InvestmentYieldMode;
  }

  get isManualMode() {
    return this.yieldMode === 'manual_monthly' || this.yieldMode === 'manual_yearly';
  }

  get isIndexMode() {
    return this.yieldMode === 'cdi_percent' || this.yieldMode === 'selic';
  }

  get manualRateLabel() {
    return this.yieldMode === 'manual_yearly' ? 'Taxa a.a. (%)' : 'Taxa a.m. (%)';
  }

  trackById(_: number, item: Investment) {
    return item.id;
  }

  onBeforeAppToggle() {
    if (this.isBeforeApp) {
      if (!this.form.get('systemStartDate')?.value) {
        this.form.patchValue({ systemStartDate: this.todayYmd });
      }
    } else {
      this.form.patchValue({
        systemStartDate: this.form.get('realStartDate')?.value || this.todayYmd,
        currentValueAtOnboarding: null,
        totalInvestedToDate: null,
        preAppYield: null
      });
    }
  }

  onYieldModeChange() {
    this.form.patchValue({ compounding: this.isIndexMode ? 'daily' : 'monthly' });
  }

  edit(investment: Investment) {
    const currentValue =
      investment.currentValueAtOnboarding ??
      Number(investment.principalBase ?? 0) + Number(investment.preAppYield ?? 0);
    this.editingId = investment.id || null;
    this.form.patchValue({
      name: investment.name,
      type: investment.type,
      realStartDate: investment.realStartDate,
      status: investment.status,
      hadBeforeApp: investment.hadBeforeApp,
      systemStartDate: investment.systemStartDate,
      currentValueAtOnboarding: currentValue,
      totalInvestedToDate: investment.totalInvestedToDate ?? null,
      preAppYield: investment.preAppYield ?? null,
      principalBase: investment.principalBase ?? 0,
      yieldMode: investment.yieldMode,
      manualRate: investment.manualRate ?? 0,
      cdiPercent: investment.cdiPercent ?? 100,
      compounding:
        investment.compounding ??
        (investment.yieldMode === 'cdi_percent' || investment.yieldMode === 'selic'
          ? 'daily'
          : 'monthly')
    });
  }

  resetForm() {
    this.editingId = null;
    this.form.reset({
      name: '',
      type: 'savings',
      realStartDate: this.todayYmd,
      status: 'active',
      hadBeforeApp: false,
      systemStartDate: this.todayYmd,
      currentValueAtOnboarding: null,
      totalInvestedToDate: null,
      preAppYield: null,
      principalBase: 0,
      yieldMode: 'manual_monthly',
      manualRate: 0,
      cdiPercent: 100,
      compounding: 'monthly'
    });
  }

  async save() {
    const validationMessage = this.validateForm();
    if (validationMessage) {
      this.notifications.warning(validationMessage);
      return;
    }
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;

    const payload = this.buildPayload();
    this.saving = true;
    try {
      if (this.editingId) {
        await this.investmentsService.update(user.uid, this.editingId, payload);
      } else {
        await this.investmentsService.add(user.uid, payload);
      }
      this.notifications.success('Salvo com sucesso.');
      this.resetForm();
    } catch (err: any) {
      this.notifications.error('Nao foi possivel concluir. Tente novamente.');
    } finally {
      this.saving = false;
    }
  }

  async toggleStatus(investment: Investment) {
    if (!investment.id) return;
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    const nextStatus: InvestmentStatus = investment.status === 'active' ? 'inactive' : 'active';
    this.togglingId = investment.id;
    try {
      await this.investmentsService.update(user.uid, investment.id, { status: nextStatus });
      this.notifications.success(
        nextStatus === 'active' ? 'Investimento reativado.' : 'Investimento inativado.'
      );
    } catch (err: any) {
      this.notifications.error('Nao foi possivel concluir. Tente novamente.');
    } finally {
      if (this.togglingId === investment.id) {
        this.togglingId = null;
      }
    }
  }

  private validateForm(): string | null {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return 'Preencha os campos obrigatorios.';
    }

    const value = this.form.value;
    if (!value.hadBeforeApp && Number(value.principalBase ?? 0) <= 0) {
      return 'Informe o valor aplicado inicial.';
    }
    if (value.hadBeforeApp && Number(value.currentValueAtOnboarding ?? 0) <= 0) {
      return 'Informe o valor atual do investimento.';
    }
    if (value.hadBeforeApp && !value.systemStartDate) {
      return 'Informe a data de alinhamento.';
    }
    if (this.isManualMode && Number(value.manualRate ?? 0) <= 0) {
      return 'Informe a taxa manual.';
    }
    if (this.yieldMode === 'cdi_percent' && Number(value.cdiPercent ?? 0) <= 0) {
      return 'Informe o percentual do CDI.';
    }
    return null;
  }

  private buildPayload(): Omit<Investment, 'id' | 'createdAt' | 'updatedAt'> {
    const value = this.form.value;
    const hadBeforeApp = Boolean(value.hadBeforeApp);
    const realStartDate = value.realStartDate || this.todayYmd;
    let systemStartDate = value.systemStartDate || realStartDate;

    let principalBase = Number(value.principalBase ?? 0);
    let preAppYield = 0;
    let totalInvestedToDate = this.toNumberOrNull(value.totalInvestedToDate);
    let currentValueAtOnboarding = this.toNumberOrNull(value.currentValueAtOnboarding);
    const preAppYieldInput = this.toNumberOrNull(value.preAppYield);

    if (hadBeforeApp) {
      const currentValue = Number(currentValueAtOnboarding ?? 0);
      if (totalInvestedToDate !== null && totalInvestedToDate > 0) {
        principalBase = totalInvestedToDate;
        preAppYield = Math.max(0, currentValue - totalInvestedToDate);
      } else if (preAppYieldInput !== null && preAppYieldInput >= 0) {
        preAppYield = preAppYieldInput;
        principalBase = Math.max(0, currentValue - preAppYield);
      } else {
        principalBase = currentValue;
        preAppYield = 0;
      }
    } else {
      systemStartDate = realStartDate;
      totalInvestedToDate = null;
      currentValueAtOnboarding = null;
      preAppYield = 0;
    }

    const payload: Omit<Investment, 'id' | 'createdAt' | 'updatedAt'> = {
      name: (value.name ?? '').trim(),
      type: value.type as InvestmentType,
      status: value.status as InvestmentStatus,
      realStartDate,
      systemStartDate,
      hadBeforeApp,
      principalBase,
      preAppYield,
      totalInvestedToDate,
      currentValueAtOnboarding,
      yieldMode: value.yieldMode as InvestmentYieldMode,
      manualRate: this.toNumberOrNull(value.manualRate),
      cdiPercent: this.toNumberOrNull(value.cdiPercent),
      compounding: (value.compounding ?? 'monthly') as 'daily' | 'monthly'
    };

    return payload;
  }

  private buildView(investments: Investment[], context: IndexContext): InvestmentsPageView {
    const summary = this.calculator.summarize(investments, context);
    const items = investments
      .map((investment) => {
        const calc = this.calculator.calculate(investment, context);
        const updatedLabel = calc.updatedAt ? formatPtBrFromYmd(calc.updatedAt) : '-';
        return {
          ...investment,
          ...calc,
          typeLabel: this.typeLabel(investment.type),
          statusLabel: investment.status === 'active' ? 'Ativo' : 'Inativo',
          updatedLabel
        } as InvestmentView;
      })
      .sort((a, b) => {
        if (a.status !== b.status) {
          return a.status === 'active' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

    return {
      summary: {
        ...summary,
        updatedLabel: summary.updatedAt ? formatPtBrFromYmd(summary.updatedAt) : '-'
      },
      items
    };
  }

  private typeLabel(type: InvestmentType) {
    const found = this.typeOptions.find((item) => item.value === type);
    return found?.label ?? 'Manual';
  }

  private toNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private emptyView(): InvestmentsPageView {
    return {
      summary: {
        totalInvested: 0,
        totalEstimated: 0,
        totalYield: 0,
        totalYieldPercent: 0,
        updatedAt: null,
        updatedLabel: '-',
        indexMissing: false,
        count: 0
      },
      items: []
    };
  }
}
