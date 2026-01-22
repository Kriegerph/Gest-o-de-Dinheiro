import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  Subject,
  catchError,
  combineLatest,
  firstValueFrom,
  map,
  of,
  switchMap,
  takeUntil,
  tap
} from 'rxjs';
import { AccountsService } from '../../core/services/accounts.service';
import { AuthService } from '../../core/services/auth.service';
import { CategoriesService } from '../../core/services/categories.service';
import { NotificationService } from '../../core/services/notification.service';
import { CreditCard } from '../../core/models/credit-card.model';
import { CreditInstallment } from '../../core/models/credit-installment.model';
import { formatPtBrFromYmd, toYmdFromLocalDate } from '../../shared/utils/date.util';
import { buildMonthlyDueDates } from './utils/credit.util';
import { CreditReconcileService } from './credit-reconcile.service';
import { CreditService } from './credit.service';

interface CreditCardView extends CreditCard {
  paymentAccountName?: string;
}

interface PurchaseView {
  id?: string;
  cardId: string;
  description: string;
  categoryId?: string | null;
  cardName: string;
  categoryName?: string;
  purchaseDate: string;
  firstDueDate: string;
  installmentsCount: number;
  sameValue: boolean;
  installmentAmounts: number[];
  totalAmount: number;
  paidCount: number;
  installments: CreditInstallment[];
}

interface DiagnosticCardTotal {
  cardId: string;
  cardName: string;
  amount: number;
}

interface DiagnosticDateGroup {
  key: string;
  amount: number;
  count: number;
}

interface DiagnosticView {
  cardTotals: DiagnosticCardTotal[];
  upcoming: DiagnosticDateGroup[];
  monthly: DiagnosticDateGroup[];
  totalOpen: number;
}

@Component({
  selector: 'app-credit',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './credit.component.html',
  styleUrl: './credit.component.css'
})
export class CreditComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private accountsService = inject(AccountsService);
  private categoriesService = inject(CategoriesService);
  private creditService = inject(CreditService);
  private reconcileService = inject(CreditReconcileService);
  private notifications = inject(NotificationService);
  private destroy$ = new Subject<void>();

  activeTab: 'cards' | 'purchases' | 'diagnostic' = 'cards';
  editingCardId: string | null = null;
  editingPurchaseId: string | null = null;
  editingPurchase: PurchaseView | null = null;
  loadingCards = true;
  loadingPurchases = true;
  loadingDiagnostic = true;
  savingCard = false;
  savingPurchase = false;
  deletingCardId: string | null = null;
  reconciling = false;
  private installmentRequests = new Set<string>();
  readonly skeletonRows = Array.from({ length: 4 });
  readonly formatDate = formatPtBrFromYmd;

  cardForm = this.fb.group({
    name: this.fb.control<string>('', { validators: [Validators.required, Validators.minLength(2)] }),
    brand: this.fb.control<string>('', { nonNullable: true }),
    limit: this.fb.control<number | null>(null, { validators: [Validators.min(0)] }),
    closingDay: this.fb.control<number | null>(null, {
      validators: [Validators.min(1), Validators.max(28)]
    }),
    dueDay: this.fb.control<number | null>(null, {
      validators: [Validators.required, Validators.min(1), Validators.max(28)]
    }),
    paymentAccountId: this.fb.control<string>('', { validators: [Validators.required] }),
  });


  purchaseForm = this.fb.group({
    cardId: ['', Validators.required],
    description: ['', [Validators.required, Validators.minLength(2)]],
    categoryId: [''],
    purchaseDate: ['', Validators.required],
    firstDueDate: ['', Validators.required],
    installmentsCount: [1, [Validators.required, Validators.min(1), Validators.max(48)]],
    sameValue: [true],
    installmentAmounts: this.fb.array([])
  });

  accounts$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.accountsService.list$(user.uid) : of([]))),
    map((items) => items ?? [])
  );

  cards$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.creditService.listCards$(user.uid) : of([]))),
    map((items) => items ?? [])
  );

  categories$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.categoriesService.list$(user.uid) : of([]))),
    map((items) => items ?? [])
  );

  purchases$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.creditService.listPurchases$(user.uid) : of([]))),
    map((items) => items ?? [])
  );

  installments$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.creditService.listInstallments$(user.uid) : of([]))),
    map((items) => items ?? [])
  );

  cardsView$ = combineLatest([this.cards$, this.accounts$]).pipe(
    map(([cards, accounts]) => {
      const accountMap = new Map(accounts.map((acc) => [acc.id || '', acc]));
      return cards.map((card) => ({
        ...card,
        paymentAccountName: accountMap.get(card.paymentAccountId)?.name || '-'
      }));
    }),
    tap(() => (this.loadingCards = false)),
    catchError(() => {
      this.loadingCards = false;
      return of([] as CreditCardView[]);
    })
  );

  purchasesView$ = combineLatest([
    this.purchases$,
    this.cards$,
    this.categories$,
    this.installments$
  ]).pipe(
    map(([purchases, cards, categories, installments]) => {
      const cardMap = new Map(cards.map((card) => [card.id || '', card]));
      const categoryMap = new Map(categories.map((cat) => [cat.id || '', cat]));
      const installmentsByPurchase = new Map<string, CreditInstallment[]>();
      installments.forEach((installment) => {
        const key = installment.purchaseId;
        const current = installmentsByPurchase.get(key) || [];
        current.push(installment);
        installmentsByPurchase.set(key, current);
      });

      return purchases.map<PurchaseView>((purchase) => {
        const cardName = cardMap.get(purchase.cardId)?.name || 'Cartão';
        const categoryName = purchase.categoryId
          ? categoryMap.get(purchase.categoryId)?.name
          : undefined;
        const items = (installmentsByPurchase.get(purchase.id || '') || []).sort(
          (a, b) => a.installmentNumber - b.installmentNumber
        );
        const installmentAmounts = (purchase.installmentAmounts ?? []).map((amount) =>
          Number(amount ?? 0)
        );
        const totalFromItems = items.reduce((acc, item) => acc + Number(item.amount ?? 0), 0);
        const totalFallback = installmentAmounts.reduce(
          (acc, amount) => acc + Number(amount ?? 0),
          0
        );
        const paidCount = items.filter((item) => item.paid).length;

        const view: PurchaseView = {
          id: purchase.id,
          cardId: purchase.cardId,
          description: purchase.description,
          categoryId: purchase.categoryId ?? null,
          cardName,
          categoryName,
          purchaseDate: purchase.purchaseDate,
          firstDueDate: purchase.firstDueDate,
          installmentsCount: purchase.installmentsCount,
          sameValue: Boolean(purchase.sameValue),
          installmentAmounts,
          totalAmount: items.length ? totalFromItems : totalFallback,
          paidCount,
          installments: items
        };
        this.checkAutoPaidInstallments(view);
        return view;
      });
    }),
    tap(() => (this.loadingPurchases = false)),
    catchError(() => {
      this.loadingPurchases = false;
      return of([] as PurchaseView[]);
    })
  );

  diagnosticView$ = combineLatest([this.cards$, this.installments$]).pipe(
    map(([cards, installments]) => {
      const openInstallments = installments.filter((item) => !item.paid);
      const cardTotals = cards
        .map<DiagnosticCardTotal>((card) => {
          const amount = openInstallments
            .filter((item) => item.cardId === card.id)
            .reduce((acc, item) => acc + Number(item.amount ?? 0), 0);
          return {
            cardId: card.id || '',
            cardName: card.name,
            amount
          };
        })
        .filter((item) => item.amount > 0);
      const totalOpen = cardTotals.reduce((acc, item) => acc + item.amount, 0);

      const today = toYmdFromLocalDate(new Date());
      const next30 = toYmdFromLocalDate(
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      );
      const upcomingMap = new Map<string, DiagnosticDateGroup>();
      const monthlyMap = new Map<string, DiagnosticDateGroup>();

      openInstallments.forEach((item) => {
        const keyMonth = item.dueDate?.slice(0, 7) || '';
        if (keyMonth) {
          const current = monthlyMap.get(keyMonth) || { key: keyMonth, amount: 0, count: 0 };
          current.amount += Number(item.amount ?? 0);
          current.count += 1;
          monthlyMap.set(keyMonth, current);
        }

        if (item.dueDate >= today && item.dueDate <= next30) {
          const current = upcomingMap.get(item.dueDate) || {
            key: item.dueDate,
            amount: 0,
            count: 0
          };
          current.amount += Number(item.amount ?? 0);
          current.count += 1;
          upcomingMap.set(item.dueDate, current);
        }
      });

      const upcoming = Array.from(upcomingMap.values()).sort((a, b) =>
        a.key < b.key ? -1 : 1
      );
      const monthly = Array.from(monthlyMap.values()).sort((a, b) =>
        a.key < b.key ? -1 : 1
      );

      return {
        cardTotals,
        upcoming,
        monthly,
        totalOpen
      } as DiagnosticView;
    }),
    tap(() => (this.loadingDiagnostic = false)),
    catchError(() => {
      this.loadingDiagnostic = false;
      return of({
        cardTotals: [],
        upcoming: [],
        monthly: [],
        totalOpen: 0
      } as DiagnosticView);
    })
  );

  get installmentsArray(): FormArray {
    return this.purchaseForm.get('installmentAmounts') as FormArray;
  }

  get installmentControls() {
    return this.installmentsArray.controls;
  }

  get sameValueEnabled(): boolean {
    return Boolean(this.purchaseForm.get('sameValue')?.value);
  }

  get installmentsTotal(): number {
    return this.installmentControls.reduce(
      (acc, ctrl) => acc + Number(ctrl.value ?? 0),
      0
    );
  }

  ngOnInit(): void {
    this.syncInstallments(1);
    this.purchaseForm
      .get('installmentsCount')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((value) => {
        const count = this.normalizeInstallmentsCount(value);
        if (count !== Number(value ?? 1)) {
          this.purchaseForm.get('installmentsCount')?.setValue(count, { emitEvent: false });
        }
        this.syncInstallments(count);
      });

    this.purchaseForm
      .get('sameValue')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((same) => {
        if (same) {
          this.copyFirstInstallmentAmount();
        }
      });

    this.runReconcile();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setTab(tab: 'cards' | 'purchases' | 'diagnostic') {
    this.activeTab = tab;
  }

  trackById(_: number, item: { id?: string }) {
    return item.id;
  }

  trackByInstallment(_: number, item: CreditInstallment) {
    return item.id || `${item.purchaseId}-${item.installmentNumber}`;
  }

  isInstallmentBusy(purchase: PurchaseView, inst: CreditInstallment): boolean {
    const purchaseId = purchase?.id ?? '';
    if (!purchaseId) {
      return false;
    }
    const key = this.getInstallmentKey(purchaseId, inst);
    return this.installmentRequests.has(key);
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

  toJsDate(value: any): Date | null {
    if (!value) return null;

    if (value?.toDate && typeof value.toDate === 'function') {
      return value.toDate();
    }

    if (value instanceof Date) {
      return value;
    }

    if (typeof value === 'string') {
      const local = this.parseLocalYmd(value);
      if (local) {
        return local;
      }
    }

    if (typeof value === 'string' || typeof value === 'number') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }

    return null;
  }

  editCard(card: CreditCard) {
    this.editingCardId = card.id || null;
    this.cardForm.patchValue({
      name: card.name,
      brand: card.brand || '',
      limit: card.limit ?? null,
      closingDay: card.closingDay ?? null,
      dueDay: card.dueDay ?? null,
      paymentAccountId: card.paymentAccountId
    });
  }

  resetCardForm() {
    this.editingCardId = null;
    this.cardForm.reset({
      name: '',
      brand: '',
      limit: null,
      closingDay: null,
      dueDay: null,
      paymentAccountId: ''
    });
  }

  async saveCard() {
    const raw = this.cardForm.getRawValue();

    const normalized = {
      name: (raw.name ?? '').trim(),
      brand: (raw.brand ?? '').trim(),
      limit: raw.limit === null || raw.limit === undefined ? null : Number(raw.limit),
      closingDay:
        raw.closingDay === null || raw.closingDay === undefined ? null : Number(raw.closingDay),
      dueDay: raw.dueDay === null || raw.dueDay === undefined ? null : Number(raw.dueDay),
      paymentAccountId: raw.paymentAccountId ?? ''
    };

    // garante que numeros invalidos virem null (sem quebrar validators)
    if (normalized.limit !== null && !Number.isFinite(normalized.limit)) normalized.limit = null;
    if (normalized.closingDay !== null && !Number.isFinite(normalized.closingDay)) {
      normalized.closingDay = null;
    }
    if (normalized.dueDay !== null && !Number.isFinite(normalized.dueDay)) normalized.dueDay = null;

    this.cardForm.patchValue(normalized, { emitEvent: false });
    this.cardForm.updateValueAndValidity();

    if (this.cardForm.invalid) {
      this.cardForm.markAllAsTouched();
      this.notifications.warning('Preencha os campos obrigatórios.');
      return;
    }

    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;

    this.savingCard = true;
    try {
      if (this.editingCardId) {
        await this.creditService.updateCard(user.uid, this.editingCardId, {
          name: normalized.name,
          brand: normalized.brand || null,
          limit: normalized.limit,
          closingDay: normalized.closingDay,
          dueDay: normalized.dueDay!,
          paymentAccountId: normalized.paymentAccountId
        });
      } else {
        await this.creditService.addCard(user.uid, {
          name: normalized.name,
          brand: normalized.brand || null,
          limit: normalized.limit,
          closingDay: normalized.closingDay,
          dueDay: normalized.dueDay!,
          paymentAccountId: normalized.paymentAccountId
        });
      }

      this.notifications.success('Cartão salvo com sucesso.');
      this.resetCardForm();
    } catch (err: any) {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      this.savingCard = false;
    }
  }

  async deleteCard(card: CreditCard) {
    const confirmed = await this.notifications.confirm({
      title: 'Excluir cartão?',
      message: `Excluir cartão "${card.name}"? Essa ação não pode ser desfeita.`,
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      tone: 'danger'
    });
    if (!confirmed || !card.id) return;
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    this.deletingCardId = card.id;
    try {
      await this.creditService.deleteCard(user.uid, card.id);
      this.notifications.success('Cartão excluído com sucesso.');
    } catch (err: any) {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      if (this.deletingCardId === card.id) {
        this.deletingCardId = null;
      }
    }
  }

  editPurchase(purchase: PurchaseView): void {
    this.editingPurchaseId = purchase.id ?? null;
    this.editingPurchase = purchase;
    const count = Number(
      purchase.installmentsCount ?? (purchase.installmentAmounts.length || 1)
    );
    const amounts =
      purchase.installmentAmounts.length > 0
        ? purchase.installmentAmounts
        : purchase.installments.map((installment) => Number(installment.amount ?? 0));

    this.purchaseForm.patchValue(
      {
        cardId: purchase.cardId ?? '',
        description: purchase.description ?? '',
        categoryId: purchase.categoryId ?? '',
        purchaseDate: purchase.purchaseDate ?? '',
        firstDueDate: purchase.firstDueDate ?? '',
        installmentsCount: count,
        sameValue: Boolean(purchase.sameValue)
      },
      { emitEvent: false }
    );

    this.syncInstallments(count);
    for (let i = 0; i < this.installmentsArray.length; i++) {
      this.installmentsArray
        .at(i)
        .setValue(Number(amounts[i] ?? 0), { emitEvent: false });
    }
    if (this.sameValueEnabled) {
      this.copyFirstInstallmentAmount();
    }

    this.purchaseForm.markAsPristine();
    this.purchaseForm.updateValueAndValidity({ emitEvent: false });
  }

  cancelEditPurchase(): void {
    this.editingPurchaseId = null;
    this.editingPurchase = null;
    this.resetPurchaseForm();
  }

  async deletePurchase(purchase: PurchaseView): Promise<void> {
    const ok = await this.notifications.confirm({
      title: 'Excluir compra?',
      message:
        'Essa ação remove a compra e suas parcelas. Lançamentos já criados não serão apagados.',
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      tone: 'danger'
    });
    if (!ok || !purchase.id) return;
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;

    try {
      await this.creditService.deletePurchase(user.uid, purchase.id);
      this.notifications.success('Compra excluída com sucesso.');
      if (this.editingPurchaseId && purchase.id === this.editingPurchaseId) {
        this.cancelEditPurchase();
      }
    } catch (err: any) {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    }
  }

  async toggleInstallmentPaid(purchase: PurchaseView, inst: CreditInstallment): Promise<void> {
    if (!purchase?.id) return;

    const accountId = inst.paymentAccountId ?? null;
    if (!accountId) {
      this.notifications.warning('Esta compra não tem uma conta vinculada para pagamento.');
      return;
    }

    const nextPaid = !Boolean(inst.paid);

    const ok = await this.notifications.confirm({
      title: nextPaid ? 'Confirmar pagamento?' : 'Confirmar estorno?',
      message: nextPaid
        ? 'Marcar esta parcela como paga e descontar da conta vinculada?'
        : 'Desmarcar pagamento desta parcela e estornar o desconto?',
      confirmText: nextPaid ? 'Confirmar' : 'Estornar',
      cancelText: 'Cancelar',
      tone: nextPaid ? 'default' : 'danger'
    });
    if (!ok) return;

    const installmentId = inst.id ?? '';
    if (!installmentId) {
      this.notifications.warning('Parcela sem identificador.');
      return;
    }

    const requestKey = this.getInstallmentKey(purchase.id, inst);
    if (this.installmentRequests.has(requestKey)) {
      return;
    }

    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;

    this.installmentRequests.add(requestKey);
    try {
      await this.creditService.setInstallmentPaid(user.uid, {
        purchaseId: purchase.id,
        installmentId,
        accountId,
        paid: nextPaid
      });
    } catch (err: any) {
      this.logAdvanceInstallmentError(err, {
        purchaseId: purchase.id,
        installmentId,
        amount: Number(inst.amount ?? 0),
        dueDate: inst.dueDate ?? null,
        paid: nextPaid
      });
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      this.installmentRequests.delete(requestKey);
    }
  }

  async checkAutoPaidInstallments(purchase: PurchaseView): Promise<void> {
    if (!purchase?.id || !purchase.installments?.length) return;
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;

    const today = toYmdFromLocalDate(new Date());
    for (const inst of purchase.installments) {
      if (!inst || inst.paid || inst.paymentMovementId) continue;
      if (!inst.dueDate) continue;
      if (inst.dueDate > today) continue;
      if (!inst.id || !inst.paymentAccountId) continue;

      try {
        await this.creditService.setInstallmentPaid(user.uid, {
          purchaseId: purchase.id,
          installmentId: inst.id,
          accountId: inst.paymentAccountId,
          paid: true
        });
      } catch (err: any) {
        this.logAdvanceInstallmentError(err, {
          purchaseId: purchase.id,
          installmentId: inst.id,
          amount: Number(inst.amount ?? 0),
          dueDate: inst.dueDate ?? null,
          paid: true
        });
        this.notifications.error('Não foi possível concluir. Tente novamente.');
        return;
      }
    }
  }

  async savePurchase() {
    if (this.purchaseForm.invalid) {
      this.purchaseForm.markAllAsTouched();
      this.notifications.warning('Preencha os campos obrigatórios.');
      return;
    }

    if (this.sameValueEnabled) {
      this.copyFirstInstallmentAmount();
    }

    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    const cards = await firstValueFrom(this.cards$);

    const {
      cardId,
      description,
      categoryId,
      purchaseDate,
      firstDueDate,
      installmentsCount,
      sameValue
    } = this.purchaseForm.value;

    const selectedCard = cards.find((card) => card.id === cardId);
    if (!selectedCard) {
      this.notifications.error('Selecione um cartão válido.');
      return;
    }

    const count = Number(installmentsCount ?? 1);
    const amounts = this.installmentControls.map((ctrl) => Number(ctrl.value ?? 0));
    if (!amounts.length || amounts.some((amount) => amount <= 0)) {
      this.notifications.warning('Informe os valores das parcelas.');
      return;
    }

    this.savingPurchase = true;
    try {
      if (this.editingPurchaseId) {
        const current = this.editingPurchase;
        const currentInstallments = Array.isArray(current?.installments)
          ? current.installments
          : [];
        const dueDates = buildMonthlyDueDates(firstDueDate!, count);
        const editedInstallments = amounts.map((amount, index) => {
          const installmentNumber = index + 1;
          const existing = currentInstallments.find(
            (item) => item.installmentNumber === installmentNumber
          );

          return {
            id: existing?.id,
            purchaseId: current?.id ?? this.editingPurchaseId ?? '',
            cardId: cardId!,
            installmentNumber,
            amount: Number(amount ?? 0),
            dueDate: dueDates[index] || firstDueDate!,
            paymentAccountId: selectedCard.paymentAccountId,
            paid: false,
            paidAt: undefined,
            paymentMovementId: null
          } as CreditInstallment;
        });
        const getInstallmentKey = (item: any) =>
          item?.id ?? item?.installmentId ?? item?.installmentNumber ?? item?.number ?? null;
        const mergedInstallments = editedInstallments.map((edited) => {
          const key = getInstallmentKey(edited);
          const old = currentInstallments.find((item) => getInstallmentKey(item) === key);

          return {
            ...edited,
            paid: old?.paid ?? edited.paid ?? false,
            paidAt: (old?.paidAt ?? edited.paidAt) ?? undefined,
            paymentMovementId: old?.paymentMovementId ?? edited.paymentMovementId ?? null
          };
        });

        await this.creditService.updatePurchaseWithInstallments(
          user.uid,
          this.editingPurchaseId,
          {
            cardId: cardId!,
            description: description!,
            categoryId: categoryId || null,
            purchaseDate: purchaseDate!,
            installmentsCount: count,
            installmentAmounts: amounts,
            sameValue: Boolean(sameValue),
            firstDueDate: firstDueDate!
          },
          selectedCard,
          mergedInstallments
        );
        this.editingPurchaseId = null;
        this.editingPurchase = null;
        this.notifications.success('Compra atualizada com sucesso.');
      } else {
        await this.creditService.addPurchaseWithInstallments(
          user.uid,
          {
            cardId: cardId!,
            description: description!,
            categoryId: categoryId || null,
            purchaseDate: purchaseDate!,
            installmentsCount: count,
            installmentAmounts: amounts,
            sameValue: Boolean(sameValue),
            firstDueDate: firstDueDate!,
            status: 'open'
          },
          selectedCard
        );
        this.notifications.success('Compra cadastrada com sucesso.');
      }
      this.resetPurchaseForm();
    } catch (err: any) {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      this.savingPurchase = false;
    }
  }

  resetPurchaseForm() {
    this.editingPurchaseId = null;
    this.editingPurchase = null;
    this.purchaseForm.reset({
      cardId: '',
      description: '',
      categoryId: '',
      purchaseDate: '',
      firstDueDate: '',
      installmentsCount: 1,
      sameValue: true
    });
    this.syncInstallments(1);
  }

  handleInstallmentInput(index: number) {
    if (!this.sameValueEnabled || index !== 0) {
      return;
    }
    this.copyFirstInstallmentAmount();
  }

  private syncInstallments(count: number) {
    const safeCount = Math.max(1, Math.min(count, 48));
    while (this.installmentsArray.length < safeCount) {
      const firstRaw = this.installmentsArray.at(0)?.value;
      const hasFirstValue = firstRaw !== null && firstRaw !== undefined && firstRaw !== '';
      const initialValue = this.sameValueEnabled
        ? (hasFirstValue ? Number(firstRaw) : null)
        : null;
      this.installmentsArray.push(this.fb.control(initialValue, [Validators.min(0.01)]));
    }
    while (this.installmentsArray.length > safeCount) {
      this.installmentsArray.removeAt(this.installmentsArray.length - 1);
    }
    if (this.sameValueEnabled) {
      this.copyFirstInstallmentAmount();
    }
  }

  private copyFirstInstallmentAmount() {
    const rawValue = this.installmentsArray.at(0)?.value;
    if (rawValue === null || rawValue === undefined || rawValue === '') {
      return;
    }
    const firstValue = Number(rawValue);
    if (!Number.isFinite(firstValue)) {
      return;
    }
    for (let i = 1; i < this.installmentsArray.length; i++) {
      this.installmentsArray.at(i).setValue(firstValue, { emitEvent: false });
    }
  }

  private normalizeInstallmentsCount(value: unknown): number {
    const parsed = Number(value ?? 1);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return 1;
    }
    return Math.min(Math.max(parsed, 1), 48);
  }

  private getInstallmentKey(purchaseId: string, inst: CreditInstallment): string {
    return inst.id || `${purchaseId}-${inst.installmentNumber}`;
  }

  private logAdvanceInstallmentError(
    err: any,
    payload: {
      purchaseId: string;
      installmentId: string;
      amount: number;
      dueDate: string | null;
      paid: boolean;
    }
  ) {
    console.error('[advanceInstallment] error', {
      message: err?.message,
      stack: err?.stack,
      payload
    });
  }

  private async runReconcile() {
    const user = await firstValueFrom(this.auth.user$);
    if (!user) {
      return;
    }
    this.reconciling = true;
    try {
      const processed = await this.reconcileService.reconcile(user.uid);
      if (processed > 0) {
        this.notifications.info(`${processed} parcelas conciliadas.`);
      }
    } catch (err: any) {
      console.error(err);
      this.notifications.error('Falha ao reconciliar parcelas vencidas.');
    } finally {
      this.reconciling = false;
    }
  }
}
