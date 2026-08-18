import type { NextRequest } from 'next/server';
import { authenticatedPlanningClient, getPlanningEstimationAccuracy } from '@/lib/planning/server';
import { planningError, planningJson } from '@/lib/planning/responses';
import { planningEstimationRangeDays } from '@/lib/planning/validation';

export async function GET(request: NextRequest) {
  try {
    const rangeDays = planningEstimationRangeDays(request.nextUrl.searchParams.get('days'));
    const { client, user } = await authenticatedPlanningClient();
    return planningJson(await getPlanningEstimationAccuracy(client, user.id, new Date(), rangeDays));
  } catch (error) { return planningError(error); }
}
