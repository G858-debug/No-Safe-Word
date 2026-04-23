-- 20260421203854_nsw_users_drift_repair.sql
-- (Renamed from 039_nsw_users_drift_repair.sql — kept alongside migrations
--  038 and 040 numeric-prefixed; see docs/deployment-notes.md.)
-- Repairs schema drift on public.nsw_users discovered during Phase 0.5b deployment.
-- nsw_users was created out-of-band (dashboard) before migration 002 was authored;
-- "create table if not exists" in 002 was a no-op, so the declared NOT NULL and UNIQUE
-- on auth_user_id never applied to the live table. This caused every upsert with
-- onConflict: "auth_user_id" to fail silently for the life of the project.
-- Backfills orphaned auth.users rows, enforces NOT NULL, adds UNIQUE.

BEGIN;

-- Step 1: backfill nsw_users for any orphaned auth.users.
-- Synthetic WA emails (wa<phone>@nosafeword.co.za) get has_whatsapp=true; everything else has_email=true.
INSERT INTO public.nsw_users (auth_user_id, email, has_email, has_whatsapp)
SELECT
  u.id,
  u.email,
  u.email NOT LIKE 'wa%@nosafeword.co.za',
  u.email LIKE 'wa%@nosafeword.co.za'
FROM auth.users u
LEFT JOIN public.nsw_users n ON n.auth_user_id = u.id
WHERE n.id IS NULL AND u.email IS NOT NULL;

-- Step 2: enforce NOT NULL (safe — every row has a non-null auth_user_id after step 1).
ALTER TABLE public.nsw_users
  ALTER COLUMN auth_user_id SET NOT NULL;

-- Step 3: add the missing UNIQUE constraint (safe — no duplicates, confirmed pre-apply).
ALTER TABLE public.nsw_users
  ADD CONSTRAINT nsw_users_auth_user_id_key UNIQUE (auth_user_id);

COMMIT;
