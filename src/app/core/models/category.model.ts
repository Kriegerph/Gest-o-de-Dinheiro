import { Timestamp } from '@angular/fire/firestore';

export type CategoryType = 'income' | 'expense';

export interface Category {
  id?: string;
  name: string;
  color: string;
  type: CategoryType;
  createdAt: Timestamp;
}
