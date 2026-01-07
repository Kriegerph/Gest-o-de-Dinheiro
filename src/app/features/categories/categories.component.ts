import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject, combineLatest, of, switchMap, map, firstValueFrom } from 'rxjs';
import { CategoriesService } from '../../core/services/categories.service';
import { AuthService } from '../../core/services/auth.service';
import { Category, CategoryType } from '../../core/models/category.model';

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

  message = '';
  editingId: string | null = null;
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
              items.filter((c) => c.name.toLowerCase().includes((term || '').toLowerCase()))
            )
          )
        : of([])
    )
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
    this.message = '';
  }

  toggleCategoryType(next: CategoryType) {
    const current = this.form.get('type')?.value ?? null;
    this.form.get('type')?.setValue(current === next ? null : next);
    this.form.get('type')?.markAsTouched();
  }

  async save() {
    this.message = '';
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    const { name, color, type } = this.form.value;
    try {
      if (this.editingId) {
        await this.categoriesService.update(user.uid, this.editingId, {
          name: name!,
          color: color!,
          type: type!
        });
        this.message = 'Categoria atualizada.';
      } else {
        await this.categoriesService.add(user.uid, {
          name: name!,
          color: color!,
          type: type!
        });
        this.message = 'Categoria adicionada.';
      }
      this.resetForm();
    } catch (err: any) {
      this.message = err?.message ?? 'Erro ao salvar categoria.';
    }
  }

  async delete(category: Category) {
    const confirmed = confirm(`Excluir categoria "${category.name}"?`);
    if (!confirmed || !category.id) return;
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    try {
      await this.categoriesService.delete(user.uid, category.id);
      this.message = 'Categoria removida.';
    } catch (err: any) {
      this.message = err?.message ?? 'Erro ao excluir categoria.';
    }
  }
}
