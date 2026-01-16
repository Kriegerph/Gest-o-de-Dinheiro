import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  orderBy,
  query
} from '@angular/fire/firestore';
import { map, Observable, tap } from 'rxjs';
import { InvestmentMovement } from '../models/investment-movement.model';
import { toYmd, localDateFromYmd } from '../../../shared/utils/date.util';
import { environment } from '../../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class InvestmentsMovementsService {
  private firestore = inject(Firestore);

  listByInvestment$(uid: string, investmentId: string): Observable<InvestmentMovement[]> {
    const ref = collection(this.firestore, `users/${uid}/investments/${investmentId}/movements`);
    const q = query(ref, orderBy('date', 'desc'));
    return collectionData(q, { idField: 'id' }).pipe(
      map((items) =>
        (items as InvestmentMovement[])
          .map((item) => ({
            ...item,
            amount: Number(item.amount ?? 0),
            date: toYmd(item.date),
            accountId: item.accountId ?? null,
            accountNameSnapshot: item.accountNameSnapshot ?? null,
            note: item.note ?? null,
            grossAmount: Number(item.grossAmount ?? item.amount ?? 0),
            netAmount:
              item.netAmount === null || item.netAmount === undefined
                ? null
                : Number(item.netAmount),
            irEstimated:
              item.irEstimated === null || item.irEstimated === undefined
                ? null
                : Number(item.irEstimated),
            irRate: item.irRate === null || item.irRate === undefined ? null : Number(item.irRate)
          }))
          .map((item) => {
            const isHistorical = Boolean(item.isHistorical);
            return {
              ...item,
              isHistorical,
              affectsAccounts:
                item.affectsAccounts !== undefined ? Boolean(item.affectsAccounts) : !isHistorical,
              relatedTransactionId: item.relatedTransactionId ?? null,
              source: item.source ?? (isHistorical ? 'investment_only' : 'ledger')
            };
          })
          .sort((a, b) => {
            const dateA = this.toTimestamp(a.date) || this.toTimestamp(a.createdAt);
            const dateB = this.toTimestamp(b.date) || this.toTimestamp(b.createdAt);
            if (dateA !== dateB) {
              return dateB - dateA;
            }
            const createdA = this.toTimestamp(a.createdAt);
            const createdB = this.toTimestamp(b.createdAt);
            return createdB - createdA;
          })
      ),
      tap((items) => {
        if (!environment.production) {
          const first = items[0] ?? null;
          console.log('[Investments] movements loaded', { count: items.length, first });
        }
      })
    );
  }

  async deleteMovement(uid: string, investmentId: string, movementId: string): Promise<void> {
    const ref = doc(
      this.firestore,
      `users/${uid}/investments/${investmentId}/movements/${movementId}`
    );
    await deleteDoc(ref);
  }

  private toTimestamp(value: any): number {
    if (!value) {
      return 0;
    }
    if (typeof value === 'object' && typeof value.toDate === 'function') {
      const date = value.toDate();
      return date instanceof Date ? date.getTime() : 0;
    }
    if (value instanceof Date) {
      return value.getTime();
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parsed = localDateFromYmd(value);
      return parsed ? parsed.getTime() : 0;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }
}
