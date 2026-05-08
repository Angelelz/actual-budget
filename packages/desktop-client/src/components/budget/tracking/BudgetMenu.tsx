import React from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Menu } from '@actual-app/components/menu';
import type { MenuItem } from '@actual-app/components/menu';

import { useFeatureFlag } from '#hooks/useFeatureFlag';

type BudgetMenuProps = Omit<
  ComponentPropsWithoutRef<typeof Menu>,
  'onMenuSelect' | 'items'
> & {
  isIncome?: boolean;
  onCopyLastMonthAverage: () => void;
  onSetMonthsAverage: (numberOfMonths: number) => void;
  onApplyBudgetTemplate: () => void;
  onSetLongTerm?: () => void;
  onCarryOverFromPrevious?: () => void;
};
export function BudgetMenu({
  isIncome = false,
  onCopyLastMonthAverage,
  onSetMonthsAverage,
  onApplyBudgetTemplate,
  onSetLongTerm,
  onCarryOverFromPrevious,
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
      case 'set-long-term':
        onSetLongTerm?.();
        break;
      case 'carry-over-prev':
        onCarryOverFromPrevious?.();
        break;
      default:
        throw new Error(`Unrecognized menu item: ${name}`);
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
  ];

  if (!isIncome) {
    items.push(
      Menu.line,
      { name: 'set-long-term', text: t('Set as long-term') },
      { name: 'carry-over-prev', text: t('Carry over from last month') },
    );
  }

  if (isGoalTemplatesEnabled) {
    items.push({
      name: 'apply-single-category-template',
      text: t('Overwrite with template'),
    });
  }

  return <Menu {...props} onMenuSelect={onMenuSelect} items={items} />;
}
