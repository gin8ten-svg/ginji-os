import { shiftTokyoDate, tokyoDateKey } from '@/lib/date-time';
import type { Routine, Task, TaskStore } from '@/types/tasks';

const STORAGE_KEY = 'ginji-os:tasks-routines:v1';

export interface TaskRepository {
  load(): TaskStore;
  save(store: TaskStore): void;
}
function dueAt(dateKey: string, time: string): string {
  return new Date(`${dateKey}T${time}:00+09:00`).toISOString();
}

export function createInitialStore(now = new Date()): TaskStore {
  const today = tokyoDateKey(now);
  const createdAt = now.toISOString();
  const task = (value: Omit<Task, 'createdAt' | 'updatedAt' | 'source'>): Task => ({
    ...value,
    createdAt,
    updatedAt: createdAt,
    source: 'sample',
  });
  const routine = (value: Omit<Routine, 'createdAt' | 'updatedAt' | 'source'>): Routine => ({
    ...value,
    createdAt,
    updatedAt: createdAt,
    source: 'sample',
  });

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

function isTaskStore(value: unknown): value is TaskStore {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TaskStore>;
  return candidate.version === 1 && Array.isArray(candidate.tasks) && Array.isArray(candidate.routines) && Array.isArray(candidate.routineCompletions);
}

export class LocalStorageTaskRepository implements TaskRepository {
  load(): TaskStore {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      const initial = createInitialStore();
      this.save(initial);
      return initial;
    }
    const parsed: unknown = JSON.parse(saved);
    if (!isTaskStore(parsed)) throw new Error('保存データの形式が対応していません。');
    return parsed;
  }

  save(store: TaskStore): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }
}

export function createId(prefix: 'task' | 'routine'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
