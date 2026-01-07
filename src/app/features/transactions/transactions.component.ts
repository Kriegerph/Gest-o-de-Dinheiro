import { Component, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { combineLatest, firstValueFrom, map, of, startWith, Subscription, switchMap } from 'rxjs';
import { TransactionsService } from '../../core/services/transactions.service';
import { AuthService } from '../../core/services/auth.service';
import { CategoriesService } from '../../core/services/categories.service';
import { Transaction, TransactionType } from '../../core/models/transaction.model';
import { formatPtBrFromYmd, toYmd, toYmdFromLocalDate } from '../../shared/utils/date.util';

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
  private typeSub?: Subscription;

  message = '';
  messageType: 'success' | 'danger' | 'info' = 'info';
  editingId: string | null = null;
  today = toYmdFromLocalDate(new Date());

  categories$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.categoriesService.list$(user.uid) : of([])))
  );

  transactions$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.transactionsService.listAll$(user.uid) : of([])))
  );

  form = this.fb.group({
    type: new FormControl<TransactionType | null>(null, Validators.required),
    description: ['', [Validators.required, Validators.minLength(2)]],
    amount: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    date: [this.today, Validators.required],
    categoryId: new FormControl<string>({ value: '', disabled: true }, Validators.required),
    notes: ['']
  });

  filteredCategories$ = combineLatest([
    this.categories$,
    this.form.get('type')!.valueChanges.pipe(startWith(this.form.get('type')!.value))
  ]).pipe(
    map(([categories, type]) => {
      if (!type) {
        return [];
      }
      return categories.filter((category) => category.type === type);
    })
  );

  constructor() {
    const syncCategoryState = (value: TransactionType | null) => {
      const categoryControl = this.form.get('categoryId');
      if (!categoryControl) {
        return;
      }
      if (value) {
        categoryControl.enable({ emitEvent: false });
      } else {
        categoryControl.setValue('', { emitEvent: false });
        categoryControl.disable({ emitEvent: false });
      }
      categoryControl.updateValueAndValidity({ emitEvent: false });
    };

    syncCategoryState(this.form.get('type')?.value ?? null);

    this.typeSub = this.form.get('type')?.valueChanges.subscribe((value) => {
      syncCategoryState(value);
    });
  }

  toggleType(next: TransactionType) {
    const current = this.form.get('type')?.value ?? null;
    this.form.get('type')?.setValue(current === next ? null : next);
    this.form.get('type')?.markAsTouched();
  }

  ngOnDestroy(): void {
    this.typeSub?.unsubscribe();
  }

  async save() {
    this.message = '';
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.messageType = 'danger';
      this.message = 'Preencha os campos obrigatorios.';
      return;
    }

    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    const { type, description, amount, date, categoryId, notes } = this.form.value;
    const amountValue = Number(amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      return;
    }

    try {
      if (this.editingId) {
        await this.transactionsService.update(user.uid, this.editingId, {
          type: type!,
          description: description!,
          amount: amountValue,
          date: date!,
          categoryId: categoryId!,
          notes: notes || ''
        });
        this.messageType = 'success';
        this.message = 'Lançamento atualizado.';
      } else {
        await this.transactionsService.add(user.uid, {
          type: type!,
          description: description!,
          amount: amountValue,
          date: date!,
          categoryId: categoryId!,
          notes: notes || ''
        });
        this.messageType = 'success';
        this.message = 'Lançamento criado.';
      }
      this.resetForm();
    } catch (err: any) {
      this.messageType = 'danger';
      this.message = err?.message ?? 'Erro ao salvar lançamento.';
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
      notes: ''
    });
    this.form.get('categoryId')?.disable({ emitEvent: false });
    this.messageType = 'info';
  }

  async delete(tx: Transaction) {
    if (!tx.id) return;
    const confirmed = confirm('Excluir este lançamento?');
    if (!confirmed) return;
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    try {
      await this.transactionsService.delete(user.uid, tx.id);
      this.messageType = 'success';
      this.message = 'Lançamento excluído.';
    } catch (err: any) {
      this.messageType = 'danger';
      this.message = err?.message ?? 'Erro ao excluir lançamento.';
    }
  }

  getCategoryName(categories: any[], categoryId?: string | null) {
    if (!categoryId) {
      return 'N/A';
    }
    return categories.find((item) => item.id === categoryId)?.name || 'Categoria removida';
  }

  trackById(_: number, item: Transaction) {
    return item.id;
  }

  formatDate(ymd: string): string {
    return formatPtBrFromYmd(ymd);
  }
}
