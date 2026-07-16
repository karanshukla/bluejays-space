import { describe, expect, it, vi, beforeEach } from 'vitest';

// db.ts does `import pg from 'pg'; const { Pool } = pg; new Pool(...)`. Mock the
// default export so destructured Pool constructs an object with a controllable
// query method — no real DB needed.
const query = vi.fn();
vi.mock('pg', () => ({
  default: {
    Pool: function () {
      return { query };
    },
  },
}));

const { getHeadlineById } = await import('./db');

beforeEach(() => {
  query.mockReset();
});

describe('getHeadlineById', () => {
  it('returns the row when a published headline exists', async () => {
    const row = { id: 5, status: 'published', headline: 'Vlad walks it off' };
    query.mockResolvedValue({ rows: [row] });

    expect(await getHeadlineById(5)).toEqual(row);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'published'"), [5]);
  });

  it('returns null when the id does not exist', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await getHeadlineById(999)).toBeNull();
  });

  it('returns null for a draft (never leaks an unreviewed row)', async () => {
    // The DB would return no row because the WHERE clause filters on published;
    // the function must surface that as null, not the missing row.
    query.mockResolvedValue({ rows: [] });
    expect(await getHeadlineById(3)).toBeNull();
    expect(query).toHaveBeenCalledWith(expect.any(String), [3]);
  });
});
