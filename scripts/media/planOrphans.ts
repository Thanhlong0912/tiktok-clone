export type BucketObject = {
    key: string
    lastModified: Date
}

export type OrphanPlan = {
    orphans: string[]
    skipped: string[]
}

export const planOrphans = (
    objects: BucketObject[],
    referenced: Set<string>,
    options: { minAgeMs: number; now: Date }
): OrphanPlan => {
    const orphans: string[] = []
    const skipped: string[] = []

    for (const object of objects) {
        if (referenced.has(object.key)) {
            continue
        }

        const age = options.now.getTime() - object.lastModified.getTime()

        // An object uploaded between the bucket listing and the database read
        // looks exactly like an orphan, so recent objects are always spared.
        if (age < options.minAgeMs) {
            skipped.push(object.key)
        } else {
            orphans.push(object.key)
        }
    }

    return { orphans, skipped }
}
