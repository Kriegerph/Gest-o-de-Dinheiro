export type IndexType = 'cdi' | 'selic';

export interface DailyIndex {
  id?: string;
  type: IndexType;
  date: string;
  value: number;
  source?: string;
  updatedAt?: any;
}
