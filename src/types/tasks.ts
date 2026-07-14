export type Priority = 1 | 2 | 3 | 4 | 5;
export type DataSource = 'sample' | 'user';
export type TaskCategory = 'inbox' | 'today' | 'upcoming' | 'overdue' | 'completed';
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Task {
  id: string;
  title: string;
  description: string;
  dueAt: string | null;
  priority: Priority;
  estimatedMinutes: number;
  category: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: DataSource;
}
export type RoutineFrequency =
  | { type: 'daily' }
  | { type: 'weekdays'; weekdays: Weekday[] };

export interface Routine {
  id: string;
  name: string;
  description: string;
  frequency: RoutineFrequency;
  estimatedMinutes: number;
  priority: Priority;
  category: string;
  availableStartTime: string | null;
  availableEndTime: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  source: DataSource;
}

export interface RoutineCompletion {
  routineId: string;
  date: string;
  completedAt: string;
}

export interface TaskStore {
  version: 1;
  tasks: Task[];
  routines: Routine[];
  routineCompletions: RoutineCompletion[];
}
