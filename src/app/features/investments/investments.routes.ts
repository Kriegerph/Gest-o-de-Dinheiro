import { Routes } from '@angular/router';
import { InvestmentsPageComponent } from './pages/investments-page/investments-page.component';
import { InvestmentDetailComponent } from './pages/investment-detail/investment-detail.component';

export const INVESTMENTS_ROUTES: Routes = [
  {
    path: ':id',
    component: InvestmentDetailComponent
  },
  {
    path: '',
    component: InvestmentsPageComponent,
    pathMatch: 'full'
  }
];
