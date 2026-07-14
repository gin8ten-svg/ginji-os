import { describe, expect, it } from 'vitest';
import { CORRUPT_STORAGE_PREFIX, LocalStorageTaskRepository, STORAGE_KEY, createInitialStore, isTaskStore } from '@/lib/task-repository';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const fixedNow = new Date('2026-07-14T03:00:00.000Z');
const now = () => new Date(fixedNow);

function setup(value: string) {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, value);
  return { storage, repository: new LocalStorageTaskRepository(storage, now) };
}

function corruptedStore(change: (store: Record<string, unknown>) => void): string {
  const store = structuredClone(createInitialStore(fixedNow)) as unknown as Record<string, unknown>;
  change(store);
  return JSON.stringify(store);
}

function expectRecovered(storage: MemoryStorage, result: ReturnType<LocalStorageTaskRepository['load']>, original: string) {
  expect(result.recovered).toBe(true);
  expect(result.backupKey).toBe(`${CORRUPT_STORAGE_PREFIX}${fixedNow.toISOString()}`);
  expect(storage.getItem(result.backupKey as string)).toBe(original);
  expect(isTaskStore(result.store)).toBe(true);
  expect(isTaskStore(JSON.parse(storage.getItem(STORAGE_KEY) as string))).toBe(true);
}

describe('LocalStorageTaskRepository', () => {
  it('正常な保存データを読み込む', () => {
    const expected = createInitialStore(fixedNow);
    const { repository } = setup(JSON.stringify(expected));
    expect(repository.load()).toEqual({ store: expected, recovered: false, backupKey: null });
  });

  it('不正なdueAtを退避して復旧する', () => {
    const original = corruptedStore((store) => { (store.tasks as Record<string, unknown>[])[0].dueAt = 'invalid'; });
    const { storage, repository } = setup(original);
    expectRecovered(storage, repository.load(), original);
  });

  it('不正なpriorityを退避して復旧する', () => {
    const original = corruptedStore((store) => { (store.tasks as Record<string, unknown>[])[0].priority = 6; });
    const { storage, repository } = setup(original);
    expectRecovered(storage, repository.load(), original);
  });

  it('不正なweekdaysを退避して復旧する', () => {
    const original = corruptedStore((store) => { ((store.routines as Record<string, unknown>[])[1].frequency as Record<string, unknown>).weekdays = [1, 7]; });
    const { storage, repository } = setup(original);
    expectRecovered(storage, repository.load(), original);
  });

  it('壊れたJSONを退避して復旧する', () => {
    const original = '{broken-json';
    const { storage, repository } = setup(original);
    expectRecovered(storage, repository.load(), original);
  });

  it('version不一致を退避して復旧する', () => {
    const original = corruptedStore((store) => { store.version = 2; });
    const { storage, repository } = setup(original);
    expectRecovered(storage, repository.load(), original);
  });

  it('破損データ退避後に安全な初期状態を保存する', () => {
    const original = JSON.stringify({ version: 1, tasks: [], routines: 'invalid', routineCompletions: [] });
    const { storage, repository } = setup(original);
    const result = repository.load();
    expectRecovered(storage, result, original);
    expect(result.store).toEqual(createInitialStore(fixedNow));
  });

  it('旧Localデータへ計画フィールドのdefaultを補完して保存する', () => {
    const legacy = createInitialStore(fixedNow);
    const task = legacy.tasks[0] as unknown as Record<string, unknown>;
    delete task.splittable;
    delete task.minimumBlockMinutes;
    delete task.remainingMinutes;
    const { storage, repository } = setup(JSON.stringify(legacy));
    const result = repository.load();
    expect(result.recovered).toBe(false);
    expect(result.store.tasks[0]).toMatchObject({ splittable: true, minimumBlockMinutes: 25, remainingMinutes: 60 });
    expect(JSON.parse(storage.getItem(STORAGE_KEY) as string).tasks[0]).toHaveProperty('remainingMinutes', 60);
  });
});
