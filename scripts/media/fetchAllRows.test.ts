import { describe, expect, it, vi } from 'vitest'
import { fetchAllRows, PAGE_SIZE } from './fetchAllRows'

type Row = { id: number }

const rows = (count: number, start = 0): Row[] =>
    Array.from({ length: count }, (_, index) => ({ id: start + index }))

// Serves `total` rows out of a fake table, recording every requested range.
const fakeTable = (total: number, pageSize: number) => {
    const ranges: [number, number][] = []
    const all = rows(total)

    const fetchPage = async (from: number, to: number) => {
        ranges.push([from, to])
        expect(to - from + 1).toBe(pageSize)
        return { data: all.slice(from, to + 1), error: null }
    }

    return { fetchPage, ranges }
}

// Serves `total` rows but never returns more than `cap` per request, however
// wide the requested range -- what PostgREST does when the project's max_rows
// is set below our page size.
const cappedTable = (total: number, cap: number) => {
    const ranges: [number, number][] = []
    const all = rows(total)

    const fetchPage = async (from: number, to: number) => {
        ranges.push([from, to])
        return { data: all.slice(from, to + 1).slice(0, cap), error: null }
    }

    return { fetchPage, ranges }
}

describe('fetchAllRows', () => {
    it('asks again after a short page, since short can mean a max_rows cap', async () => {
        const { fetchPage, ranges } = fakeTable(3, 10)

        expect(await fetchAllRows(fetchPage, 10)).toEqual(rows(3))
        expect(ranges).toEqual([[0, 9], [3, 12]])
    })

    it('asks again after exactly one full page and stops on the empty one', async () => {
        const { fetchPage, ranges } = fakeTable(10, 10)

        expect(await fetchAllRows(fetchPage, 10)).toEqual(rows(10))
        expect(ranges).toEqual([[0, 9], [10, 19]])
    })

    it('pages through multiple full pages then a short one', async () => {
        const { fetchPage, ranges } = fakeTable(25, 10)

        expect(await fetchAllRows(fetchPage, 10)).toEqual(rows(25))
        expect(ranges).toEqual([[0, 9], [10, 19], [20, 29], [25, 34]])
    })

    it('collects every row when max_rows is capped below the page size', async () => {
        const { fetchPage, ranges } = cappedTable(25, 9)

        const result = await fetchAllRows(fetchPage, 10)

        expect(result).toHaveLength(25)
        expect(result).toEqual(rows(25))
        // Advancing by rows actually returned, not by the requested page size.
        expect(ranges).toEqual([[0, 9], [9, 18], [18, 27], [25, 34]])
    })

    it('does not truncate at the postgrest default max_rows', async () => {
        const { fetchPage } = fakeTable(1500, PAGE_SIZE)

        const result = await fetchAllRows(fetchPage)

        expect(result).toHaveLength(1500)
        expect(result[1499]).toEqual({ id: 1499 })
    })

    it('treats a null data page as empty and stops', async () => {
        const fetchPage = vi.fn().mockResolvedValue({ data: null, error: null })

        expect(await fetchAllRows(fetchPage, 10)).toEqual([])
        expect(fetchPage).toHaveBeenCalledTimes(1)
    })

    it('propagates an error returned by the page fetcher', async () => {
        const fetchPage = vi.fn().mockResolvedValue({
            data: null,
            error: new Error('JWT expired'),
        })

        await expect(fetchAllRows(fetchPage, 10)).rejects.toThrow('JWT expired')
        expect(fetchPage).toHaveBeenCalledTimes(1)
    })

    it('propagates an error raised on a later page rather than returning partial rows', async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({ data: rows(10), error: null })
            .mockResolvedValueOnce({ data: null, error: new Error('connection reset') })

        await expect(fetchAllRows(fetchPage, 10)).rejects.toThrow('connection reset')
        expect(fetchPage).toHaveBeenCalledTimes(2)
    })

    it('propagates a rejected page fetch', async () => {
        const fetchPage = vi.fn().mockRejectedValue(new Error('network down'))

        await expect(fetchAllRows(fetchPage, 10)).rejects.toThrow('network down')
    })

    it('rejects a page size that would never terminate', async () => {
        const fetchPage = vi.fn()

        await expect(fetchAllRows(fetchPage, 0)).rejects.toThrow(/page size of at least 1/)
        expect(fetchPage).not.toHaveBeenCalled()
    })
})
