import { Component, HostListener, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  debounceTime,
  firstValueFrom,
  map,
  of,
  startWith,
  Subscription,
  switchMap,
  tap
} from 'rxjs';
import { TransactionsService } from '../../core/services/transactions.service';
import { AuthService } from '../../core/services/auth.service';
import { CategoriesService } from '../../core/services/categories.service';
import { AccountsService } from '../../core/services/accounts.service';
import { Account } from '../../core/models/account.model';
import { Category } from '../../core/models/category.model';
import { Transaction, TransactionType } from '../../core/models/transaction.model';
import { formatPtBrFromYmd, toYmd, toYmdFromLocalDate } from '../../shared/utils/date.util';
import { NotificationService } from '../../core/services/notification.service';

type PendingDelete = {
  tx: Transaction;
  uid: string;
  timer: ReturnType<typeof setTimeout>;
};

type TransactionFilterType = 'all' | 'income' | 'expense';

type TransactionFiltersFormValue = {
  categoryId: string | null;
  type: TransactionFilterType | null;
  accountId: string | null;
  q: string | null;
  dateFrom: string | null;
  dateTo: string | null;
};

type TransactionFilters = {
  categoryId: string | null;
  type: TransactionFilterType;
  accountId: string | null;
  q: string;
  dateFrom: string | null;
  dateTo: string | null;
};

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.css'
})
export class TransactionsComponent implements OnDestroy {
  private fb = inject(FormBuilder);
  private transactionsService = inject(TransactionsService);
  private auth = inject(AuthService);
  private categoriesService = inject(CategoriesService);
  private accountsService = inject(AccountsService);
  private notifications = inject(NotificationService);
  private typeSub?: Subscription;

  editingId: string | null = null;
  today = toYmdFromLocalDate(new Date());
  loadingTransactions = true;
  saving = false;
  readonly skeletonRows = Array.from({ length: 6 });
  private pendingDeleteIds$ = new BehaviorSubject<Set<string>>(new Set());
  private pendingDeletes = new Map<string, PendingDelete>();

  categories$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.categoriesService.list$(user.uid) : of([]))),
    map((items) => items ?? [])
  );

  accounts$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.accountsService.list$(user.uid) : of([]))),
    map((items) => items ?? [])
  );

  private readonly filterDefaults: TransactionFilters = {
    categoryId: null,
    type: 'all',
    accountId: null,
    q: '',
    dateFrom: null,
    dateTo: null
  };

  filtersForm = this.fb.group({
    categoryId: new FormControl<string | null>(this.filterDefaults.categoryId),
    type: new FormControl<TransactionFilterType>(this.filterDefaults.type),
    accountId: new FormControl<string | null>(this.filterDefaults.accountId),
    q: new FormControl<string>(this.filterDefaults.q),
    dateFrom: new FormControl<string | null>(this.filterDefaults.dateFrom),
    dateTo: new FormControl<string | null>(this.filterDefaults.dateTo)
  });

  filtersDraftForm = this.fb.group({
    categoryId: new FormControl<string | null>(this.filterDefaults.categoryId),
    type: new FormControl<TransactionFilterType>(this.filterDefaults.type),
    accountId: new FormControl<string | null>(this.filterDefaults.accountId),
    q: new FormControl<string>(this.filterDefaults.q),
    dateFrom: new FormControl<string | null>(this.filterDefaults.dateFrom),
    dateTo: new FormControl<string | null>(this.filterDefaults.dateTo)
  });

  isFiltersOpen = false;

  filters$ = this.filtersForm.valueChanges.pipe(
    debounceTime(200),
    startWith(this.filtersForm.getRawValue()),
    map((value) => this.normalizeFilters(value as TransactionFiltersFormValue))
  );

  hasActiveFilters$ = this.filters$.pipe(map((filters) => this.isActiveFilters(filters)));

  activeFilterChips$ = combineLatest([this.filters$, this.categories$, this.accounts$]).pipe(
    map(([filters, categories, accounts]) => this.buildFilterChips(filters, categories, accounts))
  );

  transactions$ = this.auth.user$.pipe(
    tap(() => (this.loadingTransactions = true)),
    switchMap((user) => (user ? this.transactionsService.listAll$(user.uid) : of([]))),
    map((items) => (items ?? []).slice().sort((a: any, b: any) => {
      // 1) Data do lançamento DESC
      // se for string YYYY-MM-DD, comparar direto resolve.
      const ad = a.date ?? a.data;
      const bd = b.date ?? b.data;

      if (typeof ad === 'string' && typeof bd === 'string' && ad !== bd) {
        return bd.localeCompare(ad); // desc
      }

      const da = toMillis(ad);
      const db = toMillis(bd);
      if (db !== da) return db - da;

      // 2) createdAt DESC (se existir)
      const ca = toMillis(a.createdAt);
      const cb = toMillis(b.createdAt);
      if (cb !== ca) return cb - ca;

      // 3) updatedAt DESC (se existir)
      const ua = toMillis(a.updatedAt);
      const ub = toMillis(b.updatedAt);
      if (ub !== ua) return ub - ua;

      // 4) desempate estável por id DESC
      const ia = stableHashId(a.id);
      const ib = stableHashId(b.id);
      return ib - ia;
    })),
    tap(() => (this.loadingTransactions = false)),
    catchError(() => {
      this.loadingTransactions = false;
      return of([]);
    })
  );

  filteredTransactions$ = combineLatest([this.transactions$, this.filters$, this.categories$]).pipe(
    map(([items, filters, categories]) => this.applyFilters(items, filters, categories))
  );

  transactionsView$ = combineLatest([this.filteredTransactions$, this.pendingDeleteIds$]).pipe(
    map(([items, pendingIds]) => items.filter((tx) => !pendingIds.has(tx.id ?? '')))
  );

  transactionsCount$ = this.transactionsView$.pipe(map((items) => items.length));

  form = this.fb.group({
    type: new FormControl<TransactionType | null>(null, Validators.required),
    description: ['', [Validators.required, Validators.minLength(2)]],
    amount: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    date: [this.today, Validators.required],
    categoryId: new FormControl<string>({ value: '', disabled: true }, Validators.required),
    accountId: new FormControl<string>('', Validators.required),
    accountOriginId: new FormControl<string>({ value: '', disabled: true }, Validators.required),
    accountDestinationId: new FormControl<string>({ value: '', disabled: true }, Validators.required),
    notes: ['']
  });

  filteredCategories$ = combineLatest([
    this.categories$,
    this.form.get('type')!.valueChanges.pipe(startWith(this.form.get('type')!.value))
  ]).pipe(
    map(([categories, type]) => {
      if (!type || type === 'transfer') {
        return [];
      }
      return categories.filter((category) => category.type === type);
    })
  );

  constructor() {
    const syncTypeState = (value: TransactionType | null) => {
      const categoryControl = this.form.get('categoryId');
      const accountControl = this.form.get('accountId');
      const originControl = this.form.get('accountOriginId');
      const destinationControl = this.form.get('accountDestinationId');
      if (!categoryControl || !accountControl || !originControl || !destinationControl) {
        return;
      }
      if (value === 'transfer') {
        categoryControl.setValue('', { emitEvent: false });
        categoryControl.disable({ emitEvent: false });
        categoryControl.clearValidators();
        accountControl.setValue('', { emitEvent: false });
        accountControl.disable({ emitEvent: false });
        accountControl.clearValidators();
        originControl.enable({ emitEvent: false });
        destinationControl.enable({ emitEvent: false });
        originControl.setValidators([Validators.required]);
        destinationControl.setValidators([Validators.required]);
      } else if (value) {
        categoryControl.enable({ emitEvent: false });
        categoryControl.setValidators([Validators.required]);
        accountControl.enable({ emitEvent: false });
        accountControl.setValidators([Validators.required]);
        originControl.setValue('', { emitEvent: false });
        destinationControl.setValue('', { emitEvent: false });
        originControl.disable({ emitEvent: false });
        destinationControl.disable({ emitEvent: false });
        originControl.clearValidators();
        destinationControl.clearValidators();
      } else {
        categoryControl.setValue('', { emitEvent: false });
        categoryControl.disable({ emitEvent: false });
        categoryControl.clearValidators();
        accountControl.setValue('', { emitEvent: false });
        accountControl.disable({ emitEvent: false });
        accountControl.clearValidators();
        originControl.setValue('', { emitEvent: false });
        destinationControl.setValue('', { emitEvent: false });
        originControl.disable({ emitEvent: false });
        destinationControl.disable({ emitEvent: false });
        originControl.clearValidators();
        destinationControl.clearValidators();
      }
      categoryControl.updateValueAndValidity({ emitEvent: false });
      accountControl.updateValueAndValidity({ emitEvent: false });
      originControl.updateValueAndValidity({ emitEvent: false });
      destinationControl.updateValueAndValidity({ emitEvent: false });
    };

    syncTypeState(this.form.get('type')?.value ?? null);

    this.typeSub = this.form.get('type')?.valueChanges.subscribe((value) => {
      syncTypeState(value);
    });
  }

  toggleType(next: TransactionType) {
    const current = this.form.get('type')?.value ?? null;
    this.form.get('type')?.setValue(current === next ? null : next);
    this.form.get('type')?.markAsTouched();
  }

  @HostListener('document:keydown.escape', ['$event'])
  handleEscape(event: Event) {
    if (!this.isFiltersOpen) {
      return;
    }
    event.preventDefault();
    this.closeFilters();
  }

  ngOnDestroy(): void {
    this.typeSub?.unsubscribe();
    void this.flushPendingDeletes();
  }

  async save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.warning('Preencha os campos obrigatórios.');
      return;
    }

    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    const {
      type,
      description,
      amount,
      date,
      categoryId,
      accountId,
      accountOriginId,
      accountDestinationId,
      notes
    } = this.form.value;
    const amountValue = Number(amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      this.notifications.warning('Preencha os campos obrigatórios.');
      return;
    }

    this.saving = true;
    try {
      if (type === 'transfer' && accountOriginId === accountDestinationId) {
        this.notifications.error('Não foi possível concluir. Tente novamente.');
        return;
      }
      if (this.editingId) {
        await this.transactionsService.update(user.uid, this.editingId, {
          type: type!,
          description: description!,
          amount: amountValue,
          date: date!,
          categoryId: type === 'transfer' ? null : categoryId!,
          accountId: type === 'transfer' ? null : accountId!,
          accountOriginId: type === 'transfer' ? accountOriginId! : null,
          accountDestinationId: type === 'transfer' ? accountDestinationId! : null,
          notes: notes || ''
        });
      } else {
        await this.transactionsService.add(user.uid, {
          type: type!,
          description: description!,
          amount: amountValue,
          date: date!,
          categoryId: type === 'transfer' ? null : categoryId!,
          accountId: type === 'transfer' ? null : accountId!,
          accountOriginId: type === 'transfer' ? accountOriginId! : null,
          accountDestinationId: type === 'transfer' ? accountDestinationId! : null,
          notes: notes || ''
        });
      }
      this.notifications.success('Salvo com sucesso');
      this.resetForm();
    } catch (err: any) {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      this.saving = false;
    }
  }

  edit(tx: Transaction) {
    this.editingId = tx.id || null;
    this.form.patchValue({
      type: tx.type,
      description: tx.description,
      amount: tx.amount,
      date: toYmd(tx.date),
      categoryId: tx.categoryId || '',
      accountId: tx.accountId || '',
      accountOriginId: tx.accountOriginId || '',
      accountDestinationId: tx.accountDestinationId || '',
      notes: tx.notes || ''
    });
  }

  resetForm() {
    this.editingId = null;
    this.form.reset({
      type: null,
      description: '',
      amount: null,
      date: toYmdFromLocalDate(new Date()),
      categoryId: '',
      accountId: '',
      accountOriginId: '',
      accountDestinationId: '',
      notes: ''
    });
    this.form.get('categoryId')?.disable({ emitEvent: false });
    this.form.get('accountId')?.disable({ emitEvent: false });
    this.form.get('accountOriginId')?.disable({ emitEvent: false });
    this.form.get('accountDestinationId')?.disable({ emitEvent: false });
  }

  toggleFilters() {
    if (this.isFiltersOpen) {
      this.closeFilters();
      return;
    }
    this.openFilters();
  }

  openFilters() {
    this.filtersDraftForm.reset(this.filtersForm.getRawValue());
    this.isFiltersOpen = true;
  }

  closeFilters() {
    this.isFiltersOpen = false;
  }

  applyDraftFilters() {
    this.filtersForm.reset(this.filtersDraftForm.getRawValue());
    this.isFiltersOpen = false;
  }

  applyFiltersAndClose() {
    this.applyDraftFilters();
  }

  clearFiltersAndClose() {
    const hadActive = this.isActiveFilters(
      this.normalizeFilters(this.filtersForm.getRawValue() as TransactionFiltersFormValue)
    );
    this.filtersDraftForm.reset(this.filterDefaults);
    this.filtersForm.reset(this.filterDefaults);
    if (hadActive) {
      this.notifications.info('Filtros limpos.');
    }
    this.isFiltersOpen = false;
  }

  async delete(tx: Transaction) {
    if (!tx.id) return;
    const confirmed = await this.notifications.confirm({
      title: 'Excluir lançamento?',
      message: 'Essa ação remove o lançamento. Você pode desfazer nos próximos 5 segundos.',
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      tone: 'danger'
    });
    if (!confirmed) return;
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    if (this.pendingDeletes.has(tx.id)) {
      return;
    }
    const timer = setTimeout(() => {
      void this.commitDelete(tx.id!);
    }, 5000);
    this.pendingDeletes.set(tx.id, { tx, uid: user.uid, timer });
    this.refreshPendingIds();
    this.notifications.info('Lançamento removido. Você pode desfazer.', {
      durationMs: 5000,
      actionLabel: 'Desfazer',
      action: () => this.undoDelete(tx.id!)
    });
  }

  getCategoryName(categories: any[], categoryId?: string | null) {
    if (!categoryId) {
      return 'N/A';
    }
    return categories.find((item) => item.id === categoryId)?.name || 'Categoria removida';
  }

  getAccountName(accounts: Account[], accountId?: string | null) {
    if (!accountId) {
      return 'Sem conta';
    }
    return accounts.find((item) => item.id === accountId)?.name || 'Conta removida';
  }

  getTransferLabel(accounts: Account[], tx: Transaction) {
    const origin = this.getAccountName(accounts, tx.accountOriginId);
    const destination = this.getAccountName(accounts, tx.accountDestinationId);
    return `${origin} -> ${destination}`;
  }

  trackById(_: number, item: Transaction) {
    return item.id;
  }

  formatDate(ymd: string): string {
    return formatPtBrFromYmd(ymd);
  }

  private normalizeFilters(value: TransactionFiltersFormValue | null | undefined): TransactionFilters {
    return {
      categoryId: value?.categoryId ?? null,
      type: value?.type ?? this.filterDefaults.type,
      accountId: value?.accountId ?? null,
      q: (value?.q ?? '').toString().trim(),
      dateFrom: normalizeDateInput(value?.dateFrom ?? null),
      dateTo: normalizeDateInput(value?.dateTo ?? null)
    };
  }

  private isActiveFilters(filters: TransactionFilters): boolean {
    return Boolean(
      filters.categoryId ||
      filters.accountId ||
      (filters.type && filters.type !== 'all') ||
      normalizeText(filters.q) ||
      filters.dateFrom ||
      filters.dateTo
    );
  }

  private buildFilterChips(filters: TransactionFilters, categories: Category[], accounts: Account[]): string[] {
    const chips: string[] = [];
    if (filters.categoryId) {
      const categoryName = categories.find((item) => item.id === filters.categoryId)?.name ?? 'Categoria';
      chips.push(`Categoria: ${categoryName}`);
    }
    if (filters.type && filters.type !== 'all') {
      chips.push(`Tipo: ${filters.type === 'income' ? 'Entrada' : 'Saida'}`);
    }
    if (filters.accountId) {
      const accountName = accounts.find((item) => item.id === filters.accountId)?.name ?? 'Conta';
      chips.push(`Conta: ${accountName}`);
    }
    if (filters.q) {
      chips.push(`Busca: ${filters.q}`);
    }
    if (filters.dateFrom) {
      chips.push(`De: ${formatPtBrFromYmd(filters.dateFrom)}`);
    }
    if (filters.dateTo) {
      chips.push(`Ate: ${formatPtBrFromYmd(filters.dateTo)}`);
    }
    return chips;
  }

  private applyFilters(items: Transaction[], filters: TransactionFilters, categories: Category[]): Transaction[] {
    if (!items.length) return items;
    const q = normalizeText(filters.q);
    const categoryNameById = new Map(
      categories.map((category) => [category.id ?? '', normalizeText(category.name)])
    );
    return items.filter((tx) => {
      if (filters.dateFrom || filters.dateTo) {
        const dateKey = normalizeTxDateToKey(tx);
        if (!dateKey) {
          return false;
        }
        if (filters.dateFrom && dateKey < filters.dateFrom) {
          return false;
        }
        if (filters.dateTo && dateKey > filters.dateTo) {
          return false;
        }
      }
      if (filters.categoryId && tx.categoryId !== filters.categoryId) {
        return false;
      }
      if (filters.type && filters.type !== 'all' && tx.type !== filters.type) {
        return false;
      }
      if (filters.accountId) {
        const matchesAccount =
          tx.accountId === filters.accountId ||
          tx.accountOriginId === filters.accountId ||
          tx.accountDestinationId === filters.accountId;
        if (!matchesAccount) {
          return false;
        }
      }
      if (q) {
        const categoryName = categoryNameById.get(tx.categoryId ?? '') ?? '';
        const matchesQuery =
          normalizeText(tx.description).includes(q) ||
          normalizeText(tx.notes).includes(q) ||
          categoryName.includes(q);
        if (!matchesQuery) {
          return false;
        }
      }
      return true;
    });
  }

  private refreshPendingIds() {
    this.pendingDeleteIds$.next(new Set(this.pendingDeletes.keys()));
  }

  private undoDelete(id: string) {
    const pending = this.pendingDeletes.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingDeletes.delete(id);
    this.refreshPendingIds();
    this.notifications.info('Exclusão desfeita.');
  }

  private async commitDelete(id: string) {
    const pending = this.pendingDeletes.get(id);
    if (!pending) {
      return;
    }
    this.pendingDeletes.delete(id);
    this.refreshPendingIds();
    try {
      await this.transactionsService.delete(pending.uid, id);
      this.notifications.success('Excluído com sucesso');
    } catch {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    }
  }

  private async flushPendingDeletes() {
    const pending = Array.from(this.pendingDeletes.values());
    this.pendingDeletes.clear();
    this.refreshPendingIds();
    await Promise.all(
      pending.map(async (item) => {
        clearTimeout(item.timer);
        if (item.tx.id) {
          try {
            await this.transactionsService.delete(item.uid, item.tx.id);
          } catch {
            // ignore to avoid blocking navigation
          }
        }
      })
    );
  }
}

function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis(); // Firestore Timestamp
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    // tenta ISO ou YYYY-MM-DD
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function stableHashId(id?: string | null): number {
  if (!id) return 0;
  let acc = 0;
  for (let i = 0; i < id.length; i++) {
    acc = (acc * 31 + id.charCodeAt(i)) >>> 0;
  }
  return acc;
}

function normalizeText(value?: string | null): string {
  return (value ?? '').toString().toLowerCase().trim();
}

function normalizeDateInput(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.toString().trim();
  return trimmed ? trimmed : null;
}

function normalizeTxDateToKey(tx: Transaction): string {
  const raw = (tx as any).date ?? (tx as any).data;
  return normalizeDateKey(raw);
}

function normalizeDateKey(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
    if (brMatch) {
      return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return toYmdFromLocalDate(new Date(parsed));
    }
  }
  if (typeof value?.toDate === 'function') {
    return toYmdFromLocalDate(value.toDate());
  }
  if (typeof value?.toMillis === 'function') {
    return toYmdFromLocalDate(new Date(value.toMillis()));
  }
  if (value instanceof Date) {
    return toYmdFromLocalDate(value);
  }
  if (typeof value === 'number') {
    return toYmdFromLocalDate(new Date(value));
  }
  return '';
}

