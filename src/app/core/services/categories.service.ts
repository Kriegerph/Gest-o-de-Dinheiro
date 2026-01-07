import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
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
import { Category } from '../models/category.model';

@Injectable({
  providedIn: 'root'
})
export class CategoriesService {
  private firestore = inject(Firestore);

  list$(uid: string): Observable<Category[]> {
    const ref = collection(this.firestore, `users/${uid}/categories`);
    const q = query(ref, orderBy('name'), limit(1000));
    return collectionData(q, { idField: 'id' }).pipe(
      map((items) =>
        (items as Category[]).map((item) => ({
          ...item,
          type: item.type ?? 'expense'
        }))
      )
    );
  }

  async add(uid: string, data: Omit<Category, 'id' | 'createdAt'>): Promise<void> {
    const ref = collection(this.firestore, `users/${uid}/categories`);
    await addDoc(ref, {
      ...data,
      createdAt: serverTimestamp()
    });
  }

  async update(uid: string, id: string, data: Partial<Category>): Promise<void> {
    const ref = doc(this.firestore, `users/${uid}/categories/${id}`);
    await updateDoc(ref, {
      ...data
    });
  }

  async delete(uid: string, id: string): Promise<void> {
    const txRef = collection(this.firestore, `users/${uid}/transactions`);
    const txQuery = query(txRef, where('categoryId', '==', id), limit(1));
    const txSnap = await getDocs(txQuery);
    if (!txSnap.empty) {
      throw new Error('Categoria em uso em lancamentos. Nao e possivel excluir.');
    }

    const ref = doc(this.firestore, `users/${uid}/categories/${id}`);
    await deleteDoc(ref);
  }

  async ensureDefaultCategories(uid: string): Promise<void> {
    const ref = collection(this.firestore, `users/${uid}/categories`);
    const existing = await getDocs(query(ref, limit(1)));
    if (!existing.empty) {
      return;
    }

    const defaults: Omit<Category, 'id'>[] = [
      { name: 'Receitas', color: '#22d3ee', type: 'income', createdAt: Timestamp.now() },
      { name: 'Alimentacao', color: '#f97316', type: 'expense', createdAt: Timestamp.now() },
      { name: 'Moradia', color: '#8b5cf6', type: 'expense', createdAt: Timestamp.now() },
      { name: 'Transporte', color: '#0ea5e9', type: 'expense', createdAt: Timestamp.now() },
      { name: 'Lazer', color: '#06b6d4', type: 'expense', createdAt: Timestamp.now() },
      { name: 'Saude', color: '#ef4444', type: 'expense', createdAt: Timestamp.now() },
      { name: 'Educacao', color: '#10b981', type: 'expense', createdAt: Timestamp.now() },
      { name: 'Outros', color: '#9ca3af', type: 'expense', createdAt: Timestamp.now() }
    ];

    for (const item of defaults) {
      await addDoc(ref, { ...item, createdAt: serverTimestamp() });
    }
  }
}
