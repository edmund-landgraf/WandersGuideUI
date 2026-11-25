# Atomic campaign duplication (#73)

Apply `supabase/wgui-campaign-copy.sql` to the existing Wanderers Guide Postgres database **before** deploying the frontend and restarting the functions overlay. It is additive and rerunnable. For a Docker stack, from the WGUI checkout (adjust the DB container name if necessary):

```sh
docker exec -i wanderers-guide-db-1 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/wgui-campaign-copy.sql
npm run stack:restart
npm run test:wgui-ext
```

The frontend must not fall back to the old non-atomic writes when the worker or RPC is missing. Deploy frontend using the normal build procedure after the SQL and edge worker are available.

Database rows and the idempotency receipt commit together. Retry with the same caller and operation UUID returns the same target; a new UUID intentionally makes a new copy. The frontend retains the UUID and staged banner URL until a confirmed response (including same-tab reloads, where session storage is available). Storage is not part of a Postgres transaction: a failed copy can leave a staged banner upload; the retry reuses it. Do not automatically delete URLs because the existing uploader can return a source/public URL on failure. Abandoned uploads need a separately verified ownership-aware cleanup; #74 and #75 cover artwork migration and failure handling. Closing the tab or disabling session storage limits retry recovery.

The current copy authorization policy is unchanged (#71); dry-run enumeration remains separate (#72). Run the SQL failure-injection test only on an isolated test database with an existing auth user, passing that user's UUID as `test_user_id`. It rolls back its fixtures and trigger.

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -v test_user_id=YOUR_TEST_USER_UUID -f supabase/tests/wgui-campaign-copy.sql
```
