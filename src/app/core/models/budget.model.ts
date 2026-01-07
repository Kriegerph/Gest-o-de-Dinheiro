import { Timestamp } from '@angular/fire/firestore';

export interface Budget {
  id?: string;
  month: number;
  year: number;
  categoryId: string;
  limitAmount: number;
  createdAt: Timestamp;
}
