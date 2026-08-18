import type { NextRequest } from 'next/server';
import { tokyoDateKey } from '@/lib/date-time';
import { authenticatedPlanningClient, getPlanningDailyReview } from '@/lib/planning/server';
import { planningError, planningJson } from '@/lib/planning/responses';
import { planningReviewDate } from '@/lib/planning/validation';

export async function GET(request: NextRequest) {
  try {
    const date = planningReviewDate(request.nextUrl.searchParams.get('date'), tokyoDateKey());
    const { client, user } = await authenticatedPlanningClient();
    return planningJson(await getPlanningDailyReview(client, user.id, date));
  } catch (error) { return planningError(error); }
}
