import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where
} from '@angular/fire/firestore';
import { map, Observable } from 'rxjs';
import { CreditCard } from '../../core/models/credit-card.model';
import { CreditInstallment } from '../../core/models/credit-installment.model';
import { CreditPurchase } from '../../core/models/credit-purchase.model';
import { buildMonthlyDueDates } from './utils/credit.util';
import { toYmdFromLocalDate } from '../../shared/utils/date.util';

type CreditCardInput = Omit<CreditCard, 'id' | 'createdAt' | 'updatedAt'>;
type CreditPurchaseInput = Omit<CreditPurchase, 'id' | 'createdAt' | 'updatedAt'>;

@Injectable({
  providedIn: 'root'
})
export class CreditService {
  private firestore = inject(Firestore);

  listCards$(uid: string): Observable<CreditCard[]> {
    const ref = collection(this.firestore, `users/${uid}/creditCards`);
    const q = query(ref, orderBy('name'), limit(1000));
    return collectionData(q, { idField: 'id' }).pipe(
      map((items) =>
        (items as CreditCard[]).map((item) => ({
          ...item,
          brand: item.brand ?? null,
          limit: this.normalizeNullableNumber(item.limit),
          closingDay: this.normalizeNullableNumber(item.closingDay),
          dueDay: Number(item.dueDay ?? 0)
        }))
      )
    );
  }

  async addCard(uid: string, data: CreditCardInput): Promise<void> {
    const ref = collection(this.firestore, `users/${uid}/creditCards`);
    await addDoc(ref, {
      ...data,
      brand: data.brand || null,
      limit: this.normalizeNullableNumber(data.limit),
      closingDay: this.normalizeNullableNumber(data.closingDay),
      dueDay: Number(data.dueDay ?? 0),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  async updateCard(uid: string, id: string, data: Partial<CreditCardInput>): Promise<void> {
    const ref = doc(this.firestore, `users/${uid}/creditCards/${id}`);
    await updateDoc(ref, {
      ...data,
      ...(data.brand !== undefined ? { brand: data.brand || null } : {}),
      ...(data.limit !== undefined
        ? { limit: this.normalizeNullableNumber(data.limit) }
        : {}),
      ...(data.closingDay !== undefined
        ? { closingDay: this.normalizeNullableNumber(data.closingDay) }
        : {}),
      ...(data.dueDay !== undefined ? { dueDay: Number(data.dueDay ?? 0) } : {}),
      updatedAt: serverTimestamp()
    });
  }

  async deleteCard(uid: string, id: string): Promise<void> {
    const purchaseRef = collection(this.firestore, `users/${uid}/creditPurchases`);
    const purchaseQuery = query(purchaseRef, where('cardId', '==', id), limit(1));
    const purchaseSnap = await getDocs(purchaseQuery);
    if (!purchaseSnap.empty) {
      throw new Error('Cartão em uso em compras. Não é possível excluir.');
    }

    const ref = doc(this.firestore, `users/${uid}/creditCards/${id}`);
    await deleteDoc(ref);
  }

  listPurchases$(uid: string): Observable<CreditPurchase[]> {
    const ref = collection(this.firestore, `users/${uid}/creditPurchases`);
    const q = query(ref, orderBy('purchaseDate', 'desc'), limit(2000));
    return collectionData(q, { idField: 'id' }).pipe(
      map((items) =>
        (items as CreditPurchase[]).map((item) => ({
          ...item,
          categoryId: item.categoryId ?? null,
          installmentsCount: Number(item.installmentsCount ?? 0),
          installmentAmounts: (item.installmentAmounts ?? []).map((amount) => Number(amount ?? 0)),
          sameValue: Boolean(item.sameValue)
        }))
      )
    );
  }

  listInstallments$(uid: string): Observable<CreditInstallment[]> {
    const ref = collection(this.firestore, `users/${uid}/creditInstallments`);
    const q = query(ref, orderBy('dueDate', 'asc'), limit(5000));
    return collectionData(q, { idField: 'id' }).pipe(
      map((items) =>
        (items as CreditInstallment[]).map((item) => ({
          ...item,
          amount: Number(item.amount ?? 0),
          installmentNumber: Number(item.installmentNumber ?? 0),
          paid: Boolean(item.paid),
          paidAt: item.paidAt ?? undefined
        }))
      )
    );
  }

  async addPurchaseWithInstallments(
    uid: string,
    data: CreditPurchaseInput,
    card: CreditCard
  ): Promise<void> {
    const installmentsCount = Number(data.installmentsCount ?? 0);
    const normalizedAmounts = this.normalizeInstallmentAmounts(
      data.installmentAmounts,
      installmentsCount,
      data.sameValue
    );
    const purchaseRef = await addDoc(collection(this.firestore, `users/${uid}/creditPurchases`), {
      ...data,
      categoryId: data.categoryId || null,
      installmentsCount,
      installmentAmounts: normalizedAmounts,
      sameValue: Boolean(data.sameValue),
      status: data.status || 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    const dueDates = buildMonthlyDueDates(data.firstDueDate, installmentsCount);
    const installmentsRef = collection(this.firestore, `users/${uid}/creditInstallments`);

    for (let i = 0; i < installmentsCount; i++) {
      await addDoc(installmentsRef, {
        purchaseId: purchaseRef.id,
        cardId: data.cardId,
        installmentNumber: i + 1,
        amount: Number(normalizedAmounts[i] ?? 0),
        dueDate: dueDates[i] || data.firstDueDate,
        paymentAccountId: card.paymentAccountId,
        paid: false,
        createdAt: serverTimestamp()
      });
    }
  }

  async updatePurchaseWithInstallments(
    uid: string,
    purchaseId: string,
    data: CreditPurchaseInput,
    card: CreditCard,
    installments?: CreditInstallment[]
  ): Promise<void> {
    const installmentsCount = Number(data.installmentsCount ?? 0);
    const normalizedAmounts = this.normalizeInstallmentAmounts(
      data.installmentAmounts,
      installmentsCount,
      data.sameValue
    );

    const purchaseRef = doc(this.firestore, `users/${uid}/creditPurchases/${purchaseId}`);
    await updateDoc(purchaseRef, {
      ...data,
      categoryId: data.categoryId || null,
      installmentsCount,
      installmentAmounts: normalizedAmounts,
      sameValue: Boolean(data.sameValue),
      updatedAt: serverTimestamp()
    });

    const installmentsRef = collection(this.firestore, `users/${uid}/creditInstallments`);
    const installmentsQuery = query(installmentsRef, where('purchaseId', '==', purchaseId));
    const installmentsSnap = await getDocs(installmentsQuery);
    const existingByNumber = new Map<number, { ref: any; data: CreditInstallment }>();
    for (const installment of installmentsSnap.docs) {
      const installmentData = installment.data() as CreditInstallment;
      const installmentNumber = Number(installmentData.installmentNumber ?? 0);
      if (!Number.isFinite(installmentNumber) || installmentNumber <= 0) {
        continue;
      }
      if (!existingByNumber.has(installmentNumber)) {
        existingByNumber.set(installmentNumber, { ref: installment.ref, data: installmentData });
      }
    }

    const incomingByNumber = new Map<number, CreditInstallment>();
    for (const item of installments ?? []) {
      const installmentNumber = Number(
        (item as any)?.installmentNumber ?? (item as any)?.number ?? 0
      );
      if (!Number.isFinite(installmentNumber) || installmentNumber <= 0) {
        continue;
      }
      incomingByNumber.set(installmentNumber, item);
    }

    const dueDates = buildMonthlyDueDates(data.firstDueDate, installmentsCount);
    const keepNumbers = new Set<number>();

    for (let i = 0; i < installmentsCount; i++) {
      const installmentNumber = i + 1;
      keepNumbers.add(installmentNumber);
      const existing = existingByNumber.get(installmentNumber);
      const amount = Number(normalizedAmounts[i] ?? 0);
      const dueDate = dueDates[i] || data.firstDueDate;
      const paymentAccountId =
        existing?.data?.paid || existing?.data?.paymentMovementId
          ? existing.data.paymentAccountId || card.paymentAccountId
          : card.paymentAccountId;

      if (existing) {
        await updateDoc(existing.ref, {
          cardId: data.cardId,
          installmentNumber,
          amount,
          dueDate,
          paymentAccountId
        });
        continue;
      }

      const incoming = incomingByNumber.get(installmentNumber);
      await addDoc(installmentsRef, {
        purchaseId,
        cardId: data.cardId,
        installmentNumber,
        amount,
        dueDate,
        paymentAccountId,
        paid: incoming?.paid ?? false,
        paidAt: incoming?.paidAt ?? undefined,
        paymentMovementId: incoming?.paymentMovementId ?? null,
        createdAt: serverTimestamp()
      });
    }

    for (const [installmentNumber, existing] of existingByNumber.entries()) {
      if (!keepNumbers.has(installmentNumber)) {
        await deleteDoc(existing.ref);
      }
    }
  }

  async deletePurchase(uid: string, purchaseId: string): Promise<void> {
    const installmentsRef = collection(this.firestore, `users/${uid}/creditInstallments`);
    const installmentsQuery = query(installmentsRef, where('purchaseId', '==', purchaseId));
    const installmentsSnap = await getDocs(installmentsQuery);
    for (const installment of installmentsSnap.docs) {
      await deleteDoc(installment.ref);
    }

    const purchaseRef = doc(this.firestore, `users/${uid}/creditPurchases/${purchaseId}`);
    await deleteDoc(purchaseRef);
  }

  async setInstallmentPaid(
    uid: string,
    input: {
      purchaseId: string;
      installmentId: string;
      accountId: string;
      paid: boolean;
    }
  ): Promise<void> {
    const { purchaseId, installmentId, accountId, paid } = input;
    const purchaseRef = doc(this.firestore, `users/${uid}/creditPurchases/${purchaseId}`);
    const installmentRef = doc(this.firestore, `users/${uid}/creditInstallments/${installmentId}`);
    let existingMovementId: string | null = null;
    let logInstallment: CreditInstallment | null = null;

    try {
      if (paid) {
        const installmentSnap = await getDoc(installmentRef);
        if (installmentSnap.exists()) {
          const installment = installmentSnap.data() as CreditInstallment;
          logInstallment = installment;
          const installmentKey = Number(installment.installmentNumber ?? 0);
          const normalizedKey =
            Number.isFinite(installmentKey) && installmentKey > 0 ? installmentKey : null;
          if (!installment.paymentMovementId) {
            try {
              existingMovementId = await this.findExistingInstallmentMovement(uid, {
                installmentId,
                purchaseId,
                accountId,
                installmentKey: normalizedKey
              });
            } catch (lookupErr: any) {
              console.error('[advanceInstallment] movement lookup failed', {
                message: lookupErr?.message,
                stack: lookupErr?.stack,
                payload: {
                  purchaseId,
                  installmentId,
                  accountId,
                  installmentKey: normalizedKey
                }
              });
            }
          }
        }
      }

      await runTransaction(this.firestore, async (tx) => {
        const [purchaseSnap, installmentSnap] = await Promise.all([
          tx.get(purchaseRef),
          tx.get(installmentRef)
        ]);

        if (!installmentSnap.exists()) {
          throw new Error('Parcela nao encontrada');
        }

        const purchase = purchaseSnap.exists() ? (purchaseSnap.data() as CreditPurchase) : null;
        const installment = installmentSnap.data() as CreditInstallment;
        const alreadyPaid = Boolean(installment.paid);
        const movementId = installment.paymentMovementId ?? null;

        if (paid) {
          if (alreadyPaid && movementId) {
            return;
          }

          if (movementId && !alreadyPaid) {
            tx.update(installmentRef, {
              paid: true,
              paidAt: installment.paidAt ?? serverTimestamp()
            });
            return;
          }

          if (existingMovementId) {
            tx.update(installmentRef, {
              paid: true,
              paidAt: installment.paidAt ?? serverTimestamp(),
              paymentMovementId: existingMovementId
            });
            return;
          }

          const paymentDate = toYmdFromLocalDate(new Date());
          const amount = Number(installment.amount ?? 0);
          if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error('Valor invalido');
          }

          const txRef = doc(collection(this.firestore, `users/${uid}/transactions`));
          const suffix =
            purchase && purchase.installmentsCount
              ? ` (${installment.installmentNumber}/${purchase.installmentsCount})`
              : '';
          const description = `Parcela cartão - ${purchase?.description ?? 'Compra'}${suffix}`;
          const rawInstallmentKey = Number(installment.installmentNumber ?? 0);
          const installmentKey =
            Number.isFinite(rawInstallmentKey) && rawInstallmentKey > 0 ? rawInstallmentKey : null;

          tx.set(txRef, {
            type: 'expense',
            description,
            amount,
            date: paymentDate,
            dueDate: installment.dueDate ?? null,
            categoryId: purchase?.categoryId || null,
            accountId,
            accountOriginId: null,
            accountDestinationId: null,
            notes: 'Pagamento manual de parcela (Crédito)',
            source: 'credit_installment_payment',
            purchaseId,
            installmentKey,
            installmentId,
            createdAt: serverTimestamp()
          });

          tx.update(installmentRef, {
            paid: true,
            paidAt: serverTimestamp(),
            paymentMovementId: txRef.id
          });
          return;
        }

        if (!alreadyPaid) {
          return;
        }

        if (movementId) {
          const movementRef = doc(this.firestore, `users/${uid}/transactions/${movementId}`);
          tx.delete(movementRef);
        }

        tx.update(installmentRef, {
          paid: false,
          paidAt: undefined,
          paymentMovementId: null
        });
      });
    } catch (err: any) {
      console.error('[advanceInstallment] error', {
        message: err?.message,
        stack: err?.stack,
        payload: {
          purchaseId,
          installmentId,
          accountId,
          paid,
          amount: logInstallment?.amount,
          dueDate: logInstallment?.dueDate
        }
      });
      throw err;
    }
  }

  private async findExistingInstallmentMovement(
    uid: string,
    input: {
      installmentId?: string;
      purchaseId?: string;
      accountId?: string;
      installmentKey?: number | null;
    }
  ): Promise<string | null> {
    const ref = collection(this.firestore, `users/${uid}/transactions`);
    if (input.installmentId) {
      const byInstallment = query(
        ref,
        where('source', '==', 'credit_installment_payment'),
        where('installmentId', '==', input.installmentId),
        limit(1)
      );
      const snap = await getDocs(byInstallment);
      if (!snap.empty) {
        return snap.docs[0].id;
      }
    }

    if (
      input.purchaseId &&
      input.accountId &&
      input.installmentKey &&
      Number.isFinite(input.installmentKey)
    ) {
      const byLegacyKey = query(
        ref,
        where('source', '==', 'credit_installment_payment'),
        where('purchaseId', '==', input.purchaseId),
        where('installmentKey', '==', input.installmentKey),
        where('accountId', '==', input.accountId),
        limit(1)
      );
      const snap = await getDocs(byLegacyKey);
      if (!snap.empty) {
        return snap.docs[0].id;
      }
    }

    return null;
  }

  private normalizeNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const num = Number(value);
    return Number.isNaN(num) ? null : num;
  }

  private normalizeInstallmentAmounts(
    amounts: number[] | undefined,
    count: number,
    sameValue: boolean
  ): number[] {
    if (count <= 0) {
      return [];
    }
    const base = (amounts ?? []).map((value) => Number(value ?? 0));
    if (sameValue) {
      const first = Number(base[0] ?? 0);
      return Array.from({ length: count }, () => first);
    }
    return Array.from({ length: count }, (_, index) => Number(base[index] ?? 0));
  }
}
