import React, { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { Paragraph } from '@actual-app/components/paragraph';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import * as monthUtils from '@actual-app/core/shared/months';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Checkbox } from '#components/forms';
import { MobileBackButton } from '#components/mobile/MobileBackButton';
import { MobilePageHeader, Page, PageHeader } from '#components/Page';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { getColorScale } from '#components/reports/chart-theme';
import { useAccounts } from '#hooks/useAccounts';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';
import { useSyncedPref } from '#hooks/useSyncedPref';

type Snapshot = {
  month: string;
  surplus: number;
  allocations: Record<string, number>;
  balances: Record<string, number>;
  uncategorized: number;
};

type ProjectionResult = {
  months: string[];
  startBalances: Record<string, number>;
  snapshots: Snapshot[];
  debtFreeMonth: Record<string, string | null>;
};

export function DebtProjection() {
  const { t } = useTranslation();
  const { isNarrowWidth } = useResponsive();
  const { data: accounts = [] } = useAccounts();
  const format = useFormat();
  const locale = useLocale();
  const [budgetType] = useSyncedPref('budgetType');
  const [priorityRaw, setPriorityRaw] = useSyncedPref(
    'debtProjectionAccountPriority',
  );

  const orderedIds = useMemo<string[]>(() => {
    if (!priorityRaw) return [];
    try {
      const parsed = JSON.parse(priorityRaw);
      return Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === 'string')
        : [];
    } catch {
      return [];
    }
  }, [priorityRaw]);

  const setOrderedIds = (next: string[] | ((prev: string[]) => string[])) => {
    const value = typeof next === 'function' ? next(orderedIds) : next;
    setPriorityRaw(JSON.stringify(value));
  };

  const [showOnlyDebt, setShowOnlyDebt] = useState(true);
  const [result, setResult] = useState<ProjectionResult | null>(null);
  const [loading, setLoading] = useState(false);

  const accountsById = useMemo(() => {
    const map: Record<string, (typeof accounts)[number]> = {};
    for (const a of accounts) map[a.id] = a;
    return map;
  }, [accounts]);

  const visibleAccounts = useMemo(
    () => accounts.filter(a => !a.closed),
    [accounts],
  );

  // Account balances (current) by id, taken from server's projection result
  // when available, otherwise empty until first run.
  const startBalances = result?.startBalances ?? {};

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (orderedIds.length === 0) {
        setResult(null);
        return;
      }
      setLoading(true);
      const data = (await send('report/debt-projection', {
        accountIds: orderedIds,
      })) as ProjectionResult;
      if (!cancelled) {
        setResult(data);
        setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [orderedIds]);

  const colors = getColorScale('qualitative');

  if (budgetType !== 'tracking') {
    return (
      <Page
        header={
          isNarrowWidth ? (
            <MobilePageHeader
              title={t('Debt projection')}
              leftContent={<MobileBackButton />}
            />
          ) : (
            <PageHeader title={t('Debt projection')} />
          )
        }
        padding={20}
      >
        <Paragraph>
          <Trans>
            Debt projection requires <strong>tracking budgeting</strong>. Switch
            from envelope to tracking in Settings to use this report — its
            forecast walks the future-month rows that the tracking budget
            produces.
          </Trans>
        </Paragraph>
      </Page>
    );
  }

  return (
    <Page
      header={
        isNarrowWidth ? (
          <MobilePageHeader
            title={t('Debt projection')}
            leftContent={<MobileBackButton />}
          />
        ) : (
          <PageHeader title={t('Debt projection')} />
        )
      }
      padding={isNarrowWidth ? 0 : 20}
    >
      <View
        style={{
          flexDirection: isNarrowWidth ? 'column' : 'row',
          gap: 20,
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Left: account picker */}
        <View
          style={{
            width: isNarrowWidth ? '100%' : 320,
            flexShrink: 0,
            backgroundColor: theme.tableBackground,
            borderRadius: 6,
            padding: 16,
            boxShadow: styles.cardShadow,
          }}
        >
          <Text style={{ fontWeight: 600, marginBottom: 8 }}>
            <Trans>Accounts to pay down (priority order)</Trans>
          </Text>
          <Text
            style={{
              color: theme.pageTextLight,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            <Trans>
              Each month&rsquo;s surplus pours into the first account until it
              hits $0, then the next.
            </Trans>
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Checkbox
              id="show-only-debt"
              checked={showOnlyDebt}
              onChange={() => setShowOnlyDebt(v => !v)}
            />
            <label htmlFor="show-only-debt" style={{ userSelect: 'none' }}>
              <Trans>Show only accounts with negative balance</Trans>
            </label>
          </View>

          {/* Selected (ordered) */}
          {orderedIds.length > 0 && (
            <View style={{ marginTop: 12 }}>
              <Text
                style={{
                  color: theme.pageTextLight,
                  fontSize: 12,
                  marginBottom: 4,
                }}
              >
                <Trans>Priority</Trans>
              </Text>
              {orderedIds.map((id, idx) => {
                const account = accountsById[id];
                if (!account) return null;
                return (
                  <View
                    key={id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 0',
                      borderBottom: `1px solid ${theme.tableBorder}`,
                    }}
                  >
                    <Text style={{ width: 22, color: theme.pageTextLight }}>
                      {idx + 1}.
                    </Text>
                    <Text style={{ flex: 1 }}>{account.name}</Text>
                    <Button
                      variant="bare"
                      isDisabled={idx === 0}
                      onPress={() =>
                        setOrderedIds(arr => move(arr, idx, idx - 1))
                      }
                      aria-label={t('Move up')}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="bare"
                      isDisabled={idx === orderedIds.length - 1}
                      onPress={() =>
                        setOrderedIds(arr => move(arr, idx, idx + 1))
                      }
                      aria-label={t('Move down')}
                    >
                      ↓
                    </Button>
                    <Button
                      variant="bare"
                      onPress={() =>
                        setOrderedIds(arr => arr.filter(x => x !== id))
                      }
                      aria-label={t('Remove')}
                    >
                      ×
                    </Button>
                  </View>
                );
              })}
            </View>
          )}

          {/* Available (unselected) */}
          <View style={{ marginTop: 12 }}>
            <Text
              style={{
                color: theme.pageTextLight,
                fontSize: 12,
                marginBottom: 4,
              }}
            >
              <Trans>Available</Trans>
            </Text>
            {visibleAccounts
              .filter(a => !orderedIds.includes(a.id))
              .filter(a => {
                if (!showOnlyDebt) return true;
                const bal = startBalances[a.id];
                // Without a projection result yet we don't know balances, so
                // show everything; once we have a result, filter to debts.
                return bal === undefined || bal < 0;
              })
              .map(a => (
                <View
                  key={a.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: '4px 0',
                  }}
                >
                  <Text style={{ flex: 1 }}>{a.name}</Text>
                  <Button
                    variant="bare"
                    onPress={() => setOrderedIds(arr => [...arr, a.id])}
                  >
                    <Trans>Add</Trans>
                  </Button>
                </View>
              ))}
          </View>
        </View>

        {/* Right: chart + summary */}
        <View style={{ flex: 1, minWidth: 0 }}>
          {orderedIds.length === 0 ? (
            <EmptyState />
          ) : loading || result == null ? (
            <Text style={{ padding: 40, color: theme.pageTextLight }}>
              <Trans>Computing projection…</Trans>
            </Text>
          ) : (
            <ProjectionChart
              result={result}
              orderedIds={orderedIds}
              accountsById={accountsById}
              colors={colors}
              format={format}
              locale={locale}
            />
          )}
        </View>
      </View>
    </Page>
  );
}

function move<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function EmptyState() {
  return (
    <View style={{ padding: 40 }}>
      <Paragraph>
        <Trans>
          Pick one or more accounts on the left in priority order. Each future
          month, the surplus from your tracking budget (projected income minus
          projected spend) will be poured into them — first account first, then
          the next once the first is paid off.
        </Trans>
      </Paragraph>
      <Paragraph style={{ color: theme.pageTextLight, fontSize: 13 }}>
        <Trans>
          Tip: this report is most useful once you&rsquo;ve set up auto-income
          schedules and copied your spend budgets forward via{' '}
          <em>Set as long-term</em>.
        </Trans>
      </Paragraph>
    </View>
  );
}

type ChartProps = {
  result: ProjectionResult;
  orderedIds: string[];
  accountsById: Record<string, { id: string; name: string }>;
  colors: string[];
  format: ReturnType<typeof useFormat>;
  locale: ReturnType<typeof useLocale>;
};

function ProjectionChart({
  result,
  orderedIds,
  accountsById,
  colors,
  format,
  locale,
}: ChartProps) {
  // Build chart data: one row per month with surplus, total debt, and a
  // value per account.
  const data = useMemo(() => {
    return result.snapshots.map(s => {
      const totalDebt = orderedIds.reduce((sum, id) => {
        const bal = s.balances[id] ?? 0;
        return sum + (bal < 0 ? bal : 0);
      }, 0);
      const row: Record<string, number | string> = {
        month: s.month,
        label: monthUtils.format(s.month, "MMM ''yy", locale),
        surplus: s.surplus,
        totalDebt,
      };
      for (const id of orderedIds) {
        row[`acct_${id}`] = s.balances[id] ?? 0;
      }
      return row;
    });
  }, [result.snapshots, orderedIds, locale]);

  // Milestones: first month each previously-negative account hits >= 0.
  const milestones = useMemo(
    () =>
      orderedIds
        .map(id => {
          const month = result.debtFreeMonth[id];
          if (!month) return null;
          const idx = result.months.indexOf(month);
          if (idx === -1) return null;
          return {
            id,
            label: data[idx].label as string,
            value: 0,
            name: accountsById[id]?.name ?? id,
          };
        })
        .filter((m): m is NonNullable<typeof m> => m != null),
    [orderedIds, result, data, accountsById],
  );

  return (
    <View style={{ flex: 1, gap: 20 }}>
      <View style={{ height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid stroke={theme.tableBorder} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={v => format(v, 'financial-with-sign')}
            />
            <Tooltip
              formatter={
                ((value: unknown) =>
                  format(
                    typeof value === 'number' ? value : 0,
                    'financial-with-sign',
                  )) as never
              }
              labelStyle={{ color: theme.menuItemText }}
              contentStyle={{
                backgroundColor: theme.menuBackground,
                border: `1px solid ${theme.tableBorder}`,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar
              dataKey="surplus"
              name="Monthly surplus"
              fill={theme.reportsBlue ?? colors[4]}
              opacity={0.5}
            />
            <Line
              type="monotone"
              dataKey="totalDebt"
              name="Total debt"
              stroke={theme.errorText ?? colors[3]}
              strokeWidth={2}
              dot={false}
            />
            {orderedIds.map((id, i) => (
              <Line
                key={id}
                type="monotone"
                dataKey={`acct_${id}`}
                name={accountsById[id]?.name ?? id}
                stroke={colors[i % colors.length]}
                strokeWidth={1.5}
                dot={false}
              />
            ))}
            {milestones.map(m => (
              <ReferenceDot
                key={`ms-${m.id}`}
                x={m.label}
                y={0}
                r={5}
                fill={theme.noticeText ?? '#22c55e'}
                stroke="white"
                strokeWidth={2}
                ifOverflow="extendDomain"
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </View>

      {milestones.length > 0 && (
        <View
          style={{
            backgroundColor: theme.tableBackground,
            borderRadius: 6,
            padding: 12,
            boxShadow: styles.cardShadow,
          }}
        >
          <Text style={{ fontWeight: 600, marginBottom: 6 }}>
            <Trans>Debt-free milestones</Trans>
          </Text>
          {milestones.map(m => (
            <Text key={m.id} style={{ fontSize: 13 }}>
              <Trans>
                <strong>{{ name: m.name } as never}</strong> — paid off in{' '}
                {{ when: m.label } as never}
              </Trans>
            </Text>
          ))}
        </View>
      )}

      <View
        style={{
          backgroundColor: theme.tableBackground,
          borderRadius: 6,
          padding: 12,
          boxShadow: styles.cardShadow,
          overflow: 'auto',
        }}
      >
        <Text style={{ fontWeight: 600, marginBottom: 8 }}>
          <Trans>Month-by-month detail</Trans>
        </Text>
        <table
          style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}
        >
          <thead>
            <tr style={{ textAlign: 'right' }}>
              <th style={{ textAlign: 'left' }}>
                <Trans>Month</Trans>
              </th>
              <th>
                <Trans>Surplus</Trans>
              </th>
              {orderedIds.map(id => (
                <th key={id}>{accountsById[id]?.name ?? id}</th>
              ))}
              <th>
                <Trans>Leftover</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.snapshots.map(s => (
              <tr
                key={s.month}
                style={{ borderTop: `1px solid ${theme.tableBorder}` }}
              >
                <td>{monthUtils.format(s.month, "MMM ''yy", locale)}</td>
                <td style={{ textAlign: 'right' }}>
                  <PrivacyFilter>
                    {format(s.surplus, 'financial-with-sign')}
                  </PrivacyFilter>
                </td>
                {orderedIds.map(id => (
                  <td key={id} style={{ textAlign: 'right' }}>
                    <PrivacyFilter>
                      {format(s.balances[id] ?? 0, 'financial-with-sign')}
                    </PrivacyFilter>
                  </td>
                ))}
                <td style={{ textAlign: 'right' }}>
                  <PrivacyFilter>
                    {format(s.uncategorized, 'financial-with-sign')}
                  </PrivacyFilter>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </View>
    </View>
  );
}
