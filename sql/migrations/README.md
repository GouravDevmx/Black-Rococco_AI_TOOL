# Migrations — run order

Run these in the Supabase SQL editor, in numeric order. Each one is safe to
re-run (`if not exists` guards), so if you're unsure whether a migration was
already applied, running it again does no harm.

| File | What it does | Status |
|---|---|---|
| `002_media_surfaces.sql` | Media/gallery surfaces | Older release |
| `003_indexes.sql` | Performance indexes | Older release |
| `004_client_auth_and_blogs.sql` | Client accounts + blog tables | Older release |
| `005_chat_messages.sql` | Chat messages table | Older release |
| **`006_chat_images.sql`** | `chat_messages.image_url` — chat image attachments | **Required for v27+** |
| **`007_chat_identity.sql`** | `chat_messages.whatsapp` — logged-in client identity in chat | **Required for v28+** |
| **`008_client_deposit.sql`** | `clients.deposit_on_file` — auto-confirm trusted clients | **Required for v31+** |

## If you are deploying v32 for the first time

Run 006, 007 and 008 (in that order) **before** pushing the code. The app
tolerates the columns being missing on flat-file storage, but on Supabase the
inserts will fail without them.

## Note on numbering

006–008 were renumbered from an earlier 003/004/005 to remove a collision with
the existing 003/004/005 files. The SQL inside is unchanged. If you already ran
the old `003_chat_images.sql` / `004_chat_identity.sql` / `005_client_deposit.sql`,
you do **not** need to run 006/007/008 again — they are the same statements.
