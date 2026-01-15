import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc
} from '@angular/fire/firestore';
import { map, Observable } from 'rxjs';
import { Transaction, TransactionType } from '../models/transaction.model';
import { toYmd, toYmdFromLocalDate } from '../../shared/utils/date.util';

@Injectable({
  providedIn: 'root'
})
export class TransactionsService {
  private firestore = inject(Firestore);

  listByRange$(uid: string, start: Date, end: Date): Observable<Transaction[]> {
    const ref = collection(this.firestore, `users/${uid}/transactions`);
    const startYmd = toYmdFromLocalDate(start);
    const endYmd = toYmdFromLocalDate(end);
    return collectionData(ref, { idField: 'id' }).pipe(
      map((items) =>
        (items as Transaction[])
          .map((item) => ({ ...item, date: toYmd(item.date) }))
          .filter((tx) => tx.date && tx.date >= startYmd && tx.date <= endYmd)
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
          .slice(0, 2000)
      )
    );
  }

  listRecent$(uid: string, limitCount = 5): Observable<Transaction[]> {
    const ref = collection(this.firestore, `users/${uid}/transactions`);
    return collectionData(ref, { idField: 'id' }).pipe(
      map((items) =>
        (items as Transaction[])
          .map((item) => ({ ...item, date: toYmd(item.date) }))
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
          .slice(0, limitCount)
      )
    );
  }

  listAll$(uid: string): Observable<Transaction[]> {
    const ref = collection(this.firestore, `users/${uid}/transactions`);
    return collectionData(ref, { idField: 'id' }).pipe(
      map((items) =>
        (items as Transaction[])
          .map((item) => ({ ...item, date: toYmd(item.date) }))
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      )
    );
  }

  listMonth$(uid: string, month: number, year: number): Observable<Transaction[]> {
    const start = new Date(year, month - 1, 1, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59);
    return this.listByRange$(uid, start, end);
  }

  listMonthExpensesByCategory$(
    uid: string,
    month: number,
    year: number
  ): Observable<Record<string, number>> {
    const start = new Date(year, month - 1, 1, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59);
    return this.listByRange$(uid, start, end).pipe(
      map((items) =>
        items
          .filter((tx) => tx.type === 'expense')
          .reduce<Record<string, number>>((acc, tx) => {
            const key = tx.categoryId || 'uncategorized';
            acc[key] = (acc[key] || 0) + tx.amount;
            return acc;
          }, {})
      )
    );
  }

  async add(
    uid: string,
    data: {
      type: TransactionType;
      description: string;
      amount: number;
      date: string;
      categoryId?: string | null;
      accountId?: string | null;
      accountOriginId?: string | null;
      accountDestinationId?: string | null;
      notes?: string | null;
      investmentId?: string | null;
      investmentAction?: 'deposit' | 'withdraw' | null;
      source?: string | null;
    }
  ): Promise<void> {
    const ref = collection(this.firestore, `users/${uid}/transactions`);
    await addDoc(ref, {
      ...data,
      categoryId: data.categoryId || null,
      accountId: data.accountId || null,
      accountOriginId: data.accountOriginId || null,
      accountDestinationId: data.accountDestinationId || null,
      notes: data.notes || null,
      investmentId: data.investmentId || null,
      investmentAction: data.investmentAction || null,
      source: data.source || null,
      date: data.date,
      createdAt: serverTimestamp()
    });
  }

  async update(
    uid: string,
    id: string,
    data: {
      type: TransactionType;
      description: string;
      amount: number;
      date: string;
      categoryId?: string | null;
      accountId?: string | null;
      accountOriginId?: string | null;
      accountDestinationId?: string | null;
      notes?: string | null;
      investmentId?: string | null;
      investmentAction?: 'deposit' | 'withdraw' | null;
      source?: string | null;
    }
  ): Promise<void> {
    const ref = doc(this.firestore, `users/${uid}/transactions/${id}`);
    await updateDoc(ref, {
      ...data,
      categoryId: data.categoryId || null,
      accountId: data.accountId || null,
      accountOriginId: data.accountOriginId || null,
      accountDestinationId: data.accountDestinationId || null,
      notes: data.notes || null,
      investmentId: data.investmentId || null,
      investmentAction: data.investmentAction || null,
      source: data.source || null,
      date: data.date
    });
  }

  async delete(uid: string, id: string): Promise<void> {
    const ref = doc(this.firestore, `users/${uid}/transactions/${id}`);
    await deleteDoc(ref);
  }
}
