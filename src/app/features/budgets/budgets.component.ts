import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject, catchError, combineLatest, firstValueFrom, map, of, switchMap, tap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { BudgetsService } from '../../core/services/budgets.service';
import { CategoriesService } from '../../core/services/categories.service';
import { TransactionsService } from '../../core/services/transactions.service';
import { Budget } from '../../core/models/budget.model';
import { NotificationService } from '../../core/services/notification.service';

interface BudgetView extends Budget {
  categoryName: string;
  spent: number;
  remaining: number;
  percent: number;
}

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.css'
})
export class BudgetsComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private budgetsService = inject(BudgetsService);
  private categoriesService = inject(CategoriesService);
  private transactionsService = inject(TransactionsService);
  private notifications = inject(NotificationService);

  editingId: string | null = null;
  loadingBudgets = true;
  saving = false;
  deletingId: string | null = null;
  readonly skeletonRows = Array.from({ length: 3 });
  private warnedKeys = new Set<string>();

  selectedMonth = new Date().getMonth() + 1;
  selectedYear = new Date().getFullYear();
  private refresh$ = new BehaviorSubject<void>(undefined);

  form = this.fb.group({
    categoryId: ['', Validators.required],
    limitAmount: [null as number | null, [Validators.required, Validators.min(1)]]
  });

  categories$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.categoriesService.list$(user.uid) : of([]))),
    map((items) => items ?? [])
  );

  budgets$ = combineLatest([this.auth.user$, this.refresh$]).pipe(
    switchMap(([user]) =>
      user ? this.budgetsService.listByMonth$(user.uid, this.selectedMonth, this.selectedYear) : of([])
    ),
    map((items) => items ?? [])
  );

  expenses$ = combineLatest([this.auth.user$, this.refresh$]).pipe(
    switchMap(([user]) =>
      user
        ? this.transactionsService.listMonthExpensesByCategory$(
            user.uid,
            this.selectedMonth,
            this.selectedYear
          )
        : of({} as Record<string, number>)
    )
  );

  view$ = combineLatest([this.budgets$, this.categories$, this.expenses$]).pipe(
    map(([budgets, categories, expenses]) =>
      budgets.map<BudgetView>((budget) => {
        const spent = expenses[budget.categoryId] || 0;
        const remaining = budget.limitAmount - spent;
        const percent = budget.limitAmount
          ? Math.min(100, Math.round((spent / budget.limitAmount) * 100))
          : 0;
        const categoryName = categories.find((c) => c.id === budget.categoryId)?.name || 'Categoria';
        return { ...budget, spent, remaining, percent, categoryName };
      })
    ),
    tap((items) => {
      this.loadingBudgets = false;
      this.checkBudgetAlerts(items);
    }),
    catchError(() => {
      this.loadingBudgets = false;
      return of([] as BudgetView[]);
    })
  );

  months = [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
  ].map((label, index) => ({ value: index + 1, label }));

  years = Array.from({ length: 6 }).map((_, i) => this.selectedYear - 2 + i);

  async save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.warning('Preencha os campos obrigatórios.');
      return;
    }
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    const { categoryId, limitAmount } = this.form.value;

    this.saving = true;
    try {
      if (this.editingId) {
        await this.budgetsService.update(user.uid, this.editingId, {
          limitAmount: Number(limitAmount)
        });
      } else {
        await this.budgetsService.add(user.uid, {
          categoryId: categoryId!,
          limitAmount: Number(limitAmount),
          month: this.selectedMonth,
          year: this.selectedYear
        });
      }
      this.notifications.success('Salvo com sucesso');
      this.resetForm();
      this.loadingBudgets = true;
      this.refresh$.next();
    } catch (err: any) {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      this.saving = false;
    }
  }

  edit(budget: Budget) {
    this.editingId = budget.id || null;
    this.selectedMonth = budget.month;
    this.selectedYear = budget.year;
    this.form.patchValue({
      categoryId: budget.categoryId,
      limitAmount: budget.limitAmount
    });
    this.form.get('categoryId')?.disable();
    this.loadingBudgets = true;
    this.refresh$.next();
  }

  resetForm() {
    this.editingId = null;
    this.form.enable();
    this.form.reset({ limitAmount: null, categoryId: '' });
  }

  changePeriod() {
    this.loadingBudgets = true;
    this.refresh$.next();
  }

  async delete(budget: Budget) {
    if (!budget.id) return;
    const confirmed = confirm('Excluir esta meta?');
    if (!confirmed) return;
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    this.deletingId = budget.id;
    try {
      await this.budgetsService.delete(user.uid, budget.id);
      this.notifications.success('Excluído com sucesso');
      this.loadingBudgets = true;
      this.refresh$.next();
    } catch (err: any) {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      if (this.deletingId === budget.id) {
        this.deletingId = null;
      }
    }
  }

  trackById(_: number, item: Budget) {
    return item.id;
  }

  private checkBudgetAlerts(items: BudgetView[]) {
    items.forEach((item) => {
      if (!item.id && !item.categoryId) {
        return;
      }
      if (item.percent >= 100) {
        const key = this.buildAlertKey(item, '100');
        if (!this.hasAlerted(key)) {
          this.notifications.error('Meta excedida. Verifique os detalhes.');
          this.markAlerted(key);
        }
        return;
      }
      if (item.percent >= 80) {
        const key = this.buildAlertKey(item, '80');
        if (!this.hasAlerted(key)) {
          this.notifications.warning('Atingiu 80% da meta.');
          this.markAlerted(key);
        }
      }
    });
  }

  private buildAlertKey(item: BudgetView, level: '80' | '100') {
    const base = item.id || item.categoryId || 'meta';
    return `budget-alert-${base}-${item.month}-${item.year}-${level}`;
  }

  private hasAlerted(key: string) {
    if (this.warnedKeys.has(key)) {
      return true;
    }
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  private markAlerted(key: string) {
    this.warnedKeys.add(key);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, '1');
      }
    } catch {
      // ignore
    }
  }
}
