import React from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Menu } from '@actual-app/components/menu';
import type { MenuItem } from '@actual-app/components/menu';

import { useFeatureFlag } from '#hooks/useFeatureFlag';

import {
  getCustomTrackingBudgetMenuItems,
  handleCustomBudgetMenuSelect,
} from './customBudgetMenu';
import type { CustomBudgetMenuHandlers } from './customBudgetMenu';

type BudgetMenuProps = Omit<
  ComponentPropsWithoutRef<typeof Menu>,
  'onMenuSelect' | 'items'
> &
  CustomBudgetMenuHandlers & {
    isIncome?: boolean;
    onCopyLastMonthAverage: () => void;
    onSetMonthsAverage: (numberOfMonths: number) => void;
    onApplyBudgetTemplate: () => void;
    onCopyUntilYearEnd: () => void;
  };
export function BudgetMenu({
  isIncome = false,
  onCopyLastMonthAverage,
  onSetMonthsAverage,
  onApplyBudgetTemplate,
  onSetLongTerm,
  onCarryOverFromPrevious,
  onCopyUntilYearEnd,
  ...props
}: BudgetMenuProps) {
  const { t } = useTranslation();
  const isGoalTemplatesEnabled = useFeatureFlag('goalTemplatesEnabled');
  const onMenuSelect = (name: string) => {
    switch (name) {
      case 'copy-single-last':
        onCopyLastMonthAverage?.();
        break;
      case 'set-single-3-avg':
        onSetMonthsAverage?.(3);
        break;
      case 'set-single-6-avg':
        onSetMonthsAverage?.(6);
        break;
      case 'set-single-12-avg':
        onSetMonthsAverage?.(12);
        break;
      case 'apply-single-category-template':
        onApplyBudgetTemplate?.();
        break;
      case 'copy-until-year-end':
        onCopyUntilYearEnd?.();
        break;
      default:
        // Fork seam: tracking-budget items handled in ./customBudgetMenu.
        if (
          !handleCustomBudgetMenuSelect(name, {
            onSetLongTerm,
            onCarryOverFromPrevious,
          })
        ) {
          throw new Error(`Unrecognized menu item: ${name}`);
        }
    }
  };

  const items: MenuItem[] = [
    {
      name: 'copy-single-last',
      text: t("Copy last month's budget"),
    },
    {
      name: 'set-single-3-avg',
      text: t('Set to 3 month average'),
    },
    {
      name: 'set-single-6-avg',
      text: t('Set to 6 month average'),
    },
    {
      name: 'set-single-12-avg',
      text: t('Set to yearly average'),
    },
    {
      name: 'copy-until-year-end',
      text: t('Copy until year end'),
    },
  ];

  // Fork seam: tracking-budget items provided by ./customBudgetMenu.
  items.push(...getCustomTrackingBudgetMenuItems({ isIncome, t }));

  if (isGoalTemplatesEnabled) {
    items.push({
      name: 'apply-single-category-template',
      text: t('Overwrite with template'),
    });
  }

  return <Menu {...props} onMenuSelect={onMenuSelect} items={items} />;
}
