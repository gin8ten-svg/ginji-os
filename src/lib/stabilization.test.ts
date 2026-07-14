import { describe, expect, it } from 'vitest';
import { SubmissionGate } from '@/lib/submission-gate';
import { LocalTaskStoreAdapter } from '@/lib/task-store-adapter';
import { LocalTaskRepository, STORAGE_KEY, createInitialStore } from '@/lib/task-repository';
import { toggleTaskCompletion } from '@/lib/task-planning';
import { clientTokyoDateSnapshot } from '@/lib/use-tokyo-date';

class FailableStorage {
  value: string | null = null;
  fail = false;
  getItem(key: string) { return key === STORAGE_KEY ? this.value : null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error('quota'); if (key === STORAGE_KEY) this.value = value; }
}

describe('pre-planner stabilization', () => {
  it('Local保存失敗時はstateを維持し、再試行で復旧する', async () => {
    const storage = new FailableStorage();
    storage.value = JSON.stringify(createInitialStore(new Date('2026-07-15T00:00:00.000Z')));
    const adapter = new LocalTaskStoreAdapter(new LocalTaskRepository(storage));
    const before = (await adapter.load()).store;
    const changed = { ...before.tasks[0], title: '変更' };
    storage.fail = true;
    await expect(adapter.saveTask(changed)).rejects.toThrow('quota');
    expect(JSON.parse(storage.value as string).tasks[0].title).toBe(before.tasks[0].title);
    storage.fail = false;
    expect((await adapter.saveTask(changed)).tasks[0].title).toBe('変更');
  });

  it('失敗時はフォームを閉じる判断をせず、入力を保ったまま再試行できる', async () => {
    const gate = new SubmissionGate();
    expect(await gate.run(async () => { throw new Error('remote failed'); })).toEqual({ started: true, error: 'remote failed' });
    expect(await gate.run(async () => undefined)).toEqual({ started: true, error: null });
  });

  it('保存中の二重送信を防ぐ', async () => {
    const gate = new SubmissionGate();
    let release: (() => void) | undefined;
    const first = gate.run(() => new Promise<void>((resolve) => { release = resolve; }));
    expect(await gate.run(async () => undefined)).toEqual({ started: false });
    release?.();
    expect(await first).toEqual({ started: true, error: null });
  });

  it('完了で残り時間を0、未完了で見積以内へ復元する', () => {
    const task = createInitialStore(new Date('2026-07-15T00:00:00.000Z')).tasks[0];
    const completed = toggleTaskCompletion(task, new Date('2026-07-15T01:00:00.000Z'));
    expect(completed.remainingMinutes).toBe(0);
    const restored = toggleTaskCompletion(completed, new Date('2026-07-15T02:00:00.000Z'));
    expect(restored.remainingMinutes).toBe(restored.estimatedMinutes);
  });

  it('TodayとCalendarのclient初期値を東京の0時・月末・年末で確定する', () => {
    expect(clientTokyoDateSnapshot(new Date('2026-07-31T14:59:59.999Z'))).toBe('2026-07-31');
    expect(clientTokyoDateSnapshot(new Date('2026-07-31T15:00:00.000Z'))).toBe('2026-08-01');
    expect(clientTokyoDateSnapshot(new Date('2026-12-31T15:00:00.000Z'))).toBe('2027-01-01');
  });
});
