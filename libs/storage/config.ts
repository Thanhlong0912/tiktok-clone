export const getProjectRef = (supabaseUrl: string): string => {
    const { hostname } = new URL(supabaseUrl)

    if (!hostname.endsWith('.supabase.co')) {
        throw new Error(
            `Cannot derive a project ref from "${supabaseUrl}". ` +
            'The S3 storage layer requires a hosted Supabase project url of the ' +
            'form https://<project-ref>.supabase.co'
        )
    }

    return hostname.split('.')[0]
}

export const getS3Endpoint = (supabaseUrl: string): string => {
    return `https://${getProjectRef(supabaseUrl)}.storage.supabase.co/storage/v1/s3`
}

export const getPublicBaseUrl = (
    supabaseUrl: string,
    bucket: string,
    override?: string
): string => {
    if (override) {
        return override.replace(/\/+$/, '')
    }

    return `${supabaseUrl}/storage/v1/object/public/${bucket}`
}

export const getRegion = (): string => {
    const region = process.env.NEXT_PUBLIC_SUPABASE_REGION

    if (!region) {
        throw new Error(
            'Missing NEXT_PUBLIC_SUPABASE_REGION. Copy it from Supabase → ' +
            'Project settings → Storage → S3 connection.'
        )
    }

    return region
}
