import type { Task } from '@/types/tasks';

export const DEFAULT_MINIMUM_BLOCK_MINUTES = 25;

export function taskPlanningDefaults(estimatedMinutes: number, completedAt: string | null) {
  return {
    splittable: true,
    minimumBlockMinutes: DEFAULT_MINIMUM_BLOCK_MINUTES,
    remainingMinutes: completedAt ? 0 : estimatedMinutes,
  };
}

export function toggleTaskCompletion(task: Task, now = new Date()): Task {
  const completing = task.completedAt === null;
  return {
    ...task,
    completedAt: completing ? now.toISOString() : null,
    remainingMinutes: completing ? 0 : Math.max(0, Math.min(task.estimatedMinutes, task.remainingMinutes || task.estimatedMinutes)),
    updatedAt: now.toISOString(),
  };
}
