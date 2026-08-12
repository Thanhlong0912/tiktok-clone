// Supabase's hosted PostgREST caps every response at `max_rows` (1000 by
// default) and truncates *silently* -- no error, no flag on the response. A
// truncated reference set makes live media look unreferenced, which is exactly
// what `--delete` then removes, so every table read has to be paged explicitly.
export const PAGE_SIZE = 1000

export type PageResult<T> = {
    data: T[] | null
    error: unknown
}

export type FetchPage<T> = (from: number, to: number) => PromiseLike<PageResult<T>>

export const fetchAllRows = async <T,>(
    fetchPage: FetchPage<T>,
    pageSize: number = PAGE_SIZE
): Promise<T[]> => {
    if (!Number.isInteger(pageSize) || pageSize < 1) {
        throw new Error(`fetchAllRows needs a page size of at least 1, got ${pageSize}.`)
    }

    const rows: T[] = []
    let offset = 0

    for (;;) {
        const { data, error } = await fetchPage(offset, offset + pageSize - 1)

        if (error) {
            throw error
        }

        const page = data ?? []
        rows.push.apply(rows, page)

        // Only an *empty* page ends the walk. A short page cannot be trusted to
        // mean "last page": PostgREST also caps `limit` at the project's
        // `max_rows`, so if that is set below pageSize every page comes back
        // short and stopping here would silently drop the rest of the table.
        // Advancing by rows actually returned keeps this correct for any
        // max_rows, at the cost of one extra request at the end.
        if (page.length === 0) {
            return rows
        }

        offset += page.length
    }
}
