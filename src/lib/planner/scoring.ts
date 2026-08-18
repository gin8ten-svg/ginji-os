/**
 * docs/SCHEDULING_RULES.md §3「Initial scoring idea」の加重式を実装する。
 *
 *   score = priority_weight + urgency_weight + overdue_weight + goal_weight
 *           - fragmentation_penalty - context_switch_penalty
 *
 * `candidateBaseScore` は、engine.ts の候補順序付けで既存の `effectiveDeadline` に基づく
 * ハードな締切順序付けを置き換えない前提のtie-breakとして使う（締切がハード制約である以上、
 * スコアで締切順序を覆してはならない）。goal_weightは現行スキーマに「目標」概念が
 * 存在しないため常に0。
 */

export interface PlanningScoreWeights {
  priorityWeight: number;
  urgencyWeight: number;
  overdueWeight: number;
  goalWeight: number;
  fragmentationPenaltyPerMinute: number;
  contextSwitchPenalty: number;
}

export const DEFAULT_PLANNING_SCORE_WEIGHTS: PlanningScoreWeights = {
  priorityWeight: 20,
  urgencyWeight: 100,
  overdueWeight: 500,
  goalWeight: 0,
  fragmentationPenaltyPerMinute: 0.5,
  contextSwitchPenalty: 15,
};

export interface CandidateScoreInput {
  /** 1〜5 */
  priority: number;
  /** epoch ms。task/routineのeffectiveDeadline */
  effectiveDeadline: number;
  isOverdue: boolean;
  /** epoch ms、計画基準時刻 */
  now: number;
  /** epoch ms、計画windowの終端（締切なし候補の基準） */
  windowEnd: number;
}

/**
 * priority_weight + urgency_weight + overdue_weight + goal_weight を計算する。
 * urgencyは締切までの残り時間をwindow全体に対する比率で0〜1へ正規化し、近いほど高くなる。
 */
export function candidateBaseScore(input: CandidateScoreInput, weights: PlanningScoreWeights = DEFAULT_PLANNING_SCORE_WEIGHTS): number {
  const priorityTerm = input.priority * weights.priorityWeight;
  const horizonMs = Math.max(1, input.windowEnd - input.now);
  const remainingMs = Math.min(horizonMs, Math.max(0, input.effectiveDeadline - input.now));
  const urgencyTerm = (1 - remainingMs / horizonMs) * weights.urgencyWeight;
  const overdueTerm = input.isOverdue ? weights.overdueWeight : 0;
  const goalTerm = weights.goalWeight;
  return priorityTerm + urgencyTerm + overdueTerm + goalTerm;
}

/**
 * 候補の所要時間がminimumBlockMinutesに近いほど、空き枠を細切れにしやすいとみなし減点する。
 * 現在の決定論的エンジンの空き枠選択（first-fit、consumeSlotの端数救済）はこの関数に依存せず、
 * 既存のテスト済み配置結果を変えない。スロット選択戦略を拡張する際の材料として提供する。
 */
export function fragmentationPenalty(
  durationMinutes: number,
  minimumBlockMinutes: number,
  weights: PlanningScoreWeights = DEFAULT_PLANNING_SCORE_WEIGHTS,
): number {
  const shortage = Math.max(0, minimumBlockMinutes - durationMinutes);
  return shortage * weights.fragmentationPenaltyPerMinute;
}

/** 直前に配置した候補とカテゴリーが異なる場合だけ減点する。 */
export function contextSwitchPenalty(
  category: string,
  previousCategory: string | null,
  weights: PlanningScoreWeights = DEFAULT_PLANNING_SCORE_WEIGHTS,
): number {
  if (previousCategory === null || previousCategory === category) return 0;
  return weights.contextSwitchPenalty;
}
