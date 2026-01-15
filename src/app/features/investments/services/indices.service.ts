import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  limit,
  orderBy,
  query,
  where
} from '@angular/fire/firestore';
import { catchError, map, Observable, of, shareReplay } from 'rxjs';
import { DailyIndex, IndexType } from '../models/index.model';
import { toYmd } from '../../../shared/utils/date.util';

@Injectable({ providedIn: 'root' })
export class IndicesService {
  private firestore = inject(Firestore);
  private cache = new Map<IndexType, Observable<DailyIndex | null>>();

  latest$(type: IndexType): Observable<DailyIndex | null> {
    const cached = this.cache.get(type);
    if (cached) {
      return cached;
    }
    const ref = collection(this.firestore, 'indices');
    const q = query(ref, where('type', '==', type), orderBy('date', 'desc'), limit(1));
    const stream = collectionData(q, { idField: 'id' }).pipe(
      map((items) => {
        const item = (items?.[0] as DailyIndex | undefined) ?? null;
        return item ? this.normalize(item, type) : null;
      }),
      catchError(() => of(null)),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    this.cache.set(type, stream);
    return stream;
  }

  private normalize(item: DailyIndex, type: IndexType): DailyIndex {
    const date = toYmd(item.date);
    return {
      ...item,
      type: item.type ?? type,
      date: date || '',
      value: Number(item.value ?? 0)
    };
  }
}
