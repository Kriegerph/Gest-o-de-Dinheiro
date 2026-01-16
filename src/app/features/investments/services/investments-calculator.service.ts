import { Injectable } from '@angular/core';
import { Investment, InvestmentYieldMode } from '../models/investment.model';
import { DailyIndex } from '../models/index.model';
import { localDateFromYmd, toYmdFromLocalDate } from '../../../shared/utils/date.util';

export type InvestmentCalculation = {
  preAppYield: number;
  postAppYield: number;
  totalYield: number;
  totalReturnPercent: number;
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

export type RescueIrEstimate = {
  grossAmount: number;
  profitPortion: number;
  irRate: number;
  irValue: number;
  netAmount: number;
};

export type IndexContext = {
  cdi: DailyIndex | null;
  selic: DailyIndex | null;
  referenceDate?: Date;
};

@Injectable({ providedIn: 'root' })
export class InvestmentsCalculatorService {
  calculate(investment: Investment, context: IndexContext): InvestmentCalculation {
    const preAppYield = this.getPreAppYield(investment);
    const initialValue = this.getInitialValue(investment);
    const start = this.getStartDate(investment);
    const end = this.getReferenceDate(context);
    const fallbackUpdatedAt = toYmdFromLocalDate(end);

    if (!start || initialValue <= 0) {
      return this.buildResult(
        investment,
        preAppYield,
        initialValue,
        initialValue,
        0,
        0,
        fallbackUpdatedAt,
        this.isIndexMode(investment.yieldMode),
        false
      );
    }

    const days = this.daysBetween(start, end);
    const months = this.monthsBetween(start, end);
    if (days <= 0) {
      return this.buildResult(
        investment,
        preAppYield,
        initialValue,
        initialValue,
        0,
        0,
        fallbackUpdatedAt,
        false,
        false
      );
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
      return this.buildResult(
        investment,
        preAppYield,
        initialValue,
        totalEstimated,
        yieldAfter,
        initialValue > 0 ? (yieldAfter / initialValue) * 100 : 0,
        fallbackUpdatedAt,
        false,
        false
      );
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
      return this.buildResult(
        investment,
        preAppYield,
        initialValue,
        totalEstimated,
        yieldAfter,
        initialValue > 0 ? (yieldAfter / initialValue) * 100 : 0,
        index.date ?? fallbackUpdatedAt,
        false,
        false
      );
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
      return this.buildResult(
        investment,
        preAppYield,
        initialValue,
        totalEstimated,
        yieldAfter,
        initialValue > 0 ? (yieldAfter / initialValue) * 100 : 0,
        fallbackUpdatedAt,
        true,
        true
      );
    }

    return this.buildResult(
      investment,
      preAppYield,
      initialValue,
      initialValue,
      0,
      0,
      null,
      true,
      false
    );
  }

  summarize(investments: Investment[], context: IndexContext): InvestmentSummary {
    const activeInvestments = investments.filter((investment) => investment.status === 'active');
    const calculations = activeInvestments.map((investment) => this.calculate(investment, context));
    const totalInvested = this.sum(
      activeInvestments.map((investment) => Number(investment.principalBase ?? 0))
    );
    const totalEstimated = this.sum(calculations.map((calc) => calc.totalEstimated));
    const totalYield = this.sum(calculations.map((calc) => calc.totalYield));
    const totalBase = this.sum(
      activeInvestments.map((investment) => {
        const totalInvestedToDate = Number(investment.totalInvestedToDate ?? 0);
        if (totalInvestedToDate > 0) {
          return totalInvestedToDate;
        }
        const preAppYield = this.getPreAppYield(investment);
        return this.getPrincipalBaseForReturn(investment, preAppYield);
      })
    );
    const totalYieldPercent = totalBase > 0 ? (totalYield / totalBase) * 100 : 0;
    const updatedAt = this.pickLatestDate(calculations.map((calc) => calc.updatedAt));
    const indexMissing = calculations.some((calc) => calc.indexMissing);

    return {
      totalInvested,
      totalEstimated,
      totalYield,
      totalYieldPercent,
      updatedAt,
      indexMissing,
      count: activeInvestments.length
    };
  }

  calculateRescueIR(params: {
    principalBase: number;
    currentValue: number;
    rescueAmount: number;
    investmentStartDate: string | Date | null;
    referenceDate?: Date;
  }): RescueIrEstimate {
    const grossAmount = Math.max(0, Number(params.rescueAmount ?? 0));
    const currentValue = Math.max(0, Number(params.currentValue ?? 0));
    const principalBase = Math.max(0, Number(params.principalBase ?? 0));
    const totalProfit = Math.max(currentValue - principalBase, 0);
    const ratio =
      currentValue > 0 ? Math.min(Math.max(grossAmount / currentValue, 0), 1) : 0;
    const profitPortion = totalProfit > 0 ? totalProfit * ratio : 0;
    const startDate =
      typeof params.investmentStartDate === 'string'
        ? localDateFromYmd(params.investmentStartDate)
        : params.investmentStartDate instanceof Date
          ? params.investmentStartDate
          : null;
    const referenceDate = params.referenceDate ? new Date(params.referenceDate) : new Date();
    const days = startDate ? this.daysBetween(startDate, referenceDate) : 0;
    const irRate = totalProfit > 0 ? this.resolveIrRate(days) : 0;
    const irValue = Math.max(0, profitPortion * irRate);
    const netAmount = Math.max(0, grossAmount - irValue);

    return {
      grossAmount,
      profitPortion,
      irRate,
      irValue,
      netAmount
    };
  }

  private getInitialValue(investment: Investment) {
    const base = Number(investment.principalBase ?? 0);
    const preApp = this.getPreAppYield(investment);
    return base + preApp;
  }

  private getPreAppYield(investment: Investment) {
    return investment.hadBeforeApp ? Number(investment.preAppYield ?? 0) : 0;
  }

  private getPrincipalBaseForReturn(investment: Investment, preAppYield: number) {
    if (
      investment.hadBeforeApp &&
      investment.currentValueAtOnboarding !== null &&
      investment.currentValueAtOnboarding !== undefined
    ) {
      return Math.max(0, Number(investment.currentValueAtOnboarding) - preAppYield);
    }
    return Number(investment.principalBase ?? 0);
  }

  private getTotalReturnPercent(
    investment: Investment,
    totalYield: number,
    principalBaseForReturn: number
  ) {
    const totalInvested = Number(investment.totalInvestedToDate ?? 0);
    if (totalInvested > 0) {
      return (totalYield / totalInvested) * 100;
    }
    if (principalBaseForReturn > 0) {
      return (totalYield / principalBaseForReturn) * 100;
    }
    return 0;
  }

  private buildResult(
    investment: Investment,
    preAppYield: number,
    initialValue: number,
    totalEstimated: number,
    postAppYield: number,
    postAppYieldPercent: number,
    updatedAt: string | null,
    indexMissing: boolean,
    placeholderUsed: boolean
  ): InvestmentCalculation {
    const totalYield = preAppYield + postAppYield;
    const principalBaseForReturn = this.getPrincipalBaseForReturn(investment, preAppYield);
    const totalReturnPercent = this.getTotalReturnPercent(
      investment,
      totalYield,
      principalBaseForReturn
    );

    return {
      preAppYield,
      postAppYield,
      totalYield,
      totalReturnPercent,
      initialValue,
      totalEstimated,
      yieldAfter: postAppYield,
      yieldPercent: postAppYieldPercent,
      updatedAt,
      indexMissing,
      placeholderUsed
    };
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

  private resolveIrRate(days: number) {
    const safeDays = Math.max(0, Math.floor(days));
    if (safeDays <= 180) {
      return 0.225;
    }
    if (safeDays <= 360) {
      return 0.2;
    }
    if (safeDays <= 720) {
      return 0.175;
    }
    return 0.15;
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
