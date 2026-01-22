import { Component, HostListener, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { NotificationService, ConfirmOptions } from '../../services/notification.service';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.css'
})
export class ConfirmDialogComponent implements OnDestroy {
  private notifications = inject(NotificationService);
  private destroy$ = new Subject<void>();

  confirm$ = this.notifications.confirm$;
  state: ConfirmOptions | null = null;

  constructor() {
    this.confirm$.pipe(takeUntil(this.destroy$)).subscribe((confirm) => {
      this.state = confirm;
      if (confirm) {
        document.documentElement.classList.add('no-page-scroll');
        document.body.classList.add('no-page-scroll');
        setTimeout(() => {
          const button = document.querySelector<HTMLButtonElement>('[data-confirm-primary]');
          button?.focus();
        }, 0);
      } else {
        document.documentElement.classList.remove('no-page-scroll');
        document.body.classList.remove('no-page-scroll');
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    document.documentElement.classList.remove('no-page-scroll');
    document.body.classList.remove('no-page-scroll');
  }

  onConfirm() {
    this.notifications.resolveConfirm(true);
  }

  onCancel() {
    this.notifications.resolveConfirm(false);
  }

  stop(event: MouseEvent) {
    event.stopPropagation();
  }

  @HostListener('document:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.state) {
      event.preventDefault();
      this.onCancel();
    }
  }

  @HostListener('document:focusin', ['$event'])
  handleFocus(event: FocusEvent) {
    if (!this.state) {
      return;
    }
    const dialog = document.querySelector<HTMLElement>('[data-confirm-dialog]');
    const target = event.target as HTMLElement | null;
    if (dialog && target && !dialog.contains(target)) {
      event.preventDefault();
      const button = document.querySelector<HTMLButtonElement>('[data-confirm-primary]');
      button?.focus();
    }
  }
}
