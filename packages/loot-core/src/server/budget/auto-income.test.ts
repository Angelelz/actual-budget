import { describe, expect, it } from 'vitest';

import { projectOccurrencesByMonth } from './auto-income';

describe('projectOccurrencesByMonth', () => {
  it('returns empty when amount is zero', () => {
    const result = projectOccurrencesByMonth(
      {
        _amount: 0,
        _date: {
          frequency: 'monthly',
          start: '2024-01-15',
          patterns: [],
          skipWeekend: false,
        },
        next_date: '2024-01-15',
      },
      '2024-01',
      '2024-12',
    );
    expect(result).toEqual({});
  });

  it('projects monthly recurrence over horizon', () => {
    const result = projectOccurrencesByMonth(
      {
        _amount: 250000, // $2,500.00 in cents
        _date: {
          frequency: 'monthly',
          start: '2024-01-15',
          patterns: [],
          skipWeekend: false,
        },
        next_date: '2024-01-15',
      },
      '2024-01',
      '2024-06',
    );
    expect(result).toEqual({
      '2024-01': 250000,
      '2024-02': 250000,
      '2024-03': 250000,
      '2024-04': 250000,
      '2024-05': 250000,
      '2024-06': 250000,
    });
  });

  it('projects bi-weekly recurrence and sums multiple occurrences in same month', () => {
    const result = projectOccurrencesByMonth(
      {
        _amount: 100000,
        _date: {
          frequency: 'weekly',
          interval: 2,
          start: '2024-01-05',
          patterns: [],
          skipWeekend: false,
        },
        next_date: '2024-01-05',
      },
      '2024-01',
      '2024-02',
    );
    // Jan has occurrences on the 5th and 19th -> 2 * 100000 = 200000
    // Feb has occurrences on the 2nd and 16th -> 2 * 100000 = 200000
    expect(result).toEqual({
      '2024-01': 200000,
      '2024-02': 200000,
    });
  });

  it('counts a one-time schedule whose date falls in the window', () => {
    const result = projectOccurrencesByMonth(
      {
        _amount: 50000,
        _date: '2024-03-10',
        next_date: '2024-03-10',
      },
      '2024-01',
      '2024-12',
    );
    expect(result).toEqual({ '2024-03': 50000 });
  });

  it('skips a one-time schedule whose date is before the window', () => {
    const result = projectOccurrencesByMonth(
      {
        _amount: 50000,
        _date: '2023-12-10',
        next_date: '2023-12-10',
      },
      '2024-01',
      '2024-12',
    );
    expect(result).toEqual({});
  });

  it('skips a one-time schedule whose date is after the window', () => {
    const result = projectOccurrencesByMonth(
      {
        _amount: 50000,
        _date: '2025-03-10',
        next_date: '2025-03-10',
      },
      '2024-01',
      '2024-12',
    );
    expect(result).toEqual({});
  });

  it('returns {} for malformed recurrence config', () => {
    const result = projectOccurrencesByMonth(
      {
        _amount: 100,
        // @ts-expect-error - intentionally malformed
        _date: { frequency: 'not-a-frequency', start: '2024-01-15' },
        next_date: '2024-01-15',
      },
      '2024-01',
      '2024-12',
    );
    expect(result).toEqual({});
  });

  it('handles interval=2 monthly correctly', () => {
    const result = projectOccurrencesByMonth(
      {
        _amount: 1000,
        _date: {
          frequency: 'monthly',
          interval: 2,
          start: '2024-01-15',
          patterns: [],
          skipWeekend: false,
        },
        next_date: '2024-01-15',
      },
      '2024-01',
      '2024-06',
    );
    expect(result).toEqual({
      '2024-01': 1000,
      '2024-03': 1000,
      '2024-05': 1000,
    });
  });
});
