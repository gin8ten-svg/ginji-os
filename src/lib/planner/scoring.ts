/**
 * docs/SCHEDULING_RULES.md §3「Initial scoring idea」の加重式のうち、決定論的Engineが
 * 実際に使う部分だけを実装する。
 *
 *   score = priority_weight + urgency_weight + overdue_weight + goal_weight
 *
 * `candidateBaseScore` は engine.ts の候補順序付けで、`effectiveDeadline` に基づくハードな
 * 締切順序を「置き換えない」前提のtie-breakとして使う（締切がハード制約である以上、
 * スコアで締切順序を覆してはならない）。`goal_weight` は現行スキーマに「目標」概念が
 * 存在しないため常に0。
 *
 * fragmentation_penalty / context_switch_penalty（細切れ回避・カテゴリー切替削減）は
 * soft constraintとして docs/SCHEDULING_RULES.md に記載しているが、決定論的な
 * スロット選択（first-fit・端数救済）へ安全に組み込むには配置アルゴリズム自体の
 * 再設計が必要なため、この基礎スコアには含めない。
 */

export interface PlanningScoreWeights {
  priorityWeight: number;
  urgencyWeight: number;
  overdueWeight: number;
  goalWeight: number;
}

export const DEFAULT_PLANNING_SCORE_WEIGHTS: PlanningScoreWeights = {
  priorityWeight: 20,
  urgencyWeight: 100,
  overdueWeight: 500,
  goalWeight: 0,
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
