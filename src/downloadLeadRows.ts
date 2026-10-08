type LeadPage<T> = { rows: T[]; total: number };

// Collect all filtered pages before creating a file, so a failed request cannot
// silently produce a partial download.
export async function downloadLeadRows<T>(
  loadPage: (offset: number, limit: number) => Promise<LeadPage<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | null = null;
  do {
    const page = await loadPage(rows.length, 200);
    if (expected !== null && expected !== page.total) {
      throw new Error('The lead list changed during download. Refresh and try again.');
    }
    expected = page.total;
    if (!page.rows.length && rows.length < expected) {
      throw new Error('The lead list changed during download. Refresh and try again.');
    }
    rows.push(...page.rows);
  } while (rows.length < expected);
  return rows;
}
