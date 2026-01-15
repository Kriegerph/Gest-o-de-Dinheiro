import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  doc,
  runTransaction,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from '@angular/fire/firestore';
import { map, Observable } from 'rxjs';
import { Investment } from '../models/investment.model';
import { toYmd } from '../../../shared/utils/date.util';

@Injectable({ providedIn: 'root' })
export class InvestmentsService {
  private firestore = inject(Firestore);

  list$(uid: string): Observable<Investment[]> {
    const ref = collection(this.firestore, `users/${uid}/investments`);
    const q = query(ref, orderBy('name'));
    return collectionData(q, { idField: 'id' }).pipe(
      map((items) => (items as Investment[]).map((item) => this.normalize(item)))
    );
  }

  async add(uid: string, data: Omit<Investment, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> {
    const ref = collection(this.firestore, `users/${uid}/investments`);
    await addDoc(ref, {
      ...data,
      userId: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  async update(uid: string, id: string, data: Partial<Investment>): Promise<void> {
    const ref = doc(this.firestore, `users/${uid}/investments/${id}`);
    await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  }

  async createDeposit(
    uid: string,
    input: {
      investmentId: string;
      accountId: string;
      amount: number;
      date: string;
      categoryId: string | null;
      notes?: string | null;
    }
  ): Promise<void> {
    const investmentRef = doc(this.firestore, `users/${uid}/investments/${input.investmentId}`);
    await runTransaction(this.firestore, async (tx) => {
      const investmentSnap = await tx.get(investmentRef);
      if (!investmentSnap.exists()) {
        throw new Error('Investimento nao encontrado.');
      }
      const investment = investmentSnap.data() as Investment;
      const principalBase = Number(investment.principalBase ?? 0);
      const nextBase = principalBase + Number(input.amount ?? 0);
      if (!Number.isFinite(nextBase)) {
        throw new Error('Valor invalido.');
      }

      const txRef = doc(collection(this.firestore, `users/${uid}/transactions`));
      tx.set(txRef, {
        type: 'expense',
        description: `Aporte em investimento: ${investment.name}`,
        amount: Number(input.amount ?? 0),
        date: input.date,
        categoryId: input.categoryId,
        accountId: input.accountId,
        accountOriginId: null,
        accountDestinationId: null,
        notes: input.notes || null,
        investmentId: input.investmentId,
        investmentAction: 'deposit',
        source: 'investment_movement',
        createdAt: serverTimestamp()
      });

      tx.update(investmentRef, {
        principalBase: nextBase,
        updatedAt: serverTimestamp()
      });
    });
  }

  async createWithdraw(
    uid: string,
    input: {
      investmentId: string;
      accountId: string;
      amount: number;
      date: string;
      categoryId: string | null;
      notes?: string | null;
    }
  ): Promise<void> {
    const investmentRef = doc(this.firestore, `users/${uid}/investments/${input.investmentId}`);
    await runTransaction(this.firestore, async (tx) => {
      const investmentSnap = await tx.get(investmentRef);
      if (!investmentSnap.exists()) {
        throw new Error('Investimento não encontrado.');
      }
      const investment = investmentSnap.data() as Investment;
      const principalBase = Number(investment.principalBase ?? 0);
      const nextBase = Math.max(0, principalBase - Number(input.amount ?? 0));
      if (!Number.isFinite(nextBase)) {
        throw new Error('Valor inválido.');
      }

      const txRef = doc(collection(this.firestore, `users/${uid}/transactions`));
      tx.set(txRef, {
        type: 'income',
        description: `Resgate de investimento: ${investment.name}`,
        amount: Number(input.amount ?? 0),
        date: input.date,
        categoryId: input.categoryId,
        accountId: input.accountId,
        accountOriginId: null,
        accountDestinationId: null,
        notes: input.notes || null,
        investmentId: input.investmentId,
        investmentAction: 'withdraw',
        source: 'investment_movement',
        createdAt: serverTimestamp()
      });

      tx.update(investmentRef, {
        principalBase: nextBase,
        updatedAt: serverTimestamp()
      });
    });
  }

  private normalize(item: Investment): Investment {
    const yieldMode = item.yieldMode ?? 'manual_monthly';
    const compounding =
      item.compounding ?? (yieldMode === 'cdi_percent' || yieldMode === 'selic' ? 'daily' : 'monthly');
    const realStartDate = toYmd(item.realStartDate) || '';
    const systemStartDate = toYmd(item.systemStartDate) || realStartDate;

    return {
      ...item,
      type: item.type ?? 'manual',
      status: item.status ?? 'active',
      hadBeforeApp: Boolean(item.hadBeforeApp),
      realStartDate,
      systemStartDate,
      principalBase: Number(item.principalBase ?? 0),
      preAppYield: Number(item.preAppYield ?? 0),
      totalInvestedToDate:
        item.totalInvestedToDate === null || item.totalInvestedToDate === undefined
          ? null
          : Number(item.totalInvestedToDate),
      currentValueAtOnboarding:
        item.currentValueAtOnboarding === null || item.currentValueAtOnboarding === undefined
          ? null
          : Number(item.currentValueAtOnboarding),
      yieldMode,
      manualRate: item.manualRate === null || item.manualRate === undefined ? null : Number(item.manualRate),
      cdiPercent: item.cdiPercent === null || item.cdiPercent === undefined ? null : Number(item.cdiPercent),
      compounding
    };
  }
}
