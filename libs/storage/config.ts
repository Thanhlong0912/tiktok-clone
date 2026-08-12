const projectRefError = (supabaseUrl: string): Error =>
    new Error(
        `Cannot derive a project ref from "${supabaseUrl}". ` +
        'The S3 storage layer requires a hosted Supabase project url of the ' +
        'form https://<project-ref>.supabase.co'
    )

export const getProjectRef = (supabaseUrl: string): string => {
    let hostname: string

    try {
        // A value that is not a url at all would otherwise surface as a bare
        // TypeError with no hint about which setting is wrong.
        hostname = new URL(supabaseUrl).hostname
    } catch {
        throw projectRefError(supabaseUrl)
    }

    if (!hostname.endsWith('.supabase.co')) {
        throw projectRefError(supabaseUrl)
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

// Supabase's S3 endpoint uses this value as the SigV4 secret when
// authenticating with a user's session token. It must be the *legacy* anon
// JWT: the newer sb_publishable_ format is not supported there yet
// (supabase/storage#750). Getting it wrong fails inside the AWS SDK as an
// opaque signature mismatch on every request, whatever the file size, so the
// format is checked here where the error can name the actual problem.
export const getS3SecretAccessKey = (): string => {
    const key = process.env.NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY

    if (!key) {
        throw new Error(
            'Missing NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY. Supabase S3 uploads ' +
            'need the legacy anon key (a JWT starting "eyJ"), from Supabase → ' +
            'Project settings → API → Legacy API keys. It is separate from ' +
            'NEXT_PUBLIC_SUPABASE_ANON_KEY, which the app client keeps using.'
        )
    }

    if (key.startsWith('sb_secret_')) {
        throw new Error(
            'NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY holds a secret key ' +
            '(sb_secret_...). That grants full access and must never reach the ' +
            'browser. Use the legacy anon key (a JWT starting "eyJ") instead.'
        )
    }

    if (key.startsWith('sb_publishable_')) {
        throw new Error(
            'NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY holds a publishable key ' +
            '(sb_publishable_...), which Supabase S3 does not accept for ' +
            'session-token auth yet (supabase/storage#750). Use the legacy ' +
            'anon key (a JWT starting "eyJ") from Project settings → API → ' +
            'Legacy API keys.'
        )
    }

    if (!key.startsWith('eyJ')) {
        throw new Error(
            'NEXT_PUBLIC_SUPABASE_LEGACY_ANON_KEY does not look like a legacy ' +
            'anon key. Expected a JWT starting "eyJ", from Project settings → ' +
            'API → Legacy API keys.'
        )
    }

    return key
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
