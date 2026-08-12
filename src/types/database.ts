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
  input_snapshot_version: string | null;
  input_snapshot: Json | null;
  manually_edited: boolean;
}

export type PlanningBlockRow = {
  id: string; planning_session_id: string; user_id: string; source_type: 'task' | 'routine';
  source_entity_id: string; title: string; start_at: string; end_at: string; block_index: number;
  duration_minutes: number; metadata: Json; created_at: string;
}

export type AiAdviceRateLimitRow = {
  user_id: string; reserved_at: string; updated_at: string;
}

export type AiAdviceUsageEventRow = {
  id: string; user_id: string; planning_session_id: string | null; model: string; candidate_count: number;
  input_tokens: number | null; output_tokens: number | null; success: boolean; error_code: string | null; created_at: string;
}

export type TimeBlockRow = {
  id: string; user_id: string; task_id: string | null; routine_id: string | null;
  planning_session_id: string; planning_block_id: string; start_at: string; end_at: string;
  status: 'proposed' | 'approved' | 'in_progress' | 'completed' | 'skipped'; status_reason: 'user_skipped' | 'carried_over' | null; source: 'manual' | 'ai' | 'google';
  google_calendar_id: string; google_event_id: string; calendar_write_status: 'writing' | 'succeeded' | 'failed';
  calendar_write_attempt_token: string | null; calendar_write_lease_until: string | null;
  calendar_write_attempt_count: number; calendar_write_error_code: string | null; written_at: string | null;
  calendar_event_state: 'pending' | 'active' | 'deleted';
  calendar_mutation_status: 'idle' | 'updating' | 'deleting' | 'update_failed' | 'delete_failed';
  calendar_mutation_attempt_token: string | null; calendar_mutation_lease_until: string | null;
  calendar_mutation_attempt_count: number; calendar_mutation_error_code: string | null;
  calendar_updated_at: string | null; calendar_deleted_at: string | null;
  actual_minutes: number | null; created_at: string; updated_at: string;
}

export type AuditLogRow = {
  id: string; user_id: string; action: 'calendar_event_write_succeeded' | 'calendar_event_write_failed' | 'calendar_event_update_succeeded' | 'calendar_event_update_failed' | 'calendar_event_delete_succeeded' | 'calendar_event_delete_failed' | 'time_block_completed' | 'time_block_skipped';
  entity_type: 'time_block'; entity_id: string; before_data: Json | null; after_data: Json | null; created_at: string;
}

export interface Database {
  public: {
    Tables: {
      user_profiles: Table<UserProfileRow, Partial<UserProfileRow> & Pick<UserProfileRow, 'user_id'>>;
      categories: Table<CategoryRow, Partial<CategoryRow> & Pick<CategoryRow, 'user_id' | 'name'>>;
      tasks: Table<TaskRow, Partial<TaskRow> & Pick<TaskRow, 'user_id' | 'title' | 'priority' | 'estimated_minutes'>>;
      routines: Table<RoutineRow, Partial<RoutineRow> & Pick<RoutineRow, 'user_id' | 'name' | 'frequency_type' | 'estimated_minutes' | 'priority'>>;
      routine_completions: Table<RoutineCompletionRow, Partial<RoutineCompletionRow> & Pick<RoutineCompletionRow, 'user_id' | 'routine_id' | 'target_date'>>;
      calendar_connections: Table<CalendarConnectionRow, Partial<CalendarConnectionRow> & Pick<CalendarConnectionRow, 'user_id'>>;
      planning_sessions: Table<PlanningSessionRow, Partial<PlanningSessionRow> & Pick<PlanningSessionRow, 'user_id' | 'window_start' | 'window_end' | 'input_now' | 'input_hash' | 'engine_version'>>;
      planning_blocks: Table<PlanningBlockRow, Partial<PlanningBlockRow> & Pick<PlanningBlockRow, 'planning_session_id' | 'user_id' | 'source_type' | 'source_entity_id' | 'title' | 'start_at' | 'end_at' | 'duration_minutes'>>;
      ai_advice_rate_limits: Table<AiAdviceRateLimitRow, Pick<AiAdviceRateLimitRow, 'user_id' | 'reserved_at'>>;
      ai_advice_usage_events: Table<AiAdviceUsageEventRow, Partial<AiAdviceUsageEventRow> & Pick<AiAdviceUsageEventRow, 'user_id' | 'model' | 'candidate_count' | 'success'>>;
      time_blocks: Table<TimeBlockRow, Partial<TimeBlockRow> & Pick<TimeBlockRow, 'user_id' | 'planning_session_id' | 'planning_block_id' | 'start_at' | 'end_at' | 'google_calendar_id' | 'google_event_id' | 'calendar_write_status'>>;
      audit_logs: Table<AuditLogRow, Partial<AuditLogRow> & Pick<AuditLogRow, 'user_id' | 'action' | 'entity_type' | 'entity_id'>>;
    };
    Views: Record<string, never>;
    Functions: {
      approve_planning_session: { Args: { p_session_id: string; p_input_hash: string; p_blocks_revision: number }; Returns: string };
      reject_planning_session: { Args: { p_session_id: string }; Returns: string };
      delete_planning_block: { Args: { p_block_id: string }; Returns: string };
      reserve_ai_advice_request: { Args: Record<never, never>; Returns: boolean };
      create_planning_session_v2: { Args: { p_idempotency_key: string | null; p_window_start: string; p_window_end: string; p_input_now: string; p_input_hash: string; p_input_snapshot_version: string; p_input_snapshot: Json; p_engine_version: string; p_warning_codes: string[]; p_result_summary: Json; p_blocks: Json }; Returns: string };
      save_calendar_connection: { Args: { p_encrypted_refresh_token: string; p_granted_scopes: string[] }; Returns: void };
      get_calendar_connection_token: { Args: Record<never, never>; Returns: string | null };
      reserve_calendar_event_write: { Args: { p_session_id: string; p_block_id: string; p_input_hash: string; p_blocks_revision: number; p_calendar_id: string; p_google_event_id: string }; Returns: Json };
      complete_calendar_event_write: { Args: { p_block_id: string; p_attempt_token: string; p_success: boolean; p_error_code: string | null; p_after_data: Json }; Returns: string };
      reserve_calendar_event_mutation: { Args: { p_session_id: string; p_block_id: string; p_input_hash: string; p_blocks_revision: number; p_operation: 'update' | 'delete' }; Returns: Json };
      complete_calendar_event_mutation: { Args: { p_block_id: string; p_attempt_token: string; p_success: boolean; p_error_code: string | null; p_after_data: Json }; Returns: string };
      complete_planning_time_block: { Args: { p_session_id: string; p_block_id: string; p_actual_minutes: number | null }; Returns: Json };
      skip_planning_time_block: { Args: { p_session_id: string; p_block_id: string; p_reason: 'user_skipped' | 'carried_over' }; Returns: Json };
      update_planning_block_time: { Args: { p_block_id: string; p_start_at: string; p_end_at: string }; Returns: string };
      update_planning_block_task: { Args: { p_block_id: string; p_task_id: string }; Returns: string };
      record_ai_advice_usage: { Args: { p_planning_session_id: string | null; p_model: string; p_candidate_count: number; p_input_tokens: number | null; p_output_tokens: number | null; p_success: boolean; p_error_code: string | null }; Returns: string | null };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
