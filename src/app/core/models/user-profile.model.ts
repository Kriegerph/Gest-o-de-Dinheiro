import { Timestamp } from '@angular/fire/firestore';

export interface UserProfile {
  uid: string;
  firstName: string;
  lastName: string;
  birthDate?: string;
  age?: number;
  email: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
