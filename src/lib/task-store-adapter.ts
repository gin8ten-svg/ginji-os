import type { SupabaseTaskRepository } from '@/lib/supabase-task-repository';
import type { LocalTaskRepository, RepositoryLoadResult } from '@/lib/task-repository';
import type { Routine, RoutineCompletion, Task, TaskStore } from '@/types/tasks';

export interface AsyncTaskStoreAdapter {
  load(): Promise<RepositoryLoadResult>;
  saveTask(task: Task): Promise<TaskStore>;
  deleteTask(id: string): Promise<TaskStore>;
  saveRoutine(routine: Routine): Promise<TaskStore>;
  deleteRoutine(id: string): Promise<TaskStore>;
  setRoutineCompletion(routineId: string, date: string, completed: boolean): Promise<TaskStore>;
}

abstract class StatefulAdapter {
  protected store: TaskStore | null = null;
  protected current(): TaskStore {
    if (!this.store) throw new Error('データがまだ読み込まれていません。');
    return this.store;
  }
}

export class LocalTaskStoreAdapter extends StatefulAdapter implements AsyncTaskStoreAdapter {
  constructor(private readonly repository: LocalTaskRepository) { super(); }

  async load(): Promise<RepositoryLoadResult> {
    const result = this.repository.load();
    this.store = result.store;
    return result;
  }

  private persist(update: (current: TaskStore) => TaskStore): TaskStore {
    const next = update(this.current());
    this.repository.save(next);
    this.store = next;
    return next;
  }

  async saveTask(task: Task) { return this.persist((current) => ({ ...current, tasks: current.tasks.some((item) => item.id === task.id) ? current.tasks.map((item) => item.id === task.id ? task : item) : [task, ...current.tasks] })); }
  async deleteTask(id: string) { return this.persist((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== id) })); }
  async saveRoutine(routine: Routine) { return this.persist((current) => ({ ...current, routines: current.routines.some((item) => item.id === routine.id) ? current.routines.map((item) => item.id === routine.id ? routine : item) : [routine, ...current.routines] })); }
  async deleteRoutine(id: string) { return this.persist((current) => ({ ...current, routines: current.routines.filter((routine) => routine.id !== id), routineCompletions: current.routineCompletions.filter((completion) => completion.routineId !== id) })); }
  async setRoutineCompletion(routineId: string, date: string, completed: boolean) {
    return this.persist((current) => {
      const routineCompletions: RoutineCompletion[] = completed
        ? [...current.routineCompletions, { routineId, date, completedAt: new Date().toISOString() }]
        : current.routineCompletions.filter((item) => item.routineId !== routineId || item.date !== date);
      return { ...current, routineCompletions };
    });
  }
}

export class SupabaseTaskStoreAdapter extends StatefulAdapter implements AsyncTaskStoreAdapter {
  constructor(private readonly repository: SupabaseTaskRepository) { super(); }

  async load(): Promise<RepositoryLoadResult> {
    this.store = await this.repository.loadStore();
    return { store: this.store, recovered: false, backupKey: null };
  }

  async saveTask(task: Task) {
    const current = this.current();
    const existing = current.tasks.some((item) => item.id === task.id);
    const saved = existing ? await this.repository.updateTask(task) : await this.repository.createTask(task);
    this.store = { ...current, tasks: existing ? current.tasks.map((item) => item.id === task.id ? saved : item) : [saved, ...current.tasks] };
    return this.store;
  }
  async deleteTask(id: string) { const current = this.current(); await this.repository.deleteTask(id); this.store = { ...current, tasks: current.tasks.filter((task) => task.id !== id) }; return this.store; }
  async saveRoutine(routine: Routine) { const current = this.current(); const existing = current.routines.some((item) => item.id === routine.id); const saved = existing ? await this.repository.updateRoutine(routine) : await this.repository.createRoutine(routine); this.store = { ...current, routines: existing ? current.routines.map((item) => item.id === routine.id ? saved : item) : [saved, ...current.routines] }; return this.store; }
  async deleteRoutine(id: string) { const current = this.current(); await this.repository.deleteRoutine(id); this.store = { ...current, routines: current.routines.filter((routine) => routine.id !== id), routineCompletions: current.routineCompletions.filter((completion) => completion.routineId !== id) }; return this.store; }
  async setRoutineCompletion(routineId: string, date: string, completed: boolean) { const current = this.current(); await this.repository.setRoutineCompletion(routineId, date, completed); const routineCompletions: RoutineCompletion[] = completed ? [...current.routineCompletions, { routineId, date, completedAt: new Date().toISOString() }] : current.routineCompletions.filter((item) => item.routineId !== routineId || item.date !== date); this.store = { ...current, routineCompletions }; return this.store; }
}
