import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject, catchError, combineLatest, of, switchMap, map, firstValueFrom, tap } from 'rxjs';
import { CategoriesService } from '../../core/services/categories.service';
import { AuthService } from '../../core/services/auth.service';
import { Category, CategoryType } from '../../core/models/category.model';
import { NotificationService } from '../../core/services/notification.service';

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.css'
})
export class CategoriesComponent {
  private fb = inject(FormBuilder);
  private categoriesService = inject(CategoriesService);
  private auth = inject(AuthService);
  private notifications = inject(NotificationService);

  editingId: string | null = null;
  loadingCategories = true;
  saving = false;
  deletingId: string | null = null;
  readonly skeletonRows = Array.from({ length: 5 });
  private searchTerm$ = new BehaviorSubject<string>('');

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    color: ['#6366f1', Validators.required],
    type: new FormControl<CategoryType | null>(null, Validators.required)
  });

  categories$ = combineLatest([this.auth.user$, this.searchTerm$]).pipe(
    switchMap(([user, term]) =>
      user
        ? this.categoriesService.list$(user.uid).pipe(
            map((items) =>
              (items ?? []).filter((c) => c.name.toLowerCase().includes((term || '').toLowerCase()))
            )
          )
        : of([])
    ),
    tap(() => (this.loadingCategories = false)),
    catchError(() => {
      this.loadingCategories = false;
      return of([] as Category[]);
    })
  );

  trackById(_: number, item: Category) {
    return item.id;
  }

  setSearch(term: string) {
    this.searchTerm$.next(term);
  }

  edit(category: Category) {
    this.editingId = category.id || null;
    this.form.patchValue({
      name: category.name,
      color: category.color,
      type: category.type ?? 'expense'
    });
  }

  resetForm() {
    this.editingId = null;
    this.form.reset({ color: '#6366f1', type: null });
  }

  toggleCategoryType(next: CategoryType) {
    const current = this.form.get('type')?.value ?? null;
    this.form.get('type')?.setValue(current === next ? null : next);
    this.form.get('type')?.markAsTouched();
  }

  async save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.warning('Preencha os campos obrigatórios.');
      return;
    }
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    const { name, color, type } = this.form.value;
    this.saving = true;
    try {
      if (this.editingId) {
        await this.categoriesService.update(user.uid, this.editingId, {
          name: name!,
          color: color!,
          type: type!
        });
      } else {
        await this.categoriesService.add(user.uid, {
          name: name!,
          color: color!,
          type: type!
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

  async delete(category: Category) {
    const confirmed = confirm(`Excluir categoria "${category.name}"?`);
    if (!confirmed || !category.id) return;
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    this.deletingId = category.id;
    try {
      await this.categoriesService.delete(user.uid, category.id);
      this.notifications.success('Excluído com sucesso');
    } catch (err: any) {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      if (this.deletingId === category.id) {
        this.deletingId = null;
      }
    }
  }
}
