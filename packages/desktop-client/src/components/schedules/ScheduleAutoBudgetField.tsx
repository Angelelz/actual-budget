import { Trans, useTranslation } from 'react-i18next';

import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { Checkbox, FormLabel } from '#components/forms';
import { GenericInput } from '#components/util/GenericInput';

// Fork-owned schedule field: opt a schedule into auto-budgeting and pick the
// tracking-budget category it feeds. Kept as a standalone component so the
// upstream ScheduleEditForm only needs a single-line seam in its form body.

type ScheduleAutoBudgetFieldProps = {
  // The schedule's auto_budget_category: a category id when enabled, '' when
  // enabled-but-unset, or null when disabled.
  value: string | null;
  onChange: (value: string | null) => void;
};

export function ScheduleAutoBudgetField({
  value,
  onChange,
}: ScheduleAutoBudgetFieldProps) {
  const { t } = useTranslation();

  return (
    <>
      <View
        style={{
          marginTop: 15,
          flexDirection: 'row',
          alignItems: 'center',
          userSelect: 'none',
          justifyContent: 'flex-end',
        }}
      >
        <Checkbox
          id="form_auto_budget"
          checked={value != null}
          onChange={e => {
            onChange(e.target.checked ? '' : null);
          }}
        />
        <label htmlFor="form_auto_budget" style={{ userSelect: 'none' }}>
          <Trans>This is an automatic budget item</Trans>
        </label>
      </View>

      {value != null && (
        <View
          style={{
            marginTop: 5,
            width: 350,
            alignSelf: 'flex-end',
          }}
        >
          <FormLabel
            title={t('Budget category')}
            htmlFor="auto-budget-category-field"
          />
          <GenericInput
            type="id"
            field="category"
            value={value || ''}
            onChange={(id: string) => onChange(id || null)}
          />
          <Text
            style={{
              marginTop: 6,
              color: theme.pageTextLight,
              fontSize: 13,
              lineHeight: '1.4em',
            }}
          >
            <Trans>
              Each month, this schedule&rsquo;s projected occurrences will be
              summed and written into the tracking budget for the selected
              category. The budget cell will be read-only — to change it, edit
              this schedule.
            </Trans>
          </Text>
        </View>
      )}
    </>
  );
}
