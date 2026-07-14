import type { SupabaseClient } from '@supabase/supabase-js';
import { categoryMap, completionFromRow, routineFromRow, taskFromRow } from '@/lib/supabase/converters';
import type { Database } from '@/types/database';
import type { Routine, RoutineCompletion, Task, TaskStore } from '@/types/tasks';

export class SupabaseRepositoryError extends Error {
  constructor(operation: string, detail: string) {
    super(`${operation}に失敗しました: ${detail}`);
    this.name = 'SupabaseRepositoryError';
  }
}

export class SupabaseTaskRepository {
  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly userId: string,
  ) {}

  private async categories() {
    const { data, error } = await this.client.from('categories').select('*').eq('user_id', this.userId);
    if (error) throw new SupabaseRepositoryError('カテゴリー取得', error.message);
    return categoryMap(data);
  }

  private async categoryId(name: string): Promise<string | null> {
    const normalized = name.trim();
    if (!normalized) return null;
    const { data, error } = await this.client.from('categories')
      .upsert({ user_id: this.userId, name: normalized }, { onConflict: 'user_id,name' })
      .select('id').eq('user_id', this.userId).single();
    if (error) throw new SupabaseRepositoryError('カテゴリー保存', error.message);
    return data.id;
  }

  async loadStore(): Promise<TaskStore> {
    const [categories, taskResult, routineResult, completionResult] = await Promise.all([
      this.categories(),
      this.client.from('tasks').select('*').eq('user_id', this.userId).order('created_at', { ascending: false }),
      this.client.from('routines').select('*').eq('user_id', this.userId).order('created_at', { ascending: false }),
      this.client.from('routine_completions').select('*').eq('user_id', this.userId),
    ]);
    if (taskResult.error) throw new SupabaseRepositoryError('タスク取得', taskResult.error.message);
    if (routineResult.error) throw new SupabaseRepositoryError('ルーティン取得', routineResult.error.message);
    if (completionResult.error) throw new SupabaseRepositoryError('実行履歴取得', completionResult.error.message);
    return {
      version: 1,
      tasks: taskResult.data.map((row) => taskFromRow(row, categories)),
      routines: routineResult.data.map((row) => routineFromRow(row, categories)),
      routineCompletions: completionResult.data.map(completionFromRow),
    };
  }

  async listTasks(): Promise<Task[]> {
    const [categories, result] = await Promise.all([
      this.categories(),
      this.client.from('tasks').select('*').eq('user_id', this.userId).order('created_at', { ascending: false }),
    ]);
    if (result.error) throw new SupabaseRepositoryError('タスク取得', result.error.message);
    return result.data.map((row) => taskFromRow(row, categories));
  }

  async createTask(task: Task): Promise<Task> {
    const categoryId = await this.categoryId(task.category);
    const { data, error } = await this.client.from('tasks').insert({
      user_id: this.userId, title: task.title, description: task.description || null,
      status: task.completedAt ? 'completed' : 'inbox', priority: task.priority, due_at: task.dueAt,
      estimated_minutes: task.estimatedMinutes, remaining_minutes: task.remainingMinutes,
      splittable: task.splittable, minimum_block_minutes: task.minimumBlockMinutes,
      category_id: categoryId, completed_at: task.completedAt,
    }).select('*').eq('user_id', this.userId).single();
    if (error) throw new SupabaseRepositoryError('タスク作成', error.message);
    return taskFromRow(data, categoryId ? new Map([[categoryId, task.category.trim()]]) : new Map());
  }

  async updateTask(task: Task): Promise<Task> {
    const categoryId = await this.categoryId(task.category);
    const { data, error } = await this.client.from('tasks').update({
      title: task.title, description: task.description || null, status: task.completedAt ? 'completed' : 'inbox',
      priority: task.priority, due_at: task.dueAt, estimated_minutes: task.estimatedMinutes,
      remaining_minutes: task.remainingMinutes, splittable: task.splittable,
      minimum_block_minutes: task.minimumBlockMinutes, category_id: categoryId,
      completed_at: task.completedAt,
    }).eq('id', task.id).eq('user_id', this.userId).select('*').single();
    if (error) throw new SupabaseRepositoryError('タスク更新', error.message);
    return taskFromRow(data, categoryId ? new Map([[categoryId, task.category.trim()]]) : new Map());
  }

  async deleteTask(id: string): Promise<void> {
    const { error } = await this.client.from('tasks').delete().eq('id', id).eq('user_id', this.userId);
    if (error) throw new SupabaseRepositoryError('タスク削除', error.message);
  }

  async listRoutines(): Promise<Routine[]> {
    const [categories, result] = await Promise.all([
      this.categories(),
      this.client.from('routines').select('*').eq('user_id', this.userId).order('created_at', { ascending: false }),
    ]);
    if (result.error) throw new SupabaseRepositoryError('ルーティン取得', result.error.message);
    return result.data.map((row) => routineFromRow(row, categories));
  }

  async createRoutine(routine: Routine): Promise<Routine> {
    return this.writeRoutine('insert', routine);
  }

  async updateRoutine(routine: Routine): Promise<Routine> {
    return this.writeRoutine('update', routine);
  }

  private async writeRoutine(mode: 'insert' | 'update', routine: Routine): Promise<Routine> {
    const categoryId = await this.categoryId(routine.category);
    const values = {
      user_id: this.userId, name: routine.name, description: routine.description || null,
      frequency_type: routine.frequency.type,
      weekdays: routine.frequency.type === 'weekdays' ? routine.frequency.weekdays : [],
      estimated_minutes: routine.estimatedMinutes, priority: routine.priority, category_id: categoryId,
      available_start_time: routine.availableStartTime, available_end_time: routine.availableEndTime,
      is_active: routine.isActive,
    };
    const query = mode === 'insert'
      ? this.client.from('routines').insert(values)
      : this.client.from('routines').update(values).eq('id', routine.id).eq('user_id', this.userId);
    const { data, error } = await query.select('*').eq('user_id', this.userId).single();
    if (error) throw new SupabaseRepositoryError(`ルーティン${mode === 'insert' ? '作成' : '更新'}`, error.message);
    return routineFromRow(data, categoryId ? new Map([[categoryId, routine.category.trim()]]) : new Map());
  }

  async deleteRoutine(id: string): Promise<void> {
    const { error } = await this.client.from('routines').delete().eq('id', id).eq('user_id', this.userId);
    if (error) throw new SupabaseRepositoryError('ルーティン削除', error.message);
  }

  async listRoutineCompletions(): Promise<RoutineCompletion[]> {
    const { data, error } = await this.client.from('routine_completions').select('*').eq('user_id', this.userId);
    if (error) throw new SupabaseRepositoryError('実行履歴取得', error.message);
    return data.map(completionFromRow);
  }

  async setRoutineCompletion(routineId: string, date: string, completed: boolean): Promise<void> {
    const query = completed
      ? this.client.from('routine_completions').upsert(
          { user_id: this.userId, routine_id: routineId, target_date: date, completed_at: new Date().toISOString() },
          { onConflict: 'routine_id,target_date' },
        )
      : this.client.from('routine_completions').delete().eq('routine_id', routineId).eq('target_date', date).eq('user_id', this.userId);
    const { error } = await query;
    if (error) throw new SupabaseRepositoryError('実行履歴更新', error.message);
  }
}
