export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type UserProfileRow = {
  user_id: string;
  display_name: string | null;
  timezone: string;
  day_start_time: string;
  day_end_time: string;
  default_focus_minutes: number;
  created_at: string;
  updated_at: string;
}

export type CategoryRow = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export type TaskRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: 'inbox' | 'planned' | 'in_progress' | 'completed' | 'cancelled';
  priority: number;
  due_at: string | null;
  estimated_minutes: number;
  remaining_minutes: number | null;
  splittable: boolean;
  minimum_block_minutes: number;
  category_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type RoutineRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  frequency_type: 'daily' | 'weekdays';
  weekdays: number[];
  estimated_minutes: number;
  priority: number;
  category_id: string | null;
  available_start_time: string | null;
  available_end_time: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type RoutineCompletionRow = {
  id: string;
  user_id: string;
  routine_id: string;
  target_date: string;
  completed_at: string;
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      user_profiles: Table<UserProfileRow, Partial<UserProfileRow> & Pick<UserProfileRow, 'user_id'>>;
      categories: Table<CategoryRow, Partial<CategoryRow> & Pick<CategoryRow, 'user_id' | 'name'>>;
      tasks: Table<TaskRow, Partial<TaskRow> & Pick<TaskRow, 'user_id' | 'title' | 'priority' | 'estimated_minutes'>>;
      routines: Table<RoutineRow, Partial<RoutineRow> & Pick<RoutineRow, 'user_id' | 'name' | 'frequency_type' | 'estimated_minutes' | 'priority'>>;
      routine_completions: Table<RoutineCompletionRow, Partial<RoutineCompletionRow> & Pick<RoutineCompletionRow, 'user_id' | 'routine_id' | 'target_date'>>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
