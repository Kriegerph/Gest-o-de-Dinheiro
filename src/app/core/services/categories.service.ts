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
      throw new Error('Categoria em uso em lançamentos. Não é possível excluir.');
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
  }

  async ensureCategory(
    uid: string,
    input: { name: string; type: Category['type']; color?: string }
  ): Promise<string> {
    const ref = collection(this.firestore, `users/${uid}/categories`);
    const q = query(
      ref,
      where('name', '==', input.name),
      where('type', '==', input.type),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      return snap.docs[0].id;
    }

    const docRef = await addDoc(ref, {
      name: input.name,
      type: input.type,
      color: input.color ?? '#94a3b8',
      createdAt: serverTimestamp()
    });
    return docRef.id;
  }
}
