import { Menu } from '@actual-app/components/menu';
import type { MenuItem } from '@actual-app/components/menu';
import type { TFunction } from 'i18next';

// Fork-owned tracking-budget menu customizations (set-as-long-term + carry
// over from last month). Keeping the items and selection handling here lets
// upstream's BudgetMenu touch the fork via single spread/dispatch seams, so
// future merges don't collide with these additions.

export type CustomBudgetMenuHandlers = {
  onSetLongTerm?: () => void;
  onCarryOverFromPrevious?: () => void;
};

// Extra menu items shown for non-income categories, appended after the
// upstream items.
export function getCustomTrackingBudgetMenuItems({
  isIncome,
  t,
}: {
  isIncome: boolean;
  t: TFunction;
}): MenuItem[] {
  if (isIncome) {
    return [];
  }
  return [
    Menu.line,
    { name: 'set-long-term', text: t('Set as long-term') },
    { name: 'carry-over-prev', text: t('Carry over from last month') },
  ];
}

// Dispatch a custom menu selection. Returns true when `name` was one of the
// fork's items so the caller can skip its "unrecognized item" fallback.
export function handleCustomBudgetMenuSelect(
  name: string,
  handlers: CustomBudgetMenuHandlers,
): boolean {
  switch (name) {
    case 'set-long-term':
      handlers.onSetLongTerm?.();
      return true;
    case 'carry-over-prev':
      handlers.onCarryOverFromPrevious?.();
      return true;
    default:
      return false;
  }
}

// Build the BudgetMenu handler props for the fork's tracking-budget actions,
// wiring each to a menu-action dispatch plus an undo notification. Returning
// them as a spreadable object keeps the call site in TrackingBudgetComponents
// a single seam instead of inline callbacks interleaved with upstream's.
export function getCustomTrackingBudgetMenuCallbacks({
  month,
  category,
  onMenuAction,
  showUndoNotification,
  t,
}: {
  month: string;
  category: { id: string; name: string };
  onMenuAction: (
    month: string,
    type: 'set-long-term' | 'carry-over-prev',
    args: { category: string },
  ) => void;
  showUndoNotification: (notification: { message: string }) => void;
  t: TFunction;
}): Required<CustomBudgetMenuHandlers> {
  return {
    onSetLongTerm: () => {
      onMenuAction(month, 'set-long-term', { category: category.id });
      showUndoNotification({
        message: t('Budget for {{categoryName}} copied forward.', {
          categoryName: category.name,
        }),
      });
    },
    onCarryOverFromPrevious: () => {
      onMenuAction(month, 'carry-over-prev', { category: category.id });
      showUndoNotification({
        message: t("Last month's leftover for {{categoryName}} carried over.", {
          categoryName: category.name,
        }),
      });
    },
  };
}
