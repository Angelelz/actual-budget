import { send } from '@actual-app/core/platform/client/connection';
import type { CategoryEntity } from '@actual-app/core/types/models';

import type { ApplyBudgetActionPayload } from './mutations';

// Fork-owned budget actions for the tracking budget (long-term copy + carry
// over from the previous month). Keeping the payload arms and their dispatch
// here means upstream's `mutations.ts` only needs a one-line union extension
// and a single dispatch seam, so future merges don't collide with this logic.

export type CustomBudgetActionPayload =
  | {
      type: 'set-long-term';
      month: string;
      args: {
        category: CategoryEntity['id'];
      };
    }
  | {
      type: 'set-long-term-month';
      month: string;
      args?: never;
    }
  | {
      type: 'carry-over-prev';
      month: string;
      args: {
        category: CategoryEntity['id'];
      };
    }
  | {
      type: 'carry-over-prev-month';
      month: string;
      args?: never;
    };

// Dispatch a custom budget action. Returns true when the payload was one of
// the fork's actions (none of which produce a notification), so the caller can
// otherwise fall through to the upstream switch.
export async function applyCustomBudgetAction(
  payload: ApplyBudgetActionPayload,
): Promise<boolean> {
  switch (payload.type) {
    case 'set-long-term':
      await send('budget/set-long-term', {
        month: payload.month,
        category: payload.args.category,
      });
      return true;
    case 'set-long-term-month':
      await send('budget/set-long-term-month', { month: payload.month });
      return true;
    case 'carry-over-prev':
      await send('budget/carry-over-from-previous', {
        month: payload.month,
        category: payload.args.category,
      });
      return true;
    case 'carry-over-prev-month':
      await send('budget/carry-over-from-previous-month', {
        month: payload.month,
      });
      return true;
    default:
      return false;
  }
}
