import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialogComponent } from './core/components/confirm-dialog/confirm-dialog.component';
import { ToastContainerComponent } from './core/components/toast-container/toast-container.component';
import { AuthService } from './core/services/auth.service';
import { InvestmentsService } from './features/investments/services/investments.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastContainerComponent, ConfirmDialogComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class AppComponent {
  private auth = inject(AuthService);
  private investmentsService = inject(InvestmentsService);

  constructor() {
    this.auth.user$.subscribe((user) => {
      if (user?.uid) {
        this.investmentsService.runDailyYieldUpdateForUser(user.uid);
      }
    });
  }
}
