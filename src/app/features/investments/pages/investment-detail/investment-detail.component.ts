import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  firstValueFrom,
  map,
  of,
  startWith,
  switchMap,
  tap
} from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { AccountsService } from '../../../../core/services/accounts.service';
import { CategoriesService } from '../../../../core/services/categories.service';
import { InvestmentsService } from '../../services/investments.service';
import { InvestmentsMovementsService } from '../../services/investments-movements.service';
import { IndicesService } from '../../services/indices.service';
import {
  IndexContext,
  InvestmentCalculation,
  InvestmentsCalculatorService,
  RescueIrEstimate
} from '../../services/investments-calculator.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { Investment, InvestmentStatus, InvestmentType } from '../../models/investment.model';
import { InvestmentMovement } from '../../models/investment-movement.model';
import { Account } from '../../../../core/models/account.model';
import {
  formatPtBrFromYmd,
  localDateFromYmd,
  toLocalDateKey,
  toYmdFromLocalDate
} from '../../../../shared/utils/date.util';
import { environment } from '../../../../../environments/environment';

type InvestmentDetailView = Investment &
  InvestmentCalculation & {
    typeLabel: string;
    statusLabel: string;
    updatedLabel: string;
  };

type MovementFilterType = 'all' | 'deposit' | 'withdraw';
type MovementFilterPeriod = 'all' | 'last_30' | 'this_month';

type MovementHistoryView = {
  items: InvestmentMovement[];
  totalDeposits: number;
  totalWithdraws: number;
  hasMovements: boolean;
};

@Component({
  selector: 'app-investment-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './investment-detail.component.html',
  styleUrl: './investment-detail.component.css'
})
export class InvestmentDetailComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private accountsService = inject(AccountsService);
  private categoriesService = inject(CategoriesService);
  private investmentsService = inject(InvestmentsService);
  private movementsService = inject(InvestmentsMovementsService);
  private indicesService = inject(IndicesService);
  private calculator = inject(InvestmentsCalculatorService);
  private notifications = inject(NotificationService);

  readonly todayYmd = toYmdFromLocalDate(new Date());
  readonly skeletonRows = Array.from({ length: 3 });

  showDepositModal = false;
  showWithdrawModal = false;
  submittingDeposit = false;
  submittingWithdraw = false;
  togglingStatus = false;
  showDeleteMovementModal = false;
  deletingMovement = false;
  movementToDelete: InvestmentMovement | null = null;
  selectedInvestment: InvestmentDetailView | null = null;

  filterType: MovementFilterType = 'all';
  filterPeriod: MovementFilterPeriod = 'all';

  private filterTypeSubject = new BehaviorSubject<MovementFilterType>(this.filterType);
  private filterPeriodSubject = new BehaviorSubject<MovementFilterPeriod>(this.filterPeriod);

  readonly typeOptions = [
    { value: 'fixed_income', label: 'Renda fixa' },
    { value: 'savings', label: 'Poupanca' },
    { value: 'cdb', label: 'CDB' },
    { value: 'treasury_selic', label: 'Tesouro Selic' },
    { value: 'manual', label: 'Manual' }
  ] as const;

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

  investmentId$ = this.route.paramMap.pipe(
    map((params) => params.get('id')),
    map((value) => value ?? '')
  );

  investment$ = combineLatest([this.auth.user$, this.investmentId$]).pipe(
    switchMap(([user, id]) => (user && id ? this.investmentsService.get$(user.uid, id) : of(null))),
    catchError(() => of(null))
  );

  view$ = combineLatest([this.investment$, this.latestCdi$, this.latestSelic$]).pipe(
    map(([investment, cdi, selic]) =>
      investment ? this.buildView(investment, { cdi, selic }) : null
    )
  );

  viewState$ = this.view$.pipe(
    map((view) => ({ view, loaded: true })),
    startWith({ view: null, loaded: false })
  );

  movements$ = combineLatest([this.auth.user$, this.investmentId$]).pipe(
    switchMap(([user, id]) =>
      user && id ? this.movementsService.listByInvestment$(user.uid, id) : of([])
    ),
    map((items) => items ?? []),
    tap((items) => {
      if (!environment.production) {
        const first = items[0] ?? null;
        console.log('[Investments] movements stream', { count: items.length, first });
      }
    }),
    catchError(() => of([]))
  );

  history$ = combineLatest([
    this.movements$,
    this.filterTypeSubject,
    this.filterPeriodSubject
  ]).pipe(
    map(([movements, filterType, filterPeriod]) =>
      this.buildHistory(movements, filterType, filterPeriod)
    )
  );

  accounts$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.accountsService.list$(user.uid) : of([]))),
    map((accounts) => accounts.filter((account) => (account.type ?? 'bank') !== 'investment')),
    catchError(() => of([] as Account[]))
  );

  trackByMovementId(_: number, item: InvestmentMovement) {
    return item.id;
  }

  onFilterTypeChange(value: string) {
    this.filterType = (value as MovementFilterType) || 'all';
    this.filterTypeSubject.next(this.filterType);
  }

  onFilterPeriodChange(value: string) {
    this.filterPeriod = (value as MovementFilterPeriod) || 'all';
    this.filterPeriodSubject.next(this.filterPeriod);
  }

  openDeposit(investment: InvestmentDetailView) {
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

  openWithdraw(investment: InvestmentDetailView) {
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

  openDeleteMovement(movement: InvestmentMovement) {
    if (!movement.isHistorical || !movement.id) {
      return;
    }
    this.movementToDelete = movement;
    this.showDeleteMovementModal = true;
  }

  closeDeleteMovementModal() {
    this.showDeleteMovementModal = false;
    this.movementToDelete = null;
  }

  async confirmDeleteMovement() {
    const movement = this.movementToDelete;
    if (!movement?.id || !movement.isHistorical) {
      return;
    }
    const investmentId = this.route.snapshot.paramMap.get('id') || '';
    if (!investmentId) {
      return;
    }
    const user = await firstValueFrom(this.auth.user$);
    if (!user) {
      return;
    }
    this.deletingMovement = true;
    try {
      await this.movementsService.deleteMovement(user.uid, investmentId, movement.id);
      this.notifications.success('Movimentação excluida.');
      this.closeDeleteMovementModal();
    } catch (err: any) {
      this.notifications.error('Não foi possível excluir. Tente novamente.');
    } finally {
      this.deletingMovement = false;
    }
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
      this.notifications.warning('Informe um valor valido.');
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

  private updateHistoricalState(form: FormGroup, investment: InvestmentDetailView | null) {
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

  private validateHistoricalDate(
    dateValue: string,
    investment: InvestmentDetailView | null
  ): string | null {
    if (!dateValue) {
      return 'Informe a data do movimento.';
    }
    if (dateValue > this.todayYmd) {
      return 'Movimento histórico deve ser no passado.';
    }
    const limitDate = investment?.systemStartDate || investment?.realStartDate;
    if (limitDate && dateValue > limitDate) {
      return 'Movimento histórico deve ser anterior a data de cadastro.';
    }
    return null;
  }

  async toggleStatus(investment: InvestmentDetailView) {
    if (!investment.id) return;
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    const nextStatus: InvestmentStatus = investment.status === 'active' ? 'inactive' : 'active';
    this.togglingStatus = true;
    try {
      await this.investmentsService.update(user.uid, investment.id, { status: nextStatus });
      this.notifications.success(
        nextStatus === 'active' ? 'Investimento reativado.' : 'Investimento inativado.'
      );
    } catch (err: any) {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      this.togglingStatus = false;
    }
  }

  movementLabel(movement: InvestmentMovement) {
    return movement.type === 'deposit' ? 'Aporte' : 'Resgate';
  }

  movementDirectionLabel(movement: InvestmentMovement) {
    return movement.type === 'deposit' ? 'Saiu de:' : 'Entrou em:';
  }

  movementAccountLabel(movement: InvestmentMovement) {
    return movement.accountNameSnapshot || 'Conta removida';
  }

  movementHistoricalAccountLabel(movement: InvestmentMovement) {
    if (movement.accountNameSnapshot) {
      return `Conta: ${movement.accountNameSnapshot}`;
    }
    return 'Conta: - (movimento histórico)';
  }

  formatDate(ymd: string) {
    return formatPtBrFromYmd(ymd);
  }

  private buildView(investment: Investment, context: IndexContext): InvestmentDetailView {
    const calc = this.calculator.calculate(investment, context);
    const updatedAt = investment.lastYieldCalculationAt || calc.updatedAt;
    const updatedLabel = this.buildUpdatedLabel(updatedAt);
    return {
      ...investment,
      ...calc,
      typeLabel: this.typeLabel(investment.type),
      statusLabel: investment.status === 'active' ? 'Ativo' : 'Inativo',
      updatedLabel
    };
  }

  private buildHistory(
    movements: InvestmentMovement[],
    filterType: MovementFilterType,
    filterPeriod: MovementFilterPeriod
  ): MovementHistoryView {
    const ledgerMovements = movements.filter((movement) => !movement.isHistorical);
    const totalDeposits = ledgerMovements
      .filter((movement) => movement.type === 'deposit')
      .reduce((acc, movement) => acc + Number(movement.amount ?? 0), 0);
    const totalWithdraws = ledgerMovements
      .filter((movement) => movement.type === 'withdraw')
      .reduce((acc, movement) => acc + Number(movement.amount ?? 0), 0);

    const items = movements.filter((movement) => {
      if (filterType !== 'all' && movement.type !== filterType) {
        return false;
      }
      return this.matchesPeriod(movement, filterPeriod);
    });

    return {
      items,
      totalDeposits,
      totalWithdraws,
      hasMovements: movements.length > 0
    };
  }

  private matchesPeriod(movement: InvestmentMovement, period: MovementFilterPeriod) {
    if (period === 'all') {
      return true;
    }
    const movementDate = localDateFromYmd(movement.date);
    if (!movementDate) {
      return false;
    }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'last_30') {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return movementDate >= start && movementDate <= today;
    }
    return (
      movementDate.getFullYear() === today.getFullYear() &&
      movementDate.getMonth() === today.getMonth()
    );
  }

  private typeLabel(type: InvestmentType) {
    const found = this.typeOptions.find((item) => item.value === type);
    return found?.label ?? 'Manual';
  }

  private canValidateEstimated(investment: InvestmentDetailView) {
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
    const investimentos = incomeCategories.find((cat) => normalized(cat.name) === 'investimentos');
    if (investimentos?.id) {
      return investimentos.id;
    }
    return this.categoriesService.ensureCategory(uid, {
      name: 'Resgates',
      type: 'income',
      color: '#22c55e'
    });
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
}
