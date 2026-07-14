export interface PlanningWindow {
  start: string;
  end: string;
  timeZone: 'Asia/Tokyo';
  workdayStart: '08:00';
  workdayEnd: '22:00';
  minimumSlotMinutes: 25;
  dates: string[];
}

export interface BusyInterval {
  start: string;
  end: string;
  source: 'google' | 'routine';
  sourceId: string;
  title: string;
}

export interface FreeSlot { start: string; end: string }

export interface ProposedTimeBlock {
  id: string;
  source: 'task' | 'routine';
  taskId: string | null;
  routineId: string | null;
  title: string;
  start: string;
  end: string;
  splitIndex: number;
}

export interface UnscheduledTask {
  taskId: string;
  title: string;
  remainingMinutes: number;
  reason: string;
}

export interface UnscheduledRoutine {
  routineId: string;
  title: string;
  targetDate: string;
  reason: '指定時間帯に空きがない' | 'Google予定と競合' | '稼働可能時間外' | '所要時間を確保できない';
}

export interface PlanningResult {
  window: PlanningWindow;
  busyIntervals: BusyInterval[];
  freeSlots: FreeSlot[];
  proposedBlocks: ProposedTimeBlock[];
  unscheduledTasks: UnscheduledTask[];
  unscheduledRoutines: UnscheduledRoutine[];
  warnings: string[];
}
