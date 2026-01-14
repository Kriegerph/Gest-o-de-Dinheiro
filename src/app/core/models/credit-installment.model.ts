import { Timestamp } from '@angular/fire/firestore';

export interface CreditInstallment {
  id?: string;
  purchaseId: string;
  cardId: string;
  installmentNumber: number;
  amount: number;
  dueDate: string;
  paymentAccountId: string;
  paid: boolean;
  paidAt?: Timestamp;
  paymentMovementId?: string | null;
  linkedTransactionId?: string;
  createdAt?: Timestamp;
}
