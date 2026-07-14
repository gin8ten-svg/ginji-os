import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { SupabaseRepositoryError, SupabaseTaskRepository } from './supabase-task-repository';
import type { Database, RoutineRow, TaskRow } from '@/types/database';
import type { Routine, Task } from '@/types/tasks';

type Operation = 'select' | 'insert' | 'update' | 'delete' | 'upsert';
type QueryResult = { data: unknown; error: { message: string } | null };
type Call = { table: string; operation: Operation; payload?: unknown; filters: Array<[string, unknown]> };

class StubQuery implements PromiseLike<QueryResult> {
  private operation: Operation = 'select';
  private readonly filters: Array<[string, unknown]> = [];
  private call: Call | null = null;

  constructor(private readonly owner: FakeSupabase, private readonly table: string) {}

  private record(operation: Operation, payload?: unknown) {
    this.operation = operation;
    this.call = { table: this.table, operation, payload, filters: this.filters };
    this.owner.calls.push(this.call);
    return this;
  }

  select() { return this.call ? this : this.record('select'); }
  insert(payload: unknown) { return this.record('insert', payload); }
  update(payload: unknown) { return this.record('update', payload); }
  delete() { return this.record('delete'); }
  upsert(payload: unknown) { return this.record('upsert', payload); }
  order() { return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  single(): Promise<QueryResult> { return Promise.resolve(this.owner.result(this.table, this.operation)); }
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.owner.result(this.table, this.operation)).then(onfulfilled, onrejected);
  }
}

class FakeSupabase {
  readonly calls: Call[] = [];
  private readonly results = new Map<string, QueryResult[]>();

  queue(table: string, operation: Operation, result: QueryResult) {
    const key = `${table}:${operation}`;
    this.results.set(key, [...(this.results.get(key) ?? []), result]);
  }

  result(table: string, operation: Operation): QueryResult {
    const key = `${table}:${operation}`;
    const queue = this.results.get(key) ?? [];
    const result = queue.shift();
    this.results.set(key, queue);
    return result ?? { data: [], error: null };
  }

  client(): SupabaseClient<Database> {
    return { from: (table: string) => new StubQuery(this, table) } as unknown as SupabaseClient<Database>;
  }
}

const timestamps = { created_at: '2026-07-15T00:00:00.000Z', updated_at: '2026-07-15T00:00:00.000Z' };
const dbTaskId = '11111111-1111-4111-8111-111111111111';
const dbRoutineId = '22222222-2222-4222-8222-222222222222';

function appTask(id = 'task-local-id'): Task {
  return { id, title: 'Task', description: '', dueAt: null, priority: 3, estimatedMinutes: 30, remainingMinutes: 30, splittable: true, minimumBlockMinutes: 25, category: '', completedAt: null, createdAt: timestamps.created_at, updatedAt: timestamps.updated_at, source: 'user' };
}

function taskRow(id = dbTaskId): TaskRow {
  return { id, user_id: 'user-id', title: 'Task', description: null, status: 'inbox', priority: 3, due_at: null, estimated_minutes: 30, remaining_minutes: 30, splittable: true, minimum_block_minutes: 25, category_id: null, completed_at: null, ...timestamps };
}

function appRoutine(id = 'routine-local-id'): Routine {
  return { id, name: 'Routine', description: '', frequency: { type: 'daily' }, estimatedMinutes: 20, priority: 2, category: '', availableStartTime: null, availableEndTime: null, isActive: true, createdAt: timestamps.created_at, updatedAt: timestamps.updated_at, source: 'user' };
}

function routineRow(id = dbRoutineId): RoutineRow {
  return { id, user_id: 'user-id', name: 'Routine', description: null, frequency_type: 'daily', weekdays: [], estimated_minutes: 20, priority: 2, category_id: null, available_start_time: null, available_end_time: null, is_active: true, ...timestamps };
}

describe('SupabaseTaskRepository UUID handling', () => {
  it('task INSERTではLocal IDを送らずDB生成UUIDを返す', async () => {
    const fake = new FakeSupabase();
    fake.queue('tasks', 'insert', { data: taskRow(), error: null });
    fake.queue('categories', 'select', { data: [], error: null });
    const repository = new SupabaseTaskRepository(fake.client(), 'user-id');

    const created = await repository.createTask(appTask('task-prefixed'));
    const insert = fake.calls.find((call) => call.table === 'tasks' && call.operation === 'insert');
    expect(insert?.payload).not.toHaveProperty('id');
    expect(JSON.stringify(insert?.payload)).not.toContain('task-');
    expect(created.id).toBe(dbTaskId);
  });

  it('routine INSERTではLocal IDを送らずDB生成UUIDを返す', async () => {
    const fake = new FakeSupabase();
    fake.queue('routines', 'insert', { data: routineRow(), error: null });
    fake.queue('categories', 'select', { data: [], error: null });
    const repository = new SupabaseTaskRepository(fake.client(), 'user-id');

    const created = await repository.createRoutine(appRoutine('routine-prefixed'));
    const insert = fake.calls.find((call) => call.table === 'routines' && call.operation === 'insert');
    expect(insert?.payload).not.toHaveProperty('id');
    expect(JSON.stringify(insert?.payload)).not.toContain('routine-');
    expect(created.id).toBe(dbRoutineId);
  });

  it('UPDATEとDELETEではDB UUIDをfilterに使用する', async () => {
    const fake = new FakeSupabase();
    fake.queue('tasks', 'update', { data: taskRow(), error: null });
    fake.queue('categories', 'select', { data: [], error: null });
    fake.queue('tasks', 'delete', { data: null, error: null });
    const repository = new SupabaseTaskRepository(fake.client(), 'user-id');

    await repository.updateTask(appTask(dbTaskId));
    await repository.deleteTask(dbTaskId);
    const taskWrites = fake.calls.filter((call) => call.table === 'tasks' && (call.operation === 'update' || call.operation === 'delete'));
    expect(taskWrites.map((call) => call.filters)).toEqual([
      [['id', dbTaskId], ['user_id', 'user-id']],
      [['id', dbTaskId], ['user_id', 'user-id']],
    ]);
  });

  it('categoryとroutine completionのINSERT payloadにもidを含めない', async () => {
    const fake = new FakeSupabase();
    fake.queue('categories', 'upsert', { data: { id: '33333333-3333-4333-8333-333333333333' }, error: null });
    fake.queue('tasks', 'insert', { data: { ...taskRow(), category_id: '33333333-3333-4333-8333-333333333333' }, error: null });
    fake.queue('categories', 'select', { data: [], error: null });
    fake.queue('routine_completions', 'upsert', { data: null, error: null });
    const repository = new SupabaseTaskRepository(fake.client(), 'user-id');

    await repository.createTask({ ...appTask(), category: '仕事' });
    await repository.setRoutineCompletion(dbRoutineId, '2026-07-15', true);
    const payloads = fake.calls.filter((call) => call.operation === 'upsert').map((call) => call.payload);
    expect(payloads).toHaveLength(2);
    payloads.forEach((payload) => expect(payload).not.toHaveProperty('id'));
    expect(fake.calls.find((call) => call.table === 'tasks' && call.operation === 'insert')?.payload)
      .toHaveProperty('category_id', '33333333-3333-4333-8333-333333333333');
    expect(fake.calls.find((call) => call.table === 'routine_completions' && call.operation === 'upsert')?.payload)
      .toMatchObject({ routine_id: dbRoutineId, user_id: 'user-id', target_date: '2026-07-15' });
  });

  it('SupabaseエラーをRepository規約のエラーへ変換する', async () => {
    const fake = new FakeSupabase();
    fake.queue('tasks', 'insert', { data: null, error: { message: 'invalid input syntax for type uuid' } });
    const repository = new SupabaseTaskRepository(fake.client(), 'user-id');

    await expect(repository.createTask(appTask())).rejects.toEqual(expect.objectContaining({
      name: 'SupabaseRepositoryError',
      message: 'タスク作成に失敗しました: invalid input syntax for type uuid',
    } satisfies Partial<SupabaseRepositoryError>));
  });

  it('全読み取りと所有行の更新・削除をuser_idで多層防御する', async () => {
    const fake = new FakeSupabase();
    const repository = new SupabaseTaskRepository(fake.client(), 'user-id');
    await repository.loadStore();
    expect(fake.calls.filter((call) => call.table === 'categories' && call.operation === 'select')).toHaveLength(1);
    fake.queue('routines', 'update', { data: routineRow(), error: null });
    await repository.updateRoutine(appRoutine(dbRoutineId));
    await repository.deleteRoutine(dbRoutineId);
    await repository.setRoutineCompletion(dbRoutineId, '2026-07-15', false);
    const relevant = fake.calls.filter((call) =>
      (call.operation === 'select' || call.operation === 'update' || call.operation === 'delete')
      && ['categories', 'tasks', 'routines', 'routine_completions'].includes(call.table));
    relevant.forEach((call) => expect(call.filters).toContainEqual(['user_id', 'user-id']));
  });

  it('INSERT payloadのuser_idと計画フィールドをRepository値で固定する', async () => {
    const fake = new FakeSupabase();
    fake.queue('tasks', 'insert', { data: taskRow(), error: null });
    const repository = new SupabaseTaskRepository(fake.client(), 'owner-id');
    await repository.createTask({ ...appTask(), splittable: false, minimumBlockMinutes: 10, remainingMinutes: 12 });
    expect(fake.calls.find((call) => call.table === 'tasks' && call.operation === 'insert')?.payload).toMatchObject({
      user_id: 'owner-id', splittable: false, minimum_block_minutes: 10, remaining_minutes: 12,
    });
  });
});
