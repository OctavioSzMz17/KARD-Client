import { Injectable, signal } from '@angular/core';

export type SnackType = 'success' | 'error' | 'warning' | 'info';

export interface SnackMessage {
  id: number;
  message: string;
  type: SnackType;
}

@Injectable({ providedIn: 'root' })
export class SnackbarService {
  messages = signal<SnackMessage[]>([]);
  private nextId = 0;

  show(message: string, type: SnackType = 'info', duration = 3500): void {
    const id = this.nextId++;
    this.messages.update(msgs => [...msgs, { id, message, type }]);
    setTimeout(() => this.dismiss(id), duration);
  }

  success(message: string) { this.show(message, 'success'); }
  error(message: string)   { this.show(message, 'error', 4500); }
  warning(message: string) { this.show(message, 'warning'); }
  info(message: string)    { this.show(message, 'info'); }

  dismiss(id: number): void {
    this.messages.update(msgs => msgs.filter(m => m.id !== id));
  }
}
