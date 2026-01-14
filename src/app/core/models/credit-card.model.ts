import { Timestamp } from '@angular/fire/firestore';

export interface CreditCard {
  id?: string;
  name: string;
  brand?: string | null;
  limit?: number | null;
  closingDay?: number | null;
  dueDay: number;
  paymentAccountId: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
