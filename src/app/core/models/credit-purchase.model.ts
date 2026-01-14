import { Timestamp } from '@angular/fire/firestore';

export type CreditPurchaseStatus = 'open' | 'closed';

export interface CreditPurchase {
  id?: string;
  cardId: string;
  description: string;
  categoryId?: string | null;
  purchaseDate: string;
  installmentsCount: number;
  installmentAmounts: number[];
  sameValue: boolean;
  firstDueDate: string;
  status?: CreditPurchaseStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
