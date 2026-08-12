# Media bucket operations

Backup, sync, and migration are handled by [rclone](https://rclone.org), which
already does concurrent transfer, resume, and checksum comparison against
Supabase's S3-compatible endpoint. Only orphan detection needs custom code,
because it has to join bucket contents against application tables.

## Prerequisites

- The "S3 connection" toggle enabled at Supabase → Project settings → Storage.
- An S3 access key pair from that same page. **These bypass Row Level Security.**
- `rclone` installed (`brew install rclone`) — for the backup, sync, and
  migration sections only.

### Extra prerequisites for `npm run media:orphans`

The orphans script reads the bucket over S3 *and* the database with the
service-role key, so it needs more than rclone does. It loads `.env` via
`tsx --env-file`, which **requires Node 20.6 or newer** (`node --version`).

`.env` must define all of:

| Variable | Where it comes from |
| --- | --- |
| `SUPABASE_S3_ACCESS_KEY_ID` | Project settings → Storage → S3 connection |
| `SUPABASE_S3_SECRET_ACCESS_KEY` | Project settings → Storage → S3 connection |
| `SUPABASE_SERVICE_ROLE_KEY` | Project settings → API |
| `NEXT_PUBLIC_SUPABASE_REGION` | Project settings → Storage → S3 connection |
| `NEXT_PUBLIC_SUPABASE_URL` | Project settings → API |
| `NEXT_PUBLIC_SUPABASE_BUCKET` | The bucket name, e.g. `media` |
| `NEXT_PUBLIC_PLACEHOLDER_DEAFULT_IMAGE_ID` | Object name of the default avatar |

Any one of them missing stops the run with
`Missing required environment variable <NAME>` before anything is listed or
deleted. The last two are not optional here even though the app tolerates
defaults for them: the placeholder avatar is referenced by no database row, so
a run that does not know its key would classify it as an orphan.

The S3 keys and the service-role key all bypass Row Level Security. Keep them
out of the browser and out of version control.

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

**`sync` deletes at the destination here too.** Objects in `supabase-staging`
that are not in `supabase-prod` are removed from staging — this is a live
bucket, not a local folder, and there is no undo. Transpose the two arguments
by accident and it deletes production media instead. Always run the `--dry-run`
first and read which side it names as the destination. Use `rclone copy` if you
only want to add what is missing and never remove anything.

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

See the prerequisites above — this needs `.env` populated and Node ≥ 20.6.

Objects newer than 24 hours are never deleted, because an upload that lands
between the bucket listing and the database read is indistinguishable from an
orphan. Adjust with `--min-age=48`.

### Safety guards

Everything an orphan report gets wrong comes from the same place: a reference
set that is missing rows makes live media look unreferenced. Three guards sit
in front of `--delete`.

- **Zero rows.** The script refuses to run if either table returns no rows,
  since an empty reference set would classify the entire bucket as orphaned.
- **Orphan ratio.** `--delete` refuses if more than 50% of the listed objects
  look orphaned, printing the ratio and both counts and exiting non-zero. A
  healthy bucket is not half garbage, so crossing that line means the
  reference set is more likely wrong than the bucket. Report mode still prints
  the full list — only the deletion is refused. If the number really is
  correct, delete in smaller passes (e.g. raise `--min-age`) or clean up by
  hand.
- **Protected placeholder.** The default avatar key is added to the reference
  set explicitly and echoed in the report as `Protected placeholder key: …`,
  so you can confirm it is covered before deleting.

Table reads are paged. Supabase's PostgREST caps a response at `max_rows`
(1000 by default) and truncates silently, so an unpaged read on a project with
more than 1000 posts would quietly omit the rest — and every object they
reference would be reported as an orphan.
