import { describe, expect, it, vi, beforeEach } from 'vitest';

// db.ts does `import pg from 'pg'; const { Pool } = pg; new Pool(...)`. Mock the
// default export so destructured Pool constructs an object with a controllable
// query method, no real DB needed.
const query = vi.fn();
vi.mock('pg', () => ({
  default: {
    Pool: function () {
      return { query };
    },
  },
}));

const { getHeadlineById, createSubmittedHeadline } = await import('./db');

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

describe('createSubmittedHeadline', () => {
  it('inserts a draft row tagged as a public submission', async () => {
    query.mockResolvedValue({ rows: [] });

    await createSubmittedHeadline({
      headline: 'Bo Bichette drafted by three teams simultaneously',
      stat_block: '.311 AVG',
      photo_ref: 'admin/123-bo.webp',
      source_note: 'saw it on the subway',
      submitter_name: 'A Fan',
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining("'submission'"), [
      'Bo Bichette drafted by three teams simultaneously',
      '.311 AVG',
      'admin/123-bo.webp',
      'saw it on the subway',
      'A Fan',
    ]);
  });

  it('accepts a submission with only a headline', async () => {
    query.mockResolvedValue({ rows: [] });

    await createSubmittedHeadline({
      headline: 'Anonymous tip',
      stat_block: null,
      photo_ref: null,
      source_note: null,
      submitter_name: null,
    });

    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'Anonymous tip',
      null,
      null,
      null,
      null,
    ]);
  });
});
