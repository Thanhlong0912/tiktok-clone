import type { AwsCredentialIdentity } from '@aws-sdk/types'

export type GetSession = () => Promise<{
    data: { session: { access_token: string } | null }
}>

export const decodeJwtExpiry = (token: string): Date | undefined => {
    const payload = token.split('.')[1]

    if (!payload) {
        return undefined
    }

    try {
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
        const decoded = JSON.parse(
            decodeURIComponent(
                atob(normalized)
                    .split('')
                    .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
                    .join('')
            )
        )

        return typeof decoded.exp === 'number'
            ? new Date(decoded.exp * 1000)
            : undefined
    } catch {
        return undefined
    }
}

export const createSessionCredentialProvider = (options: {
    projectRef: string
    anonKey: string
    getSession: GetSession
}) => {
    return async (): Promise<AwsCredentialIdentity> => {
        const { data: { session } } = await options.getSession()

        if (!session) {
            throw new Error('You must be logged in to upload files')
        }

        return {
            accessKeyId: options.projectRef,
            secretAccessKey: options.anonKey,
            sessionToken: session.access_token,
            expiration: decodeJwtExpiry(session.access_token),
        }
    }
}
