export function toYmd(value: any): string {
  if (!value) {
    return '';
  }

  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const d: Date = value.toDate();
    return toYmdFromLocalDate(d);
  }

  if (value instanceof Date) {
    return toYmdFromLocalDate(value);
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const d = new Date(value);
  if (!isNaN(d.getTime())) {
    return toYmdFromLocalDate(d);
  }

  return '';
}

export function toYmdFromLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatPtBrFromYmd(ymd: string): string {
  if (!ymd) {
    return '';
  }
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) {
    return ymd;
  }
  return new Intl.DateTimeFormat('pt-BR').format(new Date(y, m - 1, d));
}

export function localDateFromYmd(ymd: string): Date | null {
  if (!ymd) {
    return null;
  }
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) {
    return null;
  }
  return new Date(y, m - 1, d);
}

export function toLocalDateKey(date: Date, timeZone = 'America/Sao_Paulo'): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

export function daysBetweenLocal(start: Date, end: Date, timeZone = 'America/Sao_Paulo'): number {
  const startKey = toLocalDateKey(start, timeZone);
  const endKey = toLocalDateKey(end, timeZone);
  const [startYear, startMonth, startDay] = startKey.split('-').map(Number);
  const [endYear, endMonth, endDay] = endKey.split('-').map(Number);
  const startUtc = Date.UTC(startYear, startMonth - 1, startDay);
  const endUtc = Date.UTC(endYear, endMonth - 1, endDay);
  const diff = endUtc - startUtc;
  if (diff <= 0) {
    return 0;
  }
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
