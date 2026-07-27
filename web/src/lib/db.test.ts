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

const { getHeadlineById, createSubmittedHeadline, getPublishedHeadlinesPaged, PAGE_SIZE } =
  await import('./db');

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

describe('getPublishedHeadlinesPaged', () => {
  it('returns page metadata from the COUNT and clamps page >= 1', async () => {
    // First call: the page query; second: the COUNT.
    query
      .mockResolvedValueOnce({ rows: [{ id: 2 }, { id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: '30' }] });

    const result = await getPublishedHeadlinesPaged({ page: -3, pageSize: PAGE_SIZE });

    expect(result.page).toBe(1);
    expect(result.total).toBe(30);
    expect(result.totalPages).toBe(3);
    // OFFSET is (page-1)*pageSize, here 0 for the clamped page.
    expect(query.mock.calls[0][1]).toEqual([PAGE_SIZE, 0]);
  });

  it('computes OFFSET from the requested page', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '25' }] });

    await getPublishedHeadlinesPaged({ page: 3, pageSize: PAGE_SIZE });

    // page 3 → offset (3-1)*12 = 24
    expect(query.mock.calls[0][1]).toEqual([PAGE_SIZE, 24]);
  });

  it('defaults to the shared PAGE_SIZE when no pageSize is given', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await getPublishedHeadlinesPaged({ page: 1 });

    expect(query.mock.calls[0][1]).toEqual([PAGE_SIZE, 0]);
  });
});
