import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, combineLatest, firstValueFrom, map, of, switchMap, tap } from 'rxjs';
import { AccountsService } from '../../core/services/accounts.service';
import { AuthService } from '../../core/services/auth.service';
import { TransactionsService } from '../../core/services/transactions.service';
import { Account } from '../../core/models/account.model';
import { NotificationService } from '../../core/services/notification.service';

interface AccountView extends Account {
  currentBalance: number;
}

@Component({
  selector: 'app-accounts',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './accounts.component.html',
  styleUrl: './accounts.component.css'
})
export class AccountsComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private accountsService = inject(AccountsService);
  private transactionsService = inject(TransactionsService);
  private notifications = inject(NotificationService);

  editingId: string | null = null;
  loadingAccounts = true;
  saving = false;
  deletingId: string | null = null;
  readonly skeletonRows = Array.from({ length: 5 });

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    initialBalance: [null as number | null, [Validators.required, Validators.min(0)]],
    color: ['#6366f1', Validators.required]
  });

  accounts$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.accountsService.list$(user.uid) : of([]))),
    map((items) => items ?? [])
  );

  transactions$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.transactionsService.listAll$(user.uid) : of([]))),
    map((items) => items ?? [])
  );

  view$ = combineLatest([this.accounts$, this.transactions$]).pipe(
    map(([accounts, transactions]) =>
      accounts.map<AccountView>((account) => {
        const income = transactions
          .filter((tx) => tx.type === 'income' && tx.accountId === account.id)
          .reduce((acc, cur) => acc + cur.amount, 0);
        const expense = transactions
          .filter((tx) => tx.type === 'expense' && tx.accountId === account.id)
          .reduce((acc, cur) => acc + cur.amount, 0);
        const transferOut = transactions
          .filter((tx) => tx.type === 'transfer' && tx.accountOriginId === account.id)
          .reduce((acc, cur) => acc + cur.amount, 0);
        const transferIn = transactions
          .filter((tx) => tx.type === 'transfer' && tx.accountDestinationId === account.id)
          .reduce((acc, cur) => acc + cur.amount, 0);
        const initialBalance = Number(account.initialBalance ?? 0);
        return {
          ...account,
          currentBalance: initialBalance + income - expense - transferOut + transferIn
        };
      })
    ),
    tap(() => (this.loadingAccounts = false)),
    catchError(() => {
      this.loadingAccounts = false;
      return of([] as AccountView[]);
    })
  );

  trackById(_: number, item: Account) {
    return item.id;
  }

  edit(account: Account) {
    this.editingId = account.id || null;
    const initialBalance =
      account.initialBalance === null || account.initialBalance === undefined
        ? null
        : Number(account.initialBalance);
    this.form.patchValue({
      name: account.name,
      initialBalance,
      color: account.color || '#6366f1'
    });
  }

  resetForm() {
    this.editingId = null;
    this.form.reset({ name: '', initialBalance: null, color: '#6366f1' });
  }

  async save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.warning('Preencha os campos obrigatórios.');
      return;
    }
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    const { name, initialBalance, color } = this.form.value;

    this.saving = true;
    try {
      if (this.editingId) {
        await this.accountsService.update(user.uid, this.editingId, {
          name: name!,
          initialBalance: Number(initialBalance ?? 0),
          color: color || '#6366f1'
        });
      } else {
        await this.accountsService.add(user.uid, {
          name: name!,
          initialBalance: Number(initialBalance ?? 0),
          color: color || '#6366f1'
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

  async delete(account: Account) {
    const confirmed = await this.notifications.confirm({
      title: 'Excluir conta?',
      message: `Excluir conta "${account.name}"? Essa ação não pode ser desfeita.`,
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      tone: 'danger'
    });
    if (!confirmed || !account.id) return;
    const user = await firstValueFrom(this.auth.user$);
    if (!user) return;
    this.deletingId = account.id;
    try {
      await this.accountsService.delete(user.uid, account.id);
      this.notifications.success('Excluído com sucesso');
    } catch (err: any) {
      this.notifications.error('Não foi possível concluir. Tente novamente.');
    } finally {
      if (this.deletingId === account.id) {
        this.deletingId = null;
      }
    }
  }
}
