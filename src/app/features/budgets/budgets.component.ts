import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject, combineLatest, firstValueFrom, map, of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { BudgetsService } from '../../core/services/budgets.service';
import { CategoriesService } from '../../core/services/categories.service';
import { TransactionsService } from '../../core/services/transactions.service';
import { Budget } from '../../core/models/budget.model';

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

  message = '';
  editingId: string | null = null;

  selectedMonth = new Date().getMonth() + 1;
  selectedYear = new Date().getFullYear();
  private refresh$ = new BehaviorSubject<void>(undefined);

  form = this.fb.group({
    categoryId: ['', Validators.required],
    limitAmount: [0, [Validators.required, Validators.min(1)]]
  });

  categories$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.categoriesService.list$(user.uid) : of([])))
  );

  budgets$ = combineLatest([this.auth.user$, this.refresh$]).pipe(
    switchMap(([user]) =>
      user ? this.budgetsService.listByMonth$(user.uid, this.selectedMonth, this.selectedYear) : of([])
    )
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
    )
  );

  months = [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
  ].map((label, index) => ({ value: index + 1, label }));

  years = Array.from({ length: 6 }).map((_, i) => this.selectedYear - 2 + i);

  async save() {
    this.message = '';
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    const { categoryId, limitAmount } = this.form.value;

    try {
      if (this.editingId) {
        await this.budgetsService.update(user.uid, this.editingId, {
          limitAmount: Number(limitAmount)
        });
        this.message = 'Meta atualizada.';
      } else {
        await this.budgetsService.add(user.uid, {
          categoryId: categoryId!,
          limitAmount: Number(limitAmount),
          month: this.selectedMonth,
          year: this.selectedYear
        });
        this.message = 'Meta criada.';
      }
      this.resetForm();
      this.refresh$.next();
    } catch (err: any) {
      this.message = err?.message ?? 'Erro ao salvar meta.';
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
    this.refresh$.next();
  }

  resetForm() {
    this.editingId = null;
    this.form.enable();
    this.form.reset({ limitAmount: 0, categoryId: '' });
  }

  changePeriod() {
    this.refresh$.next();
  }

  async delete(budget: Budget) {
    if (!budget.id) return;
    const confirmed = confirm('Excluir esta meta?');
    if (!confirmed) return;
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    try {
      await this.budgetsService.delete(user.uid, budget.id);
      this.message = 'Meta removida.';
      this.refresh$.next();
    } catch (err: any) {
      this.message = err?.message ?? 'Erro ao excluir meta.';
    }
  }

  trackById(_: number, item: Budget) {
    return item.id;
  }
}
