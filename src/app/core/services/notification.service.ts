import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export type Toast = {
  id: string;
  type: ToastType;
  message: string;
  actionLabel?: string;
  action?: () => void;
};

export type ToastOptions = {
  durationMs?: number;
  actionLabel?: string;
  action?: () => void;
};

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly toastsSubject = new BehaviorSubject<Toast[]>([]);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  readonly toasts$ = this.toastsSubject.asObservable();

  success(message: string, options?: ToastOptions) {
    this.show('success', message, options);
  }

  error(message: string, options?: ToastOptions) {
    this.show('error', message, options);
  }

  info(message: string, options?: ToastOptions) {
    this.show('info', message, options);
  }

  warning(message: string, options?: ToastOptions) {
    this.show('warning', message, options);
  }

  show(type: ToastType, message: string, options?: ToastOptions) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const toast: Toast = {
      id,
      type,
      message,
      actionLabel: options?.actionLabel,
      action: options?.action
    };
    const duration = options?.durationMs ?? (type === 'error' ? 7000 : 4000);

    this.toastsSubject.next([...this.toastsSubject.value, toast]);

    if (duration > 0) {
      const timer = setTimeout(() => this.dismiss(id), duration);
      this.timers.set(id, timer);
    }
  }

  dismiss(id: string) {
    const current = this.toastsSubject.value;
    if (!current.length) {
      return;
    }
    const next = current.filter((toast) => toast.id !== id);
    this.toastsSubject.next(next);
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}
