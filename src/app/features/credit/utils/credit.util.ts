import { localDateFromYmd, toYmdFromLocalDate } from '../../../shared/utils/date.util';

export function buildMonthlyDueDates(firstDueDate: string, count: number): string[] {
  const base = localDateFromYmd(firstDueDate);
  if (!base || count <= 0) {
    return [];
  }
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const due = new Date(base.getFullYear(), base.getMonth() + i, base.getDate());
    dates.push(toYmdFromLocalDate(due));
  }
  return dates;
}
