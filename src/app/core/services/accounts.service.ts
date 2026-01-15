import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from '@angular/fire/firestore';
import { map, Observable } from 'rxjs';
import { Account } from '../models/account.model';

@Injectable({
  providedIn: 'root'
})
export class AccountsService {
  private firestore = inject(Firestore);

  list$(uid: string): Observable<Account[]> {
    const ref = collection(this.firestore, `users/${uid}/accounts`);
    const q = query(ref, orderBy('name'), limit(1000));
    return collectionData(q, { idField: 'id' }).pipe(
      map((items) =>
        (items as Account[]).map((item) => ({
          ...item,
          initialBalance: Number(item.initialBalance ?? 0),
          type: item.type ?? 'bank'
        }))
      )
    );
  }

  async add(uid: string, data: Omit<Account, 'id' | 'createdAt'>): Promise<void> {
    const ref = collection(this.firestore, `users/${uid}/accounts`);
    await addDoc(ref, {
      ...data,
      type: data.type ?? 'bank',
      initialBalance: Number(data.initialBalance ?? 0),
      createdAt: serverTimestamp()
    });
  }

  async update(uid: string, id: string, data: Partial<Account>): Promise<void> {
    const ref = doc(this.firestore, `users/${uid}/accounts/${id}`);
    await updateDoc(ref, {
      ...data,
      ...(data.initialBalance !== undefined
        ? { initialBalance: Number(data.initialBalance) }
        : {})
    });
  }

  async delete(uid: string, id: string): Promise<void> {
    const txRef = collection(this.firestore, `users/${uid}/transactions`);
    const txQuery = query(txRef, where('accountId', '==', id), limit(1));
    const txSnap = await getDocs(txQuery);
    if (!txSnap.empty) {
      throw new Error('Conta em uso em lançamentos. Não é possível excluir.');
    }

    const ref = doc(this.firestore, `users/${uid}/accounts/${id}`);
    await deleteDoc(ref);
  }
}
