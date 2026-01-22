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
import { firstValueFrom, map, Observable } from 'rxjs';
import { Investment } from '../models/investment.model';
import { DailyIndex } from '../models/index.model';
import {
  daysBetweenLocal,
  localDateFromYmd,
  toLocalDateKey,
  toYmd
} from '../../../shared/utils/date.util';
import { Account } from '../../../core/models/account.model';
import { environment } from '../../../../environments/environment';
import { InvestmentsCalculatorService } from './investments-calculator.service';
import { IndicesService } from './indices.service';

@Injectable({ providedIn: 'root' })
export class InvestmentsService {
  private firestore = inject(Firestore);
  private calculator = inject(InvestmentsCalculatorService);
  private indicesService = inject(IndicesService);
  private dailyYieldRunKeyByUser = new Map<string, string>();
  private dailyYieldRunning = new Set<string>();

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

  async runDailyYieldUpdateForUser(uid: string): Promise<void> {
    if (!uid) {
      return;
    }
    const today = new Date();
    const todayKey = toLocalDateKey(today);
    if (this.dailyYieldRunning.has(uid)) {
      return;
    }
    if (this.dailyYieldRunKeyByUser.get(uid) === todayKey) {
      return;
    }

    this.dailyYieldRunning.add(uid);
    try {
      const [cdi, selic] = await Promise.all([
        firstValueFrom(this.indicesService.latest$('cdi')),
        firstValueFrom(this.indicesService.latest$('selic'))
      ]);
      const ref = collection(this.firestore, `users/${uid}/investments`);
      const snap = await getDocs(ref);
      if (snap.empty) {
        this.dailyYieldRunKeyByUser.set(uid, todayKey);
        return;
      }

      const batch = writeBatch(this.firestore);
      let updates = 0;

      for (const docSnap of snap.docs) {
        const investment = this.normalize({
          id: docSnap.id,
          ...(docSnap.data() as Investment)
        });
        if (investment.status !== 'active') {
          continue;
        }
        if (!this.canCalculateYield(investment, { cdi, selic })) {
          continue;
        }
        const lastCalcDate = this.resolveLastCalculationDate(investment);
        const startDate = lastCalcDate ?? this.resolveYieldStartDate(investment);
        if (!startDate) {
          continue;
        }
        if (daysBetweenLocal(startDate, today) <= 0) {
          continue;
        }

        const calcNow = this.calculator.calculate(investment, {
          cdi,
          selic,
          referenceDate: today
        });
        const calcThen = this.calculator.calculate(investment, {
          cdi,
          selic,
          referenceDate: lastCalcDate ?? startDate
        });
        const yieldDelta = Math.max(0, calcNow.postAppYield - calcThen.postAppYield);
        const storedPostAppYield =
          investment.postAppYield === null || investment.postAppYield === undefined
            ? calcThen.postAppYield
            : Number(investment.postAppYield ?? 0);
        const nextPostAppYield = storedPostAppYield + yieldDelta;
        const nextEstimated = calcNow.initialValue + nextPostAppYield;

        if (!Number.isFinite(nextPostAppYield) || !Number.isFinite(nextEstimated)) {
          continue;
        }

        batch.update(docSnap.ref, {
          postAppYield: nextPostAppYield,
          currentValueEstimated: nextEstimated,
          lastYieldCalculationAt: todayKey,
          updatedAt: serverTimestamp()
        });
        updates += 1;
      }

      if (updates > 0) {
        await batch.commit();
      }
      this.dailyYieldRunKeyByUser.set(uid, todayKey);
      if (!environment.production) {
        console.log('[Investments] daily yield updated', { uid, updates, todayKey });
      }
    } catch (err) {
      console.error('[Investments] daily yield update failed', err);
    } finally {
      this.dailyYieldRunning.delete(uid);
    }
  }

  private normalize(item: Investment): Investment {
    const yieldMode = item.yieldMode ?? 'manual_monthly';
    const compounding =
      item.compounding ?? (yieldMode === 'cdi_percent' || yieldMode === 'selic' ? 'daily' : 'monthly');
    const realStartDate = toYmd(item.realStartDate) || '';
    const systemStartDate = toYmd(item.systemStartDate) || realStartDate;
    const onboardingDate = toYmd(item.onboardingDate) || '';
    const lastYieldCalculationAt =
      toYmd(item.lastYieldCalculationAt ?? item.lastCalculatedAt) || null;
    const postAppYield =
      item.postAppYield === null || item.postAppYield === undefined
        ? null
        : Number(item.postAppYield);
    const currentValueEstimated =
      item.currentValueEstimated === null || item.currentValueEstimated === undefined
        ? null
        : Number(item.currentValueEstimated);

    return {
      ...item,
      type: item.type ?? 'manual',
      status: item.status ?? 'active',
      hadBeforeApp: Boolean(item.hadBeforeApp),
      realStartDate,
      systemStartDate,
      onboardingDate: onboardingDate || null,
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
      lastYieldCalculationAt,
      postAppYield,
      currentValueEstimated,
      yieldMode,
      manualRate: item.manualRate === null || item.manualRate === undefined ? null : Number(item.manualRate),
      cdiPercent: item.cdiPercent === null || item.cdiPercent === undefined ? null : Number(item.cdiPercent),
      compounding
    };
  }

  private canCalculateYield(
    investment: Investment,
    context: { cdi: DailyIndex | null; selic: DailyIndex | null }
  ): boolean {
    if (investment.yieldMode === 'manual_monthly' || investment.yieldMode === 'manual_yearly') {
      return Number(investment.manualRate ?? 0) > 0;
    }
    const placeholderRate = Number(investment.manualRate ?? 0) > 0;
    if (investment.yieldMode === 'cdi_percent') {
      const hasIndex = Number(context.cdi?.value ?? 0) > 0;
      return hasIndex || placeholderRate;
    }
    if (investment.yieldMode === 'selic') {
      const hasIndex = Number(context.selic?.value ?? 0) > 0;
      return hasIndex || placeholderRate;
    }
    return false;
  }

  private resolveLastCalculationDate(investment: Investment): Date | null {
    return this.toLocalDate(investment.lastYieldCalculationAt ?? investment.lastCalculatedAt);
  }

  private resolveYieldStartDate(investment: Investment): Date | null {
    const onboarding = this.toLocalDate(investment.onboardingDate);
    if (onboarding) {
      return onboarding;
    }
    const systemDate = localDateFromYmd(investment.systemStartDate);
    if (systemDate) {
      return systemDate;
    }
    const realDate = localDateFromYmd(investment.realStartDate);
    if (realDate) {
      return realDate;
    }
    return this.toLocalDate(investment.createdAt);
  }

  private toLocalDate(value: any): Date | null {
    if (!value) {
      return null;
    }
    if (typeof value === 'object' && typeof value.toDate === 'function') {
      const date = value.toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
      }
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    if (typeof value === 'string') {
      const ymd = toYmd(value);
      return localDateFromYmd(ymd);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
}
