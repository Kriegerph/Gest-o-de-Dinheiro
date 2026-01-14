import { Routes } from '@angular/router';
import { redirectGuard, authGuard } from './core/guards/auth.guard';
import { RedirectComponent } from './core/components/redirect.component';
import { LoginComponent } from './features/auth/login/login.component';
import { RegisterComponent } from './features/auth/register/register.component';
import { ShellLayoutComponent } from './features/shell/layout/shell-layout.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { TransactionsComponent } from './features/transactions/transactions.component';
import { AccountsComponent } from './features/accounts/accounts.component';
import { CategoriesComponent } from './features/categories/categories.component';
import { BudgetsComponent } from './features/budgets/budgets.component';
import { ReportsComponent } from './features/reports/reports.component';
import { HelpComponent } from './features/help/help.component';
import { SettingsComponent } from './features/settings/settings.component';
import { CreditComponent } from './features/credit/credit.component';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    component: RedirectComponent,
    canActivate: [redirectGuard]
  },
  {
    path: 'auth',
    children: [
      { path: 'login', component: LoginComponent },
      { path: 'register', component: RegisterComponent },
      { path: '', pathMatch: 'full', redirectTo: 'login' }
    ]
  },
  {
    path: 'app',
    component: ShellLayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: DashboardComponent },
      { path: 'transactions', component: TransactionsComponent },
      { path: 'accounts', component: AccountsComponent },
      { path: 'categories', component: CategoriesComponent },
      { path: 'budgets', component: BudgetsComponent },
      { path: 'reports', component: ReportsComponent },
      { path: 'credit', component: CreditComponent },
      { path: 'ajuda', component: HelpComponent },
      { path: 'settings', component: SettingsComponent },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' }
    ]
  },
  { path: '**', redirectTo: '' }
];
