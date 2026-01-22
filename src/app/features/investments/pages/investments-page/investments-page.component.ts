import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, combineLatest, firstValueFrom, map, of, switchMap, tap } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { AccountsService } from '../../../../core/services/accounts.service';
import { CategoriesService } from '../../../../core/services/categories.service';
import { InvestmentsService } from '../../services/investments.service';
import {
  IndexContext,
  InvestmentCalculation,
  InvestmentSummary,
  InvestmentsCalculatorService,
  RescueIrEstimate
} from '../../services/investments-calculator.service';
import { IndicesService } from '../../services/indices.service';
import {
  Investment,
  InvestmentStatus,
  InvestmentYieldMode,
  InvestmentType
} from '../../models/investment.model';
import { NotificationService } from '../../../../core/services/notification.service';
import {
  formatPtBrFromYmd,
  toLocalDateKey,
  toYmdFromLocalDate
} from '../../../../shared/utils/date.util';
import { Account } from '../../../../core/models/account.model';

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
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './investments-page.component.html',
  styleUrl: './investments-page.component.css'
})
export class InvestmentsPageComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private accountsService = inject(AccountsService);
  private categoriesService = inject(CategoriesService);
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
  showDepositModal = false;
  showWithdrawModal = false;
  submittingDeposit = false;
  submittingWithdraw = false;
  selectedInvestment: InvestmentView | null = null;

  readonly typeOptions = [
    { value: 'fixed_income', label: 'Renda fixa' },
    { value: 'savings', label: 'Poupança' },
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
    principalBase: [null as number | null, [Validators.min(0)]],
    yieldMode: ['manual_monthly', Validators.required],
    manualRate: [null as number | null],
    cdiPercent: [100],
    compounding: ['monthly']
  });

  depositForm = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    date: [this.todayYmd, Validators.required],
    accountId: ['', Validators.required],
    notes: [''],
    isHistorical: [false]
  });

  withdrawForm = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    date: [this.todayYmd, Validators.required],
    accountId: ['', Validators.required],
    notes: [''],
    isHistorical: [false],
    applyIr: [true]
  });

  private latestCdi$ = this.indicesService.latest$('cdi');
  private latestSelic$ = this.indicesService.latest$('selic');

  investments$ = this.auth.user$.pipe(
    tap(() => (this.loadingInvestments = true)),
    switchMap((user) => (user ? this.investmentsService.list$(user.uid) : of([]))),
    map((items) => items ?? []),
    catchError(() => of([]))
  );

  accounts$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.accountsService.list$(user.uid) : of([]))),
    map((accounts) => accounts.filter((account) => (account.type ?? 'bank') !== 'investment')),
    catchError(() => of([] as Account[]))
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

  onTypeChange() {
    const type = this.form.get('type')?.value as InvestmentType;
    if (this.editingId || type !== 'fixed_income') {
      return;
    }
    if (this.hasYieldOverrides()) {
      return;
    }
    this.form.patchValue({
      yieldMode: 'cdi_percent',
      cdiPercent: 100,
      compounding: 'daily'
    });
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
      principalBase: investment.principalBase ?? null,
      yieldMode: investment.yieldMode,
      manualRate: investment.manualRate ?? null,
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
      principalBase: null,
      yieldMode: 'manual_monthly',
      manualRate: null,
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
      this.notifications.error('Não foi possível concluir. Tente novamente.');
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
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      if (this.togglingId === investment.id) {
        this.togglingId = null;
      }
    }
  }

  openDeposit(investment: InvestmentView) {
    this.selectedInvestment = investment;
    this.showWithdrawModal = false;
    this.showDepositModal = true;
    this.depositForm.reset({
      amount: null,
      date: this.todayYmd,
      accountId: '',
      notes: '',
      isHistorical: false
    });
    this.updateHistoricalState(this.depositForm, investment);
  }

  closeDeposit() {
    this.showDepositModal = false;
    this.selectedInvestment = null;
  }

  openWithdraw(investment: InvestmentView) {
    this.selectedInvestment = investment;
    this.showDepositModal = false;
    this.showWithdrawModal = true;
    this.withdrawForm.reset({
      amount: null,
      date: this.todayYmd,
      accountId: '',
      notes: '',
      isHistorical: false,
      applyIr: true
    });
    this.updateHistoricalState(this.withdrawForm, investment);
  }

  closeWithdraw() {
    this.showWithdrawModal = false;
    this.selectedInvestment = null;
  }

  onDepositHistoricalToggle() {
    this.updateHistoricalState(this.depositForm, this.selectedInvestment);
  }

  onWithdrawHistoricalToggle() {
    this.updateHistoricalState(this.withdrawForm, this.selectedInvestment);
  }

  get withdrawIrEstimate(): RescueIrEstimate | null {
    const investment = this.selectedInvestment;
    if (!investment) {
      return null;
    }
    if (Boolean(this.withdrawForm.get('isHistorical')?.value)) {
      return null;
    }
    if (!Boolean(this.withdrawForm.get('applyIr')?.value)) {
      return null;
    }
    const amount = Number(this.withdrawForm.get('amount')?.value ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }
    const currentValue = Number(investment.totalEstimated ?? 0);
    if (!Number.isFinite(currentValue) || currentValue <= 0) {
      return null;
    }
    const startDate = investment.realStartDate || investment.systemStartDate || '';
    return this.calculator.calculateRescueIR({
      principalBase: Number(investment.principalBase ?? 0),
      currentValue,
      rescueAmount: amount,
      investmentStartDate: startDate
    });
  }

  async confirmDeposit() {
    if (this.depositForm.invalid) {
      this.depositForm.markAllAsTouched();
      this.notifications.warning('Preencha os campos obrigatórios.');
      return;
    }
    const user = await firstValueFrom(this.auth.user$);
    const investment = this.selectedInvestment;
    if (!user || !investment?.id) {
      return;
    }
    const isHistorical = Boolean(this.depositForm.get('isHistorical')?.value);
    const amount = Number(this.depositForm.get('amount')?.value ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.notifications.warning('Informe um valor válido.');
      return;
    }
    const dateValue = this.depositForm.get('date')?.value || this.todayYmd;
    if (isHistorical) {
      const validationMessage = this.validateHistoricalDate(dateValue, investment);
      if (validationMessage) {
        this.notifications.warning(validationMessage);
        return;
      }
    }

    this.submittingDeposit = true;
    try {
      const categoryId = isHistorical
        ? null
        : await this.categoriesService.ensureCategory(user.uid, {
            name: 'Investimentos',
            type: 'expense',
            color: '#f97316'
          });
      await this.investmentsService.createDeposit(user.uid, {
        investmentId: investment.id,
        accountId: this.depositForm.get('accountId')?.value || null,
        amount,
        date: dateValue,
        categoryId,
        notes: this.depositForm.get('notes')?.value || null,
        isHistorical
      });
      this.notifications.success('Aporte registrado com sucesso.');
      this.closeDeposit();
    } catch (err: any) {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      this.submittingDeposit = false;
    }
  }

  async confirmWithdraw() {
    if (this.withdrawForm.invalid) {
      this.withdrawForm.markAllAsTouched();
      this.notifications.warning('Preencha os campos obrigatórios.');
      return;
    }
    const user = await firstValueFrom(this.auth.user$);
    const investment = this.selectedInvestment;
    if (!user || !investment?.id) {
      return;
    }
    const isHistorical = Boolean(this.withdrawForm.get('isHistorical')?.value);
    const applyIr = Boolean(this.withdrawForm.get('applyIr')?.value);
    const amount = Number(this.withdrawForm.get('amount')?.value ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.notifications.warning('Informe um valor válido.');
      return;
    }
    const dateValue = this.withdrawForm.get('date')?.value || this.todayYmd;
    if (isHistorical) {
      const validationMessage = this.validateHistoricalDate(dateValue, investment);
      if (validationMessage) {
        this.notifications.warning(validationMessage);
        return;
      }
    } else {
      const estimated = Number(investment.totalEstimated ?? 0);
      if (this.canValidateEstimated(investment) && estimated > 0) {
        const limit = estimated * 1.02;
        if (amount > limit) {
          this.notifications.warning('Valor acima do estimado do investimento.');
          return;
        }
      } else {
        this.notifications.warning('Valor estimado. Verifique antes de confirmar.');
      }
    }

    this.submittingWithdraw = true;
    try {
      const categoryId = isHistorical ? null : await this.resolveWithdrawCategory(user.uid);
      await this.investmentsService.createWithdraw(user.uid, {
        investmentId: investment.id,
        accountId: this.withdrawForm.get('accountId')?.value || null,
        amount,
        date: dateValue,
        categoryId,
        notes: this.withdrawForm.get('notes')?.value || null,
        isHistorical,
        applyIr: !isHistorical && applyIr,
        currentValue: Number(investment.totalEstimated ?? 0)
      });
      this.notifications.success('Resgate registrado com sucesso.');
      this.closeWithdraw();
    } catch (err: any) {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      this.submittingWithdraw = false;
    }
  }

  private updateHistoricalState(form: FormGroup, investment: InvestmentView | null) {
    const isHistorical = Boolean(form.get('isHistorical')?.value);
    const accountControl = form.get('accountId');
    if (accountControl) {
      if (isHistorical) {
        accountControl.clearValidators();
      } else {
        accountControl.setValidators([Validators.required]);
      }
      accountControl.updateValueAndValidity({ emitEvent: false });
    }
    const applyIrControl = form.get('applyIr');
    if (applyIrControl) {
      if (isHistorical) {
        applyIrControl.setValue(false, { emitEvent: false });
        applyIrControl.disable({ emitEvent: false });
      } else {
        applyIrControl.enable({ emitEvent: false });
      }
    }
    if (isHistorical && investment?.systemStartDate) {
      const dateControl = form.get('date');
      const suggestedDate = investment.systemStartDate;
      const currentDate = dateControl?.value;
      if (dateControl && suggestedDate && (!currentDate || currentDate > suggestedDate)) {
        dateControl.setValue(suggestedDate);
      }
    }
  }

  private validateHistoricalDate(dateValue: string, investment: InvestmentView | null): string | null {
    if (!dateValue) {
      return 'Informe a data do movimento.';
    }
    if (dateValue > this.todayYmd) {
      return 'Movimento historico deve ser no passado.';
    }
    const limitDate = investment?.systemStartDate || investment?.realStartDate;
    if (limitDate && dateValue > limitDate) {
      return 'Movimento histórico deve ser anterior a data de cadastro.';
    }
    return null;
  }

  private validateForm(): string | null {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return 'Preencha os campos obrigatórios.';
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
    const summaryUpdatedAt =
      this.pickLatestYmd(investments.map((investment) => investment.lastYieldCalculationAt)) ??
      summary.updatedAt;
    const items = investments
      .map((investment) => {
        const calc = this.calculator.calculate(investment, context);
        const updatedAt = investment.lastYieldCalculationAt || calc.updatedAt;
        const updatedLabel = this.buildUpdatedLabel(updatedAt);
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
        updatedAt: summaryUpdatedAt,
        updatedLabel: this.buildUpdatedLabel(summaryUpdatedAt)
      },
      items
    };
  }

  private typeLabel(type: InvestmentType) {
    const found = this.typeOptions.find((item) => item.value === type);
    return found?.label ?? 'Manual';
  }

  private canValidateEstimated(investment: InvestmentView) {
    return !investment.indexMissing && !investment.placeholderUsed;
  }

  private async resolveWithdrawCategory(uid: string): Promise<string> {
    const categories = await firstValueFrom(this.categoriesService.list$(uid));
    const normalized = (value: string) => value.trim().toLowerCase();
    const incomeCategories = categories.filter((cat) => cat.type === 'income');
    const resgates = incomeCategories.find((cat) => normalized(cat.name) === 'resgates');
    if (resgates?.id) {
      return resgates.id;
    }
    const investimentos = incomeCategories.find(
      (cat) => normalized(cat.name) === 'investimentos'
    );
    if (investimentos?.id) {
      return investimentos.id;
    }
    return this.categoriesService.ensureCategory(uid, {
      name: 'Resgates',
      type: 'income',
      color: '#22c55e'
    });
  }

  private hasYieldOverrides(): boolean {
    return Boolean(
      this.form.get('yieldMode')?.dirty ||
        this.form.get('manualRate')?.dirty ||
        this.form.get('cdiPercent')?.dirty ||
        this.form.get('compounding')?.dirty
    );
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

  private buildUpdatedLabel(ymd: string | null): string {
    if (!ymd) {
      return '-';
    }
    const todayKey = toLocalDateKey(new Date());
    if (ymd === todayKey) {
      return 'hoje';
    }
    return formatPtBrFromYmd(ymd);
  }

  private pickLatestYmd(values: Array<string | null | undefined>): string | null {
    const dates = values.filter((value): value is string => Boolean(value));
    if (!dates.length) {
      return null;
    }
    return dates.sort().slice(-1)[0];
  }
}
