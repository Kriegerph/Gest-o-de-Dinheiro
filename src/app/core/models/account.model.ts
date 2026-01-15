import { Timestamp } from '@angular/fire/firestore';

export type AccountType = 'cash' | 'bank' | 'investment';

export interface Account {
  id?: string;
  name: string;
  initialBalance: number;
  color?: string;
  type?: AccountType;
  createdAt?: Timestamp;
}
