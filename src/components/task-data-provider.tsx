'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LocalStorageTaskRepository } from '@/lib/task-repository';
import { tokyoDateKey } from '@/lib/date-time';
import type { Routine, RoutineCompletion, Task, TaskStore } from '@/types/tasks';

interface TaskDataContextValue {
  store: TaskStore | null;
  isLoading: boolean;
  error: string | null;
  saveTask(task: Task): void;
  deleteTask(id: string): void;
  saveRoutine(routine: Routine): void;
  deleteRoutine(id: string): void;
  toggleRoutineCompletion(routineId: string, date?: string): void;
}

const TaskDataContext = createContext<TaskDataContextValue | null>(null);

export function TaskDataProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<TaskStore | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const repository = useMemo(() => new LocalStorageTaskRepository(), []);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      try {
        setStore(repository.load());
      } catch {
        setError('端末内のデータを読み込めませんでした。ブラウザのストレージ設定を確認してください。');
      } finally {
        setIsLoading(false);
      }
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [repository]);

  const updateStore = useCallback((updater: (current: TaskStore) => TaskStore) => {
    setStore((current) => {
      if (!current) return current;
      const next = updater(current);
      try {
        repository.save(next);
        setError(null);
        return next;
      } catch {
        setError('変更を端末に保存できませんでした。空き容量やストレージ設定を確認してください。');
        return current;
      }
    });
  }, [repository]);

  const value = useMemo<TaskDataContextValue>(() => ({
    store,
    isLoading,
    error,
    saveTask: (task) => updateStore((current) => ({ ...current, tasks: current.tasks.some((item) => item.id === task.id) ? current.tasks.map((item) => item.id === task.id ? task : item) : [task, ...current.tasks] })),
    deleteTask: (id) => updateStore((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== id) })),
    saveRoutine: (routine) => updateStore((current) => ({ ...current, routines: current.routines.some((item) => item.id === routine.id) ? current.routines.map((item) => item.id === routine.id ? routine : item) : [routine, ...current.routines] })),
    deleteRoutine: (id) => updateStore((current) => ({ ...current, routines: current.routines.filter((routine) => routine.id !== id), routineCompletions: current.routineCompletions.filter((completion) => completion.routineId !== id) })),
    toggleRoutineCompletion: (routineId, date = tokyoDateKey()) => updateStore((current) => {
      const exists = current.routineCompletions.some((completion) => completion.routineId === routineId && completion.date === date);
      const routineCompletions: RoutineCompletion[] = exists
        ? current.routineCompletions.filter((completion) => completion.routineId !== routineId || completion.date !== date)
        : [...current.routineCompletions, { routineId, date, completedAt: new Date().toISOString() }];
      return { ...current, routineCompletions };
    }),
  }), [error, isLoading, store, updateStore]);

  return <TaskDataContext.Provider value={value}>{children}</TaskDataContext.Provider>;
}

export function useTaskData(): TaskDataContextValue {
  const context = useContext(TaskDataContext);
  if (!context) throw new Error('useTaskData must be used within TaskDataProvider');
  return context;
}
