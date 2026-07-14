'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { tokyoDateKey } from '@/lib/date-time';
import { SupabaseTaskRepository } from '@/lib/supabase-task-repository';
import { createClient } from '@/lib/supabase/client';
import { getSupabasePublicEnv } from '@/lib/supabase/env';
import { LocalTaskRepository } from '@/lib/task-repository';
import { LocalTaskStoreAdapter, SupabaseTaskStoreAdapter, type AsyncTaskStoreAdapter } from '@/lib/task-store-adapter';
import { repositoryMode } from '@/lib/repository-mode';
import type { Routine, Task, TaskStore } from '@/types/tasks';

interface TaskDataContextValue {
  store: TaskStore | null;
  isLoading: boolean;
  isHydrated: boolean;
  isAuthenticated: boolean;
  isSaving: boolean;
  error: string | null;
  successMessage: string | null;
  recoveryNotice: string | null;
  retry(): void;
  clearFeedback(): void;
  saveTask(task: Task): Promise<void>;
  deleteTask(id: string): Promise<void>;
  saveRoutine(routine: Routine): Promise<void>;
  deleteRoutine(id: string): Promise<void>;
  toggleRoutineCompletion(routineId: string, date?: string): Promise<void>;
}

const TaskDataContext = createContext<TaskDataContextValue | null>(null);

export function TaskDataProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<TaskStore | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const localRepository = useMemo(() => new LocalTaskRepository(), []);
  const adapterRef = useRef<AsyncTaskStoreAdapter | null>(null);
  const savingRef = useRef(false);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const configured = Boolean(getSupabasePublicEnv());
        if (configured) {
          const client = createClient();
          const { data, error: authError } = await client.auth.getUser();
          if (authError && authError.name !== 'AuthSessionMissingError') throw authError;
          if (repositoryMode(configured, data.user?.id) === 'supabase' && data.user) {
            const adapter = new SupabaseTaskStoreAdapter(new SupabaseTaskRepository(client, data.user.id));
            const result = await adapter.load();
            if (!active) return;
            adapterRef.current = adapter;
            setIsAuthenticated(true);
            setStore(result.store);
            return;
          }
        }
        const adapter = new LocalTaskStoreAdapter(localRepository);
        const result = await adapter.load();
        if (!active) return;
        adapterRef.current = adapter;
        setIsAuthenticated(false);
        setStore(result.store);
        if (result.recovered) setRecoveryNotice('破損した保存データを退避し、安全な初期状態へ復旧しました。');
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'データを読み込めませんでした。');
      } finally {
        if (active) {
          setIsHydrated(true);
          setIsLoading(false);
        }
      }
    }
    void load();
    return () => { active = false; };
  }, [loadVersion, localRepository]);

  const runOperation = useCallback(async (operation: (adapter: AsyncTaskStoreAdapter) => Promise<TaskStore>, message: string) => {
    if (savingRef.current) throw new Error('保存処理が進行中です。');
    const adapter = adapterRef.current;
    if (!adapter) throw new Error('データをまだ読み込んでいます。');
    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const next = await operation(adapter);
      setStore(next);
      setSuccessMessage(message);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : '変更を保存できませんでした。');
      throw operationError;
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }, []);

  const value = useMemo<TaskDataContextValue>(() => ({
    store, isLoading, isHydrated, isAuthenticated, isSaving, error, successMessage, recoveryNotice,
    retry: () => setLoadVersion((version) => version + 1),
    clearFeedback: () => { setError(null); setSuccessMessage(null); },
    saveTask: (task) => runOperation((adapter) => adapter.saveTask(task), store?.tasks.some((item) => item.id === task.id) ? 'タスクを更新しました。' : 'タスクを作成しました。'),
    deleteTask: (id) => runOperation((adapter) => adapter.deleteTask(id), 'タスクを削除しました。'),
    saveRoutine: (routine) => runOperation((adapter) => adapter.saveRoutine(routine), store?.routines.some((item) => item.id === routine.id) ? 'ルーティンを更新しました。' : 'ルーティンを作成しました。'),
    deleteRoutine: (id) => runOperation((adapter) => adapter.deleteRoutine(id), 'ルーティンを削除しました。'),
    toggleRoutineCompletion: (routineId, date = tokyoDateKey()) => {
      const completed = !(store?.routineCompletions.some((item) => item.routineId === routineId && item.date === date) ?? false);
      return runOperation((adapter) => adapter.setRoutineCompletion(routineId, date, completed), completed ? 'ルーティンを完了しました。' : 'ルーティンを未完了に戻しました。');
    },
  }), [error, isAuthenticated, isHydrated, isLoading, isSaving, recoveryNotice, runOperation, store, successMessage]);

  return <TaskDataContext.Provider value={value}>{children}</TaskDataContext.Provider>;
}

export function useTaskData(): TaskDataContextValue {
  const context = useContext(TaskDataContext);
  if (!context) throw new Error('useTaskData must be used within TaskDataProvider');
  return context;
}
