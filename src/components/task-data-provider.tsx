'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { tokyoDateKey } from '@/lib/date-time';
import { SupabaseTaskRepository } from '@/lib/supabase-task-repository';
import { createClient } from '@/lib/supabase/client';
import { getSupabasePublicEnv } from '@/lib/supabase/env';
import { LocalTaskRepository } from '@/lib/task-repository';
import { repositoryMode } from '@/lib/repository-mode';
import type { Routine, RoutineCompletion, Task, TaskStore } from '@/types/tasks';

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
  const [isHydrated, setIsHydrated] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const localRepository = useMemo(() => new LocalTaskRepository(), []);
  const [remoteRepository, setRemoteRepository] = useState<SupabaseTaskRepository | null>(null);
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
            const repository = new SupabaseTaskRepository(client, data.user.id);
            const remoteStore = await repository.loadStore();
            if (!active) return;
            setRemoteRepository(repository);
            setIsAuthenticated(true);
            setStore(remoteStore);
            return;
          }
        }
        const result = localRepository.load();
        if (!active) return;
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

  const runRemote = useCallback(async (operation: () => Promise<void>, message: string) => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await operation();
      setSuccessMessage(message);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : '変更を保存できませんでした。');
    } finally {
      setIsSaving(false);
    }
  }, [isSaving]);

  const updateLocal = useCallback((updater: (current: TaskStore) => TaskStore) => {
    setError(null);
    setSuccessMessage(null);
    setStore((current) => {
      if (!current) return current;
      const next = updater(current);
      try {
        localRepository.save(next);
        setSuccessMessage('端末に保存しました。');
      } catch {
        setError('変更を端末に保存できませんでした。');
      }
      return next;
    });
  }, [localRepository]);

  const value = useMemo<TaskDataContextValue>(() => ({
    store, isLoading, isHydrated, isAuthenticated, isSaving, error, successMessage, recoveryNotice,
    retry: () => setLoadVersion((version) => version + 1),
    clearFeedback: () => { setError(null); setSuccessMessage(null); },
    saveTask: (task) => {
      if (!remoteRepository) {
        updateLocal((current) => ({ ...current, tasks: current.tasks.some((item) => item.id === task.id) ? current.tasks.map((item) => item.id === task.id ? task : item) : [task, ...current.tasks] }));
        return;
      }
      const exists = store?.tasks.some((item) => item.id === task.id) ?? false;
      void runRemote(async () => {
        const saved = exists ? await remoteRepository.updateTask(task) : await remoteRepository.createTask(task);
        setStore((current) => current ? ({ ...current, tasks: exists ? current.tasks.map((item) => item.id === saved.id ? saved : item) : [saved, ...current.tasks] }) : current);
      }, exists ? 'タスクを更新しました。' : 'タスクを作成しました。');
    },
    deleteTask: (id) => {
      if (!remoteRepository) return updateLocal((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== id) }));
      void runRemote(async () => { await remoteRepository.deleteTask(id); setStore((current) => current ? ({ ...current, tasks: current.tasks.filter((task) => task.id !== id) }) : current); }, 'タスクを削除しました。');
    },
    saveRoutine: (routine) => {
      if (!remoteRepository) return updateLocal((current) => ({ ...current, routines: current.routines.some((item) => item.id === routine.id) ? current.routines.map((item) => item.id === routine.id ? routine : item) : [routine, ...current.routines] }));
      const exists = store?.routines.some((item) => item.id === routine.id) ?? false;
      void runRemote(async () => {
        const saved = exists ? await remoteRepository.updateRoutine(routine) : await remoteRepository.createRoutine(routine);
        setStore((current) => current ? ({ ...current, routines: exists ? current.routines.map((item) => item.id === saved.id ? saved : item) : [saved, ...current.routines] }) : current);
      }, exists ? 'ルーティンを更新しました。' : 'ルーティンを作成しました。');
    },
    deleteRoutine: (id) => {
      const remove = (current: TaskStore) => ({ ...current, routines: current.routines.filter((routine) => routine.id !== id), routineCompletions: current.routineCompletions.filter((completion) => completion.routineId !== id) });
      if (!remoteRepository) return updateLocal(remove);
      void runRemote(async () => { await remoteRepository.deleteRoutine(id); setStore((current) => current ? remove(current) : current); }, 'ルーティンを削除しました。');
    },
    toggleRoutineCompletion: (routineId, date = tokyoDateKey()) => {
      const completed = !(store?.routineCompletions.some((item) => item.routineId === routineId && item.date === date) ?? false);
      const toggle = (current: TaskStore) => {
        const routineCompletions: RoutineCompletion[] = completed
          ? [...current.routineCompletions, { routineId, date, completedAt: new Date().toISOString() }]
          : current.routineCompletions.filter((item) => item.routineId !== routineId || item.date !== date);
        return { ...current, routineCompletions };
      };
      if (!remoteRepository) return updateLocal(toggle);
      void runRemote(async () => { await remoteRepository.setRoutineCompletion(routineId, date, completed); setStore((current) => current ? toggle(current) : current); }, completed ? 'ルーティンを完了しました。' : 'ルーティンを未完了に戻しました。');
    },
  }), [error, isAuthenticated, isHydrated, isLoading, isSaving, recoveryNotice, remoteRepository, runRemote, store, successMessage, updateLocal]);

  return <TaskDataContext.Provider value={value}>{children}</TaskDataContext.Provider>;
}

export function useTaskData(): TaskDataContextValue {
  const context = useContext(TaskDataContext);
  if (!context) throw new Error('useTaskData must be used within TaskDataProvider');
  return context;
}
