export const DEFAULT_MIN_AGE_HOURS = 24

export type ParsedArgs = {
    shouldDelete: boolean
    minAgeRaw: string | undefined
}

export const parseArgs = (argv: string[]): ParsedArgs => {
    const minAgeArg = argv.find((arg) => arg.startsWith('--min-age='))

    return {
        shouldDelete: argv.includes('--delete'),
        minAgeRaw: minAgeArg ? minAgeArg.slice('--min-age='.length) : undefined,
    }
}

// The sole gate on the delete grace window: anything this lets through is
// eligible for permanent deletion, so every malformed value has to throw
// rather than fall back to a default.
export const parseMinAgeHours = (raw: string | undefined): number => {
    if (raw === undefined) return DEFAULT_MIN_AGE_HOURS

    if (raw.trim() === '') {
        throw new Error(
            '--min-age was given no value. Pass a non-negative number of hours, e.g. --min-age=48.'
        )
    }

    const hours = Number(raw)

    if (!Number.isFinite(hours) || hours < 0) {
        throw new Error(`--min-age must be a non-negative number of hours, got "${raw}".`)
    }

    return hours
}
