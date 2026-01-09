import { Component, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
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
import { Transaction, TransactionType } from '../../core/models/transaction.model';
import { formatPtBrFromYmd, toYmd, toYmdFromLocalDate } from '../../shared/utils/date.util';
import { NotificationService } from '../../core/services/notification.service';

type PendingDelete = {
  tx: Transaction;
  uid: string;
  timer: ReturnType<typeof setTimeout>;
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

  transactions$ = this.auth.user$.pipe(
    tap(() => (this.loadingTransactions = true)),
    switchMap((user) => (user ? this.transactionsService.listAll$(user.uid) : of([]))),
    map((items) => items ?? []),
    tap(() => (this.loadingTransactions = false)),
    catchError(() => {
      this.loadingTransactions = false;
      return of([]);
    })
  );

  transactionsView$ = combineLatest([this.transactions$, this.pendingDeleteIds$]).pipe(
    map(([items, pendingIds]) => items.filter((tx) => !pendingIds.has(tx.id ?? '')))
  );

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

  async delete(tx: Transaction) {
    if (!tx.id) return;
    const confirmed = confirm('Excluir este lançamento?');
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
