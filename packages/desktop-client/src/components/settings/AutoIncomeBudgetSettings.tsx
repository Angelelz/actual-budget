import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';

import { useSyncedPref } from '#hooks/useSyncedPref';

import { Setting } from './UI';

const MIN_HORIZON_MONTHS = 1;
const MAX_HORIZON_MONTHS = 60;
const DEFAULT_HORIZON_MONTHS = 12;

export function AutoIncomeBudgetSettings() {
  const { t } = useTranslation();
  const [budgetType = 'envelope'] = useSyncedPref('budgetType');
  const [horizonRaw, setHorizonRaw] = useSyncedPref(
    'autoIncomeBudgetHorizonMonths',
  );
  const [isRecomputing, setIsRecomputing] = useState(false);

  if (budgetType !== 'tracking') {
    return null;
  }

  const currentHorizon = (() => {
    const parsed = parseInt(horizonRaw ?? '', 10);
    if (!Number.isFinite(parsed)) return DEFAULT_HORIZON_MONTHS;
    return Math.max(MIN_HORIZON_MONTHS, Math.min(MAX_HORIZON_MONTHS, parsed));
  })();

  const onSave = (value: string) => {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      setHorizonRaw(String(DEFAULT_HORIZON_MONTHS));
      return;
    }
    const clamped = Math.max(
      MIN_HORIZON_MONTHS,
      Math.min(MAX_HORIZON_MONTHS, parsed),
    );
    setHorizonRaw(String(clamped));
  };

  const onRecomputeNow = async () => {
    setIsRecomputing(true);
    try {
      await send('schedule/recompute-auto-income');
    } finally {
      setIsRecomputing(false);
    }
  };

  return (
    <Setting
      primaryAction={
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Input
            inputMode="numeric"
            defaultValue={String(currentHorizon)}
            onBlur={e => onSave(e.target.value)}
            onEnter={value => onSave(value)}
            style={{ width: 80 }}
            aria-label={t('Months ahead to project')}
          />
          <Text>
            <Trans>months ahead</Trans>
          </Text>
          <Button onPress={onRecomputeNow} isDisabled={isRecomputing}>
            <Trans>Refresh now</Trans>
          </Button>
        </View>
      }
    >
      <Text>
        <Trans>
          <strong>Auto-income budgeting</strong> projects your scheduled income
          forward and writes it into the tracking budget for the categories you
          select on each schedule. Choose how many months ahead to project (1 –
          60).
        </Trans>
      </Text>
    </Setting>
  );
}
