# Media bucket operations

Backup, sync, and migration are handled by [rclone](https://rclone.org), which
already does concurrent transfer, resume, and checksum comparison against
Supabase's S3-compatible endpoint. Only orphan detection needs custom code,
because it has to join bucket contents against application tables.

## Prerequisites

- The "S3 connection" toggle enabled at Supabase → Project settings → Storage.
- An S3 access key pair from that same page. **These bypass Row Level Security.**
- `rclone` installed (`brew install rclone`).

## Configure a remote

Add to `~/.config/rclone/rclone.conf`:

```ini
[supabase-prod]
type = s3
provider = Other
endpoint = https://<project-ref>.storage.supabase.co/storage/v1/s3
region = <project-region>
access_key_id = <access-key-id>
secret_access_key = <secret-access-key>
force_path_style = true
```

Verify: `rclone ls supabase-prod:media | head`

## Backup to a local mirror

Dry run first:

```bash
rclone sync supabase-prod:media ./media-backup --dry-run --progress
```

Then for real:

```bash
rclone sync supabase-prod:media ./media-backup --progress
```

`sync` makes the destination match the source, which means it **deletes local
files no longer in the bucket**. Use `rclone copy` instead if you want an
append-only archive that never removes anything.

## Sync one project to another

Define a second remote (`[supabase-staging]`) the same way, then:

```bash
rclone sync supabase-prod:media supabase-staging:media --dry-run --progress
rclone sync supabase-prod:media supabase-staging:media --progress
```

## Migrate to another S3 provider

Define the destination remote (R2, MinIO, AWS), then:

```bash
rclone copy supabase-prod:media r2-media --dry-run --progress
rclone copy supabase-prod:media r2-media --progress
```

`copy` rather than `sync`, so nothing at the destination is ever deleted.

After the objects are in place, point the app at the new host by setting
`NEXT_PUBLIC_MEDIA_BASE_URL` to the new public base url. Uploads still go to
Supabase until `libs/storage/index.ts` is repointed as well.

## Find orphaned objects

Objects that no post or profile row references — left behind by failed uploads
or by deletes that only removed the database row.

```bash
npm run media:orphans
```

Report-only by default. To actually delete:

```bash
npm run media:orphans -- --delete
```

Objects newer than 24 hours are never deleted, because an upload that lands
between the bucket listing and the database read is indistinguishable from an
orphan. Adjust with `--min-age=48`.

The script refuses to run if the database returns zero rows, since an empty
reference set would classify the entire bucket as orphaned.
