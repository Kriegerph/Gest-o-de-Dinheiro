import { Injectable } from '@angular/core';
import { Investment, InvestmentYieldMode } from '../models/investment.model';
import { DailyIndex } from '../models/index.model';
import { localDateFromYmd, toYmdFromLocalDate } from '../../../shared/utils/date.util';

export type InvestmentCalculation = {
  initialValue: number;
  totalEstimated: number;
  yieldAfter: number;
  yieldPercent: number;
  updatedAt: string | null;
  indexMissing: boolean;
  placeholderUsed: boolean;
};

export type InvestmentSummary = {
  totalInvested: number;
  totalEstimated: number;
  totalYield: number;
  totalYieldPercent: number;
  updatedAt: string | null;
  indexMissing: boolean;
  count: number;
};

export type IndexContext = {
  cdi: DailyIndex | null;
  selic: DailyIndex | null;
  referenceDate?: Date;
};

@Injectable({ providedIn: 'root' })
export class InvestmentsCalculatorService {
  calculate(investment: Investment, context: IndexContext): InvestmentCalculation {
    const initialValue = this.getInitialValue(investment);
    const start = this.getStartDate(investment);
    const end = this.getReferenceDate(context);
    const fallbackUpdatedAt = toYmdFromLocalDate(end);

    if (!start || initialValue <= 0) {
      return {
        initialValue,
        totalEstimated: initialValue,
        yieldAfter: 0,
        yieldPercent: 0,
        updatedAt: fallbackUpdatedAt,
        indexMissing: this.isIndexMode(investment.yieldMode),
        placeholderUsed: false
      };
    }

    const days = this.daysBetween(start, end);
    const months = this.monthsBetween(start, end);
    if (days <= 0) {
      return {
        initialValue,
        totalEstimated: initialValue,
        yieldAfter: 0,
        yieldPercent: 0,
        updatedAt: fallbackUpdatedAt,
        indexMissing: false,
        placeholderUsed: false
      };
    }

    if (investment.yieldMode === 'manual_monthly' || investment.yieldMode === 'manual_yearly') {
      const totalEstimated = this.calculateManual(
        initialValue,
        investment.yieldMode,
        Number(investment.manualRate ?? 0),
        investment.compounding ?? 'monthly',
        days,
        months
      );
      const yieldAfter = totalEstimated - initialValue;
      return {
        initialValue,
        totalEstimated,
        yieldAfter,
        yieldPercent: initialValue > 0 ? (yieldAfter / initialValue) * 100 : 0,
        updatedAt: fallbackUpdatedAt,
        indexMissing: false,
        placeholderUsed: false
      };
    }

    const index = investment.yieldMode === 'cdi_percent' ? context.cdi : context.selic;
    const indexRate = Number(index?.value ?? 0);
    if (index && indexRate > 0) {
      const totalEstimated = this.calculateIndex(
        initialValue,
        investment.yieldMode,
        investment.cdiPercent ?? 100,
        indexRate,
        investment.compounding ?? 'daily',
        days,
        months
      );
      const yieldAfter = totalEstimated - initialValue;
      return {
        initialValue,
        totalEstimated,
        yieldAfter,
        yieldPercent: initialValue > 0 ? (yieldAfter / initialValue) * 100 : 0,
        updatedAt: index.date ?? fallbackUpdatedAt,
        indexMissing: false,
        placeholderUsed: false
      };
    }

    const placeholderRate = Number(investment.manualRate ?? 0);
    if (placeholderRate > 0) {
      const totalEstimated = this.calculateManual(
        initialValue,
        'manual_monthly',
        placeholderRate,
        investment.compounding ?? 'monthly',
        days,
        months
      );
      const yieldAfter = totalEstimated - initialValue;
      return {
        initialValue,
        totalEstimated,
        yieldAfter,
        yieldPercent: initialValue > 0 ? (yieldAfter / initialValue) * 100 : 0,
        updatedAt: fallbackUpdatedAt,
        indexMissing: true,
        placeholderUsed: true
      };
    }

    return {
      initialValue,
      totalEstimated: initialValue,
      yieldAfter: 0,
      yieldPercent: 0,
      updatedAt: null,
      indexMissing: true,
      placeholderUsed: false
    };
  }

  summarize(investments: Investment[], context: IndexContext): InvestmentSummary {
    const calculations = investments.map((investment) => this.calculate(investment, context));
    const totalInvested = this.sum(investments.map((investment) => Number(investment.principalBase ?? 0)));
    const totalEstimated = this.sum(calculations.map((calc) => calc.totalEstimated));
    const totalYield = this.sum(calculations.map((calc) => calc.yieldAfter));
    const totalYieldPercent = totalInvested > 0 ? (totalYield / totalInvested) * 100 : 0;
    const updatedAt = this.pickLatestDate(calculations.map((calc) => calc.updatedAt));
    const indexMissing = calculations.some((calc) => calc.indexMissing);

    return {
      totalInvested,
      totalEstimated,
      totalYield,
      totalYieldPercent,
      updatedAt,
      indexMissing,
      count: investments.length
    };
  }

  private getInitialValue(investment: Investment) {
    const base = Number(investment.principalBase ?? 0);
    const preApp = investment.hadBeforeApp ? Number(investment.preAppYield ?? 0) : 0;
    return base + preApp;
  }

  private getStartDate(investment: Investment): Date | null {
    const systemDate = localDateFromYmd(investment.systemStartDate);
    if (systemDate) {
      return systemDate;
    }
    return localDateFromYmd(investment.realStartDate);
  }

  private getReferenceDate(context: IndexContext): Date {
    const now = context.referenceDate ? new Date(context.referenceDate) : new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  private calculateManual(
    initialValue: number,
    yieldMode: InvestmentYieldMode,
    ratePercent: number,
    compounding: 'daily' | 'monthly',
    days: number,
    months: number
  ) {
    const rate = Math.max(0, ratePercent) / 100;
    if (rate <= 0) {
      return initialValue;
    }
    if (compounding === 'monthly') {
      const monthlyRate =
        yieldMode === 'manual_yearly' ? Math.pow(1 + rate, 1 / 12) - 1 : rate;
      return initialValue * Math.pow(1 + monthlyRate, Math.max(0, months));
    }
    const dailyRate =
      yieldMode === 'manual_yearly'
        ? Math.pow(1 + rate, 1 / 365) - 1
        : Math.pow(1 + rate, 1 / 30) - 1;
    return initialValue * Math.pow(1 + dailyRate, Math.max(0, days));
  }

  private calculateIndex(
    initialValue: number,
    yieldMode: InvestmentYieldMode,
    cdiPercent: number,
    indexRatePercent: number,
    compounding: 'daily' | 'monthly',
    days: number,
    months: number
  ) {
    const baseRate = Math.max(0, indexRatePercent) / 100;
    const multiplier = yieldMode === 'cdi_percent' ? Math.max(0, cdiPercent) / 100 : 1;
    const dailyRate = baseRate * multiplier;
    if (dailyRate <= 0) {
      return initialValue;
    }
    if (compounding === 'monthly') {
      const monthlyRate = Math.pow(1 + dailyRate, 30) - 1;
      return initialValue * Math.pow(1 + monthlyRate, Math.max(0, months));
    }
    return initialValue * Math.pow(1 + dailyRate, Math.max(0, days));
  }

  private daysBetween(start: Date, end: Date): number {
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const diff = endDay.getTime() - startDay.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  private monthsBetween(start: Date, end: Date): number {
    const startMonth = start.getFullYear() * 12 + start.getMonth();
    const endMonth = end.getFullYear() * 12 + end.getMonth();
    let months = endMonth - startMonth;
    if (end.getDate() < start.getDate()) {
      months -= 1;
    }
    return Math.max(0, months);
  }

  private sum(values: number[]): number {
    return values.reduce((acc, cur) => acc + cur, 0);
  }

  private pickLatestDate(values: Array<string | null>): string | null {
    const dates = values.filter((value): value is string => Boolean(value));
    if (!dates.length) {
      return null;
    }
    return dates.sort((a, b) => (a > b ? -1 : 1))[0];
  }

  private isIndexMode(mode: InvestmentYieldMode) {
    return mode === 'cdi_percent' || mode === 'selic';
  }
}
