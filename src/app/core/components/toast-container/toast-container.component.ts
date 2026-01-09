import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService, Toast } from '../../services/notification.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast-container.component.html',
  styleUrl: './toast-container.component.css'
})
export class ToastContainerComponent {
  private notifications = inject(NotificationService);

  toasts$ = this.notifications.toasts$;

  trackById(_: number, toast: Toast) {
    return toast.id;
  }

  dismiss(id: string) {
    this.notifications.dismiss(id);
  }

  handleAction(toast: Toast) {
    toast.action?.();
    this.notifications.dismiss(toast.id);
  }

  stop(event: MouseEvent) {
    event.stopPropagation();
  }
}
