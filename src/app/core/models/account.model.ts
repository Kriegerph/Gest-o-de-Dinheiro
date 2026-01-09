import { Timestamp } from '@angular/fire/firestore';

export interface Account {
  id?: string;
  name: string;
  initialBalance: number;
  color?: string;
  createdAt?: Timestamp;
}
