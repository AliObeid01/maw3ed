# scripts/db: clearing a database

Two SQL files for the owner. They were tested on a scratch copy of the schema.

| File | What it does |
| --- | --- |
| `preview-counts.sql` | **Read-only.** Prints the row count of every app table and shows that the migration table is not part of it. Changes nothing. Run it first. |
| `clear-all-data.sql` | Deletes **every row of every app table** (businesses, users, clients, appointments, everything; `TRUNCATE ... CASCADE`). |

**What `clear-all-data.sql` keeps:** `_prisma_migrations`, every table structure, the `appointment_no_overlap` exclusion constraint, the `btree_gist` extension, enums and indexes.
**What it removes:** all rows in the app tables.

## It is a dry run until you change the last line

The script really deletes inside a transaction, prints the counts after the delete, and then ends with `ROLLBACK`, which undoes everything. When the numbers are what you expect, change the **last line** from `ROLLBACK;` to `COMMIT;` and run it again. **Once committed it is IRREVERSIBLE.**

## Rules

* Make a **Neon backup branch** first (Neon console: Branches, create a branch from now).
* Use the **non-pooled** connection string (`DIRECT_URL`, the host has no `-pooler`).
* The files use `\set ON_ERROR_STOP`, which only **psql** understands. Do not paste them into a tool that is not psql (the Neon SQL editor may show only the last result).

## Running them

With psql installed:

```
psql "<DIRECT_URL>" -f scripts/db/preview-counts.sql
psql "<DIRECT_URL>" -f scripts/db/clear-all-data.sql
```

With Docker (no psql needed; Git Bash or PowerShell with `cmd`):

```
docker run --rm -i postgres:16 psql "<DIRECT_URL>" < scripts/db/preview-counts.sql
```

For a local development container named `maw3ed-db-1`: `docker exec -i maw3ed-db-1 psql "<DIRECT_URL>" < scripts/db/clear-all-data.sql`.
The exact copy-paste steps, including how to edit the last line, are in [docs/DEMO_DATA.md](../../docs/DEMO_DATA.md).
