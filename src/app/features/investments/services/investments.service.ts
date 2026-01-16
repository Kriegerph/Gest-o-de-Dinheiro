import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  docData,
  getDocs,
  runTransaction,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch
} from '@angular/fire/firestore';
import { map, Observable } from 'rxjs';
import { Investment } from '../models/investment.model';
import { toYmd } from '../../../shared/utils/date.util';
import { Account } from '../../../core/models/account.model';
import { environment } from '../../../../environments/environment';
import { InvestmentsCalculatorService } from './investments-calculator.service';

@Injectable({ providedIn: 'root' })
export class InvestmentsService {
  private firestore = inject(Firestore);
  private calculator = inject(InvestmentsCalculatorService);

  list$(uid: string): Observable<Investment[]> {
    const ref = collection(this.firestore, `users/${uid}/investments`);
    const q = query(ref, orderBy('name'));
    return collectionData(q, { idField: 'id' }).pipe(
      map((items) => (items as Investment[]).map((item) => this.normalize(item)))
    );
  }

  get$(uid: string, id: string): Observable<Investment | null> {
    const ref = doc(this.firestore, `users/${uid}/investments/${id}`);
    return docData(ref, { idField: 'id' }).pipe(
      map((item) => (item ? this.normalize(item as Investment) : null))
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

  async deleteInvestment(uid: string, investmentId: string): Promise<void> {
    const investmentRef = doc(this.firestore, `users/${uid}/investments/${investmentId}`);
    const movementsRef = collection(
      this.firestore,
      `users/${uid}/investments/${investmentId}/movements`
    );
    const batchSize = 400;

    while (true) {
      const q = query(movementsRef, limit(batchSize));
      const snap = await getDocs(q);
      if (snap.empty) {
        break;
      }
      const batch = writeBatch(this.firestore);
      snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
      await batch.commit();
      if (snap.size < batchSize) {
        break;
      }
    }

    await deleteDoc(investmentRef);
  }

  async createDeposit(
    uid: string,
    input: {
      investmentId: string;
      accountId?: string | null;
      amount: number;
      date: string;
      categoryId?: string | null;
      notes?: string | null;
      isHistorical?: boolean;
    }
  ): Promise<void> {
    const investmentRef = doc(this.firestore, `users/${uid}/investments/${input.investmentId}`);
    await runTransaction(this.firestore, async (tx) => {
      const investmentSnap = await tx.get(investmentRef);
      if (!investmentSnap.exists()) {
        throw new Error('Investimento nao encontrado.');
      }
      const investment = investmentSnap.data() as Investment;
      const isHistorical = Boolean(input.isHistorical);
      const accountId = input.accountId ? input.accountId.trim() : '';
      if (!isHistorical && !accountId) {
        throw new Error('Conta obrigatoria.');
      }
      const accountRef =
        accountId
          ? doc(this.firestore, `users/${uid}/accounts/${accountId}`)
          : null;
      const accountSnap = accountRef ? await tx.get(accountRef) : null;
      const account = accountSnap?.exists() ? (accountSnap.data() as Account) : null;
      const amount = Number(input.amount ?? 0);
      if (!Number.isFinite(amount)) {
        throw new Error('Valor invalido.');
      }

      let relatedTransactionId: string | null = null;
      const movementRef = doc(
        collection(this.firestore, `users/${uid}/investments/${input.investmentId}/movements`)
      );
      if (!isHistorical) {
        const txRef = doc(collection(this.firestore, `users/${uid}/transactions`));
        relatedTransactionId = txRef.id;
        tx.set(txRef, {
          type: 'expense',
          description: `Aporte em investimento: ${investment.name}`,
          amount,
          date: input.date,
          categoryId: input.categoryId || null,
          accountId,
          accountOriginId: null,
          accountDestinationId: null,
          notes: input.notes || null,
          investmentId: input.investmentId,
          investmentAction: 'deposit',
          source: 'investment_movement',
          createdAt: serverTimestamp()
        });
      }

      const movementPayload = {
        userId: uid,
        investmentId: input.investmentId,
        type: 'deposit',
        amount,
        date: input.date,
        accountId: accountId || null,
        accountNameSnapshot: account?.name ?? null,
        note: input.notes || null,
        relatedTransactionId,
        isHistorical,
        affectsAccounts: !isHistorical,
        source: isHistorical ? 'investment_only' : 'ledger',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      if (!environment.production) {
        console.log('[Investments] movement write', {
          path: movementRef.path,
          payload: movementPayload
        });
      }

      tx.set(movementRef, movementPayload);

      if (!isHistorical) {
        const principalBase = Number(investment.principalBase ?? 0);
        const nextBase = principalBase + amount;
        if (!Number.isFinite(nextBase)) {
          throw new Error('Valor invalido.');
        }
        tx.update(investmentRef, {
          principalBase: nextBase,
          updatedAt: serverTimestamp()
        });
      }
    });
  }

  async createWithdraw(
    uid: string,
    input: {
      investmentId: string;
      accountId?: string | null;
      amount: number;
      date: string;
      categoryId?: string | null;
      notes?: string | null;
      isHistorical?: boolean;
      applyIr?: boolean;
      currentValue?: number;
    }
  ): Promise<void> {
    const investmentRef = doc(this.firestore, `users/${uid}/investments/${input.investmentId}`);
    await runTransaction(this.firestore, async (tx) => {
      const investmentSnap = await tx.get(investmentRef);
      if (!investmentSnap.exists()) {
        throw new Error('Investimento nao encontrado.');
      }
      const investment = investmentSnap.data() as Investment;
      const isHistorical = Boolean(input.isHistorical);
      const accountId = input.accountId ? input.accountId.trim() : '';
      if (!isHistorical && !accountId) {
        throw new Error('Conta obrigatoria.');
      }
      const accountRef =
        accountId
          ? doc(this.firestore, `users/${uid}/accounts/${accountId}`)
          : null;
      const accountSnap = accountRef ? await tx.get(accountRef) : null;
      const account = accountSnap?.exists() ? (accountSnap.data() as Account) : null;
      const amount = Number(input.amount ?? 0);
      if (!Number.isFinite(amount)) {
        throw new Error('Valor invalido.');
      }
      const applyIr = Boolean(input.applyIr);
      const currentValue = Number(input.currentValue ?? 0);
      let irRate: number | null = null;
      let irEstimated: number | null = null;
      let netAmount = amount;

      if (!isHistorical && applyIr) {
        const startDate = investment.realStartDate || investment.systemStartDate || '';
        if (Number.isFinite(currentValue) && currentValue > 0 && startDate) {
          const irEstimate = this.calculator.calculateRescueIR({
            principalBase: Number(investment.principalBase ?? 0),
            currentValue,
            rescueAmount: amount,
            investmentStartDate: startDate
          });
          irRate = irEstimate.irRate;
          irEstimated = irEstimate.irValue;
          netAmount = irEstimate.netAmount;
        } else {
          irRate = 0;
          irEstimated = 0;
          netAmount = amount;
        }
      } else if (!isHistorical) {
        irEstimated = 0;
      }

      let relatedTransactionId: string | null = null;
      const movementRef = doc(
        collection(this.firestore, `users/${uid}/investments/${input.investmentId}/movements`)
      );
      if (!isHistorical) {
        const txRef = doc(collection(this.firestore, `users/${uid}/transactions`));
        relatedTransactionId = txRef.id;
        const description =
          irEstimated && irEstimated > 0
            ? `Resgate de investimento: ${investment.name} | IR estimado descontado: R$ ${irEstimated.toFixed(
                2
              )}`
            : `Resgate de investimento: ${investment.name}`;
        tx.set(txRef, {
          type: 'income',
          description,
          amount: netAmount,
          date: input.date,
          categoryId: input.categoryId || null,
          accountId,
          accountOriginId: null,
          accountDestinationId: null,
          notes: input.notes || null,
          investmentId: input.investmentId,
          investmentAction: 'withdraw',
          source: 'investment_movement',
          createdAt: serverTimestamp()
        });
      }

      const movementPayload = {
        userId: uid,
        investmentId: input.investmentId,
        type: 'withdraw',
        amount,
        grossAmount: amount,
        netAmount,
        irEstimated,
        irRate,
        date: input.date,
        accountId: accountId || null,
        accountNameSnapshot: account?.name ?? null,
        note: input.notes || null,
        relatedTransactionId,
        isHistorical,
        affectsAccounts: !isHistorical,
        source: isHistorical ? 'investment_only' : 'ledger',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      if (!environment.production) {
        console.log('[Investments] movement write', {
          path: movementRef.path,
          payload: movementPayload
        });
      }

      tx.set(movementRef, movementPayload);

      if (!isHistorical) {
        const principalBase = Number(investment.principalBase ?? 0);
        const nextBase = Math.max(0, principalBase - amount);
        if (!Number.isFinite(nextBase)) {
          throw new Error('Valor invalido.');
        }
        tx.update(investmentRef, {
          principalBase: nextBase,
          updatedAt: serverTimestamp()
        });
      }
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
