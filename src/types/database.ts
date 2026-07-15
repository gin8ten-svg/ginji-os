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

export type CalendarConnectionRow = {
  user_id: string;
  encrypted_refresh_token: string;
  token_format_version: number;
  granted_scopes: string[];
  selected_calendar_ids: string[];
  needs_reconnect: boolean;
  connected_at: string;
  updated_at: string;
}

export type PlanningSessionRow = {
  id: string; user_id: string; status: 'draft' | 'approved' | 'rejected' | 'superseded';
  window_start: string; window_end: string; input_now: string; input_hash: string; engine_version: string;
  warning_codes: string[]; result_summary: Json; created_at: string; updated_at: string;
  approved_at: string | null; rejected_at: string | null;
  idempotency_key: string | null;
  blocks_revision: number;
}

export type PlanningBlockRow = {
  id: string; planning_session_id: string; user_id: string; source_type: 'task' | 'routine';
  source_entity_id: string; title: string; start_at: string; end_at: string; block_index: number;
  duration_minutes: number; metadata: Json; created_at: string;
}

export type AiAdviceRateLimitRow = {
  user_id: string; reserved_at: string; updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      user_profiles: Table<UserProfileRow, Partial<UserProfileRow> & Pick<UserProfileRow, 'user_id'>>;
      categories: Table<CategoryRow, Partial<CategoryRow> & Pick<CategoryRow, 'user_id' | 'name'>>;
      tasks: Table<TaskRow, Partial<TaskRow> & Pick<TaskRow, 'user_id' | 'title' | 'priority' | 'estimated_minutes'>>;
      routines: Table<RoutineRow, Partial<RoutineRow> & Pick<RoutineRow, 'user_id' | 'name' | 'frequency_type' | 'estimated_minutes' | 'priority'>>;
      routine_completions: Table<RoutineCompletionRow, Partial<RoutineCompletionRow> & Pick<RoutineCompletionRow, 'user_id' | 'routine_id' | 'target_date'>>;
      calendar_connections: Table<CalendarConnectionRow, Partial<CalendarConnectionRow> & Pick<CalendarConnectionRow, 'user_id' | 'encrypted_refresh_token'>>;
      planning_sessions: Table<PlanningSessionRow, Partial<PlanningSessionRow> & Pick<PlanningSessionRow, 'user_id' | 'window_start' | 'window_end' | 'input_now' | 'input_hash' | 'engine_version'>>;
      planning_blocks: Table<PlanningBlockRow, Partial<PlanningBlockRow> & Pick<PlanningBlockRow, 'planning_session_id' | 'user_id' | 'source_type' | 'source_entity_id' | 'title' | 'start_at' | 'end_at' | 'duration_minutes'>>;
      ai_advice_rate_limits: Table<AiAdviceRateLimitRow, Pick<AiAdviceRateLimitRow, 'user_id' | 'reserved_at'>>;
    };
    Views: Record<string, never>;
    Functions: {
      approve_planning_session: { Args: { p_session_id: string; p_input_hash: string; p_blocks_revision: number }; Returns: string };
      reject_planning_session: { Args: { p_session_id: string }; Returns: string };
      delete_planning_block: { Args: { p_block_id: string }; Returns: string };
      reserve_ai_advice_request: { Args: Record<never, never>; Returns: boolean };
      create_planning_session: { Args: { p_idempotency_key: string | null; p_window_start: string; p_window_end: string; p_input_now: string; p_input_hash: string; p_engine_version: string; p_warning_codes: string[]; p_result_summary: Json; p_blocks: Json }; Returns: string };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
