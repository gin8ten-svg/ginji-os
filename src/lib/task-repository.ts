import { shiftTokyoDate, tokyoDateKey } from '@/lib/date-time';
import type { DataSource, Priority, Routine, RoutineCompletion, RoutineFrequency, Task, TaskStore, Weekday } from '@/types/tasks';

export const STORAGE_KEY = 'ginji-os:tasks-routines:v1';
export const CORRUPT_STORAGE_PREFIX = 'ginji-os:tasks-routines:corrupt:';
export const MANUAL_BACKUP_PREFIX = 'ginji-os:tasks-routines:backup:';

type StorageAdapter = Pick<Storage, 'getItem' | 'setItem'>;

export interface RepositoryLoadResult {
  store: TaskStore;
  recovered: boolean;
  backupKey: string | null;
}

export interface TaskRepository {
  load(): RepositoryLoadResult;
  save(store: TaskStore): void;
  resetWithBackup(): TaskStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function isNullableIsoDate(value: unknown): value is string | null {
  return value === null || isIsoDate(value);
}

function isPriority(value: unknown): value is Priority {
  return Number.isInteger(value) && typeof value === 'number' && value >= 1 && value <= 5;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isDataSource(value: unknown): value is DataSource {
  return value === 'sample' || value === 'user';
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isNullableTime(value: unknown): value is string | null {
  return value === null || isTime(value);
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00+09:00`);
  return !Number.isNaN(date.getTime()) && tokyoDateKey(date) === value;
}

function isWeekday(value: unknown): value is Weekday {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

function isRoutineFrequency(value: unknown): value is RoutineFrequency {
  if (!isRecord(value)) return false;
  if (value.type === 'daily') return true;
  return value.type === 'weekdays' && Array.isArray(value.weekdays) && value.weekdays.every(isWeekday);
}

export function isTask(value: unknown): value is Task {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id)
    && isNonEmptyString(value.title)
    && typeof value.description === 'string'
    && isNullableIsoDate(value.dueAt)
    && isPriority(value.priority)
    && isPositiveInteger(value.estimatedMinutes)
    && typeof value.category === 'string'
    && isNullableIsoDate(value.completedAt)
    && isIsoDate(value.createdAt)
    && isIsoDate(value.updatedAt)
    && isDataSource(value.source);
}

export function isRoutine(value: unknown): value is Routine {
  if (!isRecord(value)) return false;
  const validTimeRange = isNullableTime(value.availableStartTime)
    && isNullableTime(value.availableEndTime)
    && ((value.availableStartTime === null && value.availableEndTime === null)
      || (typeof value.availableStartTime === 'string' && typeof value.availableEndTime === 'string' && value.availableStartTime < value.availableEndTime));
  return isNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && typeof value.description === 'string'
    && isRoutineFrequency(value.frequency)
    && isPositiveInteger(value.estimatedMinutes)
    && isPriority(value.priority)
    && typeof value.category === 'string'
    && validTimeRange
    && typeof value.isActive === 'boolean'
    && isIsoDate(value.createdAt)
    && isIsoDate(value.updatedAt)
    && isDataSource(value.source);
}

export function isRoutineCompletion(value: unknown): value is RoutineCompletion {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.routineId) && isDateKey(value.date) && isIsoDate(value.completedAt);
}

export function isTaskStore(value: unknown): value is TaskStore {
  if (!isRecord(value)) return false;
  return value.version === 1
    && Array.isArray(value.tasks) && value.tasks.every(isTask)
    && Array.isArray(value.routines) && value.routines.every(isRoutine)
    && Array.isArray(value.routineCompletions) && value.routineCompletions.every(isRoutineCompletion);
}

function dueAt(dateKey: string, time: string): string {
  return new Date(`${dateKey}T${time}:00+09:00`).toISOString();
}

export function createInitialStore(now = new Date()): TaskStore {
  const today = tokyoDateKey(now);
  const createdAt = now.toISOString();
  const task = (value: Omit<Task, 'createdAt' | 'updatedAt' | 'source'>): Task => ({ ...value, createdAt, updatedAt: createdAt, source: 'sample' });
  const routine = (value: Omit<Routine, 'createdAt' | 'updatedAt' | 'source'>): Routine => ({ ...value, createdAt, updatedAt: createdAt, source: 'sample' });
  return {
    version: 1,
    tasks: [
      task({ id: 'sample-task-sales', title: '営業資料の修正', description: '顧客向け提案資料の表紙を更新', dueAt: dueAt(today, '18:00'), priority: 5, estimatedMinutes: 60, category: '仕事', completedAt: null }),
      task({ id: 'sample-task-portfolio', title: 'ポートフォリオ更新', description: '最新の成果を追加', dueAt: dueAt(shiftTokyoDate(today, -1), '18:00'), priority: 4, estimatedMinutes: 90, category: '仕事', completedAt: null }),
      task({ id: 'sample-task-budget', title: '家計の見直し', description: '先月の支出を確認', dueAt: dueAt(shiftTokyoDate(today, 1), '20:00'), priority: 2, estimatedMinutes: 20, category: '生活', completedAt: null }),
      task({ id: 'sample-task-inbox', title: '読みたい本を整理', description: '', dueAt: null, priority: 1, estimatedMinutes: 15, category: '学習', completedAt: null }),
    ],
    routines: [
      routine({ id: 'sample-routine-english', name: '英語学習', description: '単語とリスニングを復習', frequency: { type: 'daily' }, estimatedMinutes: 30, priority: 3, category: '学習', availableStartTime: '07:00', availableEndTime: '09:00', isActive: true }),
      routine({ id: 'sample-routine-review', name: '明日の予定を確認', description: 'カレンダーとタスクを確認', frequency: { type: 'weekdays', weekdays: [1, 2, 3, 4, 5] }, estimatedMinutes: 10, priority: 2, category: '生活', availableStartTime: '21:00', availableEndTime: '23:00', isActive: true }),
    ],
    routineCompletions: [],
  };
}

export class LocalTaskRepository implements TaskRepository {
  constructor(
    private readonly storage?: StorageAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private getStorage(): StorageAdapter {
    return this.storage ?? window.localStorage;
  }

  load(): RepositoryLoadResult {
    const storage = this.getStorage();
    const saved = storage.getItem(STORAGE_KEY);
    if (!saved) {
      const initial = createInitialStore(this.now());
      this.save(initial);
      return { store: initial, recovered: false, backupKey: null };
    }
    try {
      const parsed: unknown = JSON.parse(saved);
      if (!isTaskStore(parsed)) throw new Error('invalid task store');
      return { store: parsed, recovered: false, backupKey: null };
    } catch {
      const backupKey = `${CORRUPT_STORAGE_PREFIX}${this.now().toISOString()}`;
      storage.setItem(backupKey, saved);
      const initial = createInitialStore(this.now());
      this.save(initial);
      return { store: initial, recovered: true, backupKey };
    }
  }

  save(store: TaskStore): void {
    if (!isTaskStore(store)) throw new Error('保存しようとしたデータが不正です。');
    this.getStorage().setItem(STORAGE_KEY, JSON.stringify(store));
  }

  resetWithBackup(): TaskStore {
    const storage = this.getStorage();
    const saved = storage.getItem(STORAGE_KEY);
    if (saved) storage.setItem(`${MANUAL_BACKUP_PREFIX}${this.now().toISOString()}`, saved);
    const initial = createInitialStore(this.now());
    this.save(initial);
    return initial;
  }
}

/** @deprecated Use LocalTaskRepository. Kept for compatibility with Milestone 1 callers. */
export { LocalTaskRepository as LocalStorageTaskRepository };

export function createId(prefix: 'task' | 'routine'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
