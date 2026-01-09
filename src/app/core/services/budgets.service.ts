import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc
} from '@angular/fire/firestore';
import { map, Observable } from 'rxjs';
import { Budget } from '../models/budget.model';

@Injectable({
  providedIn: 'root'
})
export class BudgetsService {
  private firestore = inject(Firestore);

  listByMonth$(uid: string, month: number, year: number): Observable<Budget[]> {
    const ref = collection(this.firestore, `users/${uid}/budgets`);
    return collectionData(ref, { idField: 'id' }).pipe(
      map((items) =>
        (items as Budget[]).filter((budget) => budget.month === month && budget.year === year)
      )
    );
  }

  async add(uid: string, budget: Omit<Budget, 'id' | 'createdAt'>): Promise<void> {
    const ref = collection(this.firestore, `users/${uid}/budgets`);
    const snapshot = await getDocs(ref);
    const exists = snapshot.docs.some((docSnap) => {
      const data = docSnap.data() as Budget;
      return (
        data.categoryId === budget.categoryId &&
        data.month === budget.month &&
        data.year === budget.year
      );
    });
    if (exists) {
      throw new Error('Já existe uma meta para esta categoria neste mês.');
    }

    await addDoc(ref, {
      ...budget,
      createdAt: serverTimestamp()
    });
  }

  async update(uid: string, id: string, data: Partial<Budget>): Promise<void> {
    const ref = doc(this.firestore, `users/${uid}/budgets/${id}`);
    await updateDoc(ref, { ...data });
  }

  async delete(uid: string, id: string): Promise<void> {
    const ref = doc(this.firestore, `users/${uid}/budgets/${id}`);
    await deleteDoc(ref);
  }
}
