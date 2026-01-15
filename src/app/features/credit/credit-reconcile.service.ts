import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where
} from '@angular/fire/firestore';
import { CreditCard } from '../../core/models/credit-card.model';
import { CreditInstallment } from '../../core/models/credit-installment.model';
import { CreditPurchase } from '../../core/models/credit-purchase.model';
import { toYmdFromLocalDate } from '../../shared/utils/date.util';

@Injectable({
  providedIn: 'root'
})
export class CreditReconcileService {
  private firestore = inject(Firestore);

  async reconcile(uid: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const installmentsRef = collection(this.firestore, `users/${uid}/creditInstallments`);
    const installmentsQuery = query(
      installmentsRef,
      where('paid', '==', false),
      limit(2000)
    );
    const installmentsSnap = await getDocs(installmentsQuery);
    if (installmentsSnap.empty) {
      return 0;
    }

    const installments = installmentsSnap.docs.map((snap) => ({
      id: snap.id,
      ...(snap.data() as CreditInstallment)
    }));
    const [cards, purchases] = await Promise.all([
      this.fetchCards(uid),
      this.fetchPurchases(uid)
    ]);
    const cardsById = new Map(cards.map((card) => [card.id || '', card]));
    const purchasesById = new Map(purchases.map((purchase) => [purchase.id || '', purchase]));

    let processed = 0;
    for (const installment of installments) {
      const installmentKey =
        installment.id ??
        (installment as any).installmentId ??
        installment.installmentNumber ??
        (installment as any).number ??
        null;
      if (!installment.id || installment.linkedTransactionId || !installment.purchaseId) {
        continue;
      }
      if (installmentKey === null || installmentKey === undefined) {
        continue;
      }
      const due = this.toJsDate((installment as any).dueDate ?? (installment as any).date);
      if (!due) {
        continue;
      }
      due.setHours(0, 0, 0, 0);
      if (due > today) {
        continue;
      }
      const amount = Number(installment.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        continue;
      }

      const purchase = purchasesById.get(installment.purchaseId);
      const card = cardsById.get(installment.cardId);
      if (!purchase || !card) {
        continue;
      }

      try {
        const installmentNumber = Number(installment.installmentNumber ?? 0);
        const suffix =
          purchase.installmentsCount &&
          Number.isFinite(installmentNumber) &&
          installmentNumber > 0
            ? ` (${installmentNumber}/${purchase.installmentsCount})`
            : '';
        const description = `Cartão: ${card.name} - ${purchase.description}${suffix}`;
        const txRef = await addDoc(collection(this.firestore, `users/${uid}/transactions`), {
          type: 'expense',
          description,
          amount,
          date: toYmdFromLocalDate(due),
          categoryId: purchase.categoryId || null,
          accountId: installment.paymentAccountId || card.paymentAccountId || null,
          accountOriginId: null,
          accountDestinationId: null,
          notes: 'Gerado automaticamente (Crédito)',
          createdAt: serverTimestamp()
        });

        const installmentRef = doc(
          this.firestore,
          `users/${uid}/creditInstallments/${installment.id}`
        );
        await updateDoc(installmentRef, {
          paid: true,
          paidAt: serverTimestamp(),
          linkedTransactionId: txRef.id
        });
        processed++;
      } catch (err) {
        console.warn('Reconcile installment failed', err);
        continue;
      }
    }

    return processed;
  }

  private async fetchCards(uid: string): Promise<CreditCard[]> {
    const ref = collection(this.firestore, `users/${uid}/creditCards`);
    const snap = await getDocs(ref);
    return snap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as CreditCard)
    }));
  }

  private async fetchPurchases(uid: string): Promise<CreditPurchase[]> {
    const ref = collection(this.firestore, `users/${uid}/creditPurchases`);
    const snap = await getDocs(ref);
    return snap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as CreditPurchase)
    }));
  }

  private toJsDate(value: any): Date | null {
    if (!value) return null;
    if (value?.toDate && typeof value.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === 'string') {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]) - 1;
        const day = Number(match[3]);
        if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
          return new Date(year, month, day, 12, 0, 0, 0);
        }
      }
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }
}
