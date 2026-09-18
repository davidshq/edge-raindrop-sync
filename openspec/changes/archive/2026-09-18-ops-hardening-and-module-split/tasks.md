## 1. Dead-letter queue

- [x] 1.1 Add `MAX_JOB_ATTEMPTS`, `KEY.DEAD_LETTER`, and MSG types for retry/clear
- [x] 1.2 Implement dead-letter list helpers in `queue.js` (list/size/add/clear/retry); `defer` moves to DLQ at max attempts
- [x] 1.3 Wire drain to pass `lastError` into defer/dead-letter logging
- [x] 1.4 Extend SW message API + Options Status (count, Retry, Clear)

## 2. Storage quota

- [x] 2.1 Soft-fail `write` / set failures into status + log
- [x] 2.2 Add `getStorageUsage()` (`getBytesInUse` + quota fallback)
- [x] 2.3 Show usage on Options Status refresh; mock `getBytesInUse` in verify-checklist

## 3. CI

- [x] 3.1 Add `.github/workflows/ci.yml` running `npm ci`, lint, and `npm test`

## 4. Spec / docs identity

- [x] 4.1 Apply GUID → node id wording in main specs (via this change + sync to main or direct edit)
- [x] 4.2 Update README notes if needed for consistency

## 5. Module splits

- [x] 5.1 Extract `client-errors.js`, `job-processors.js`, `drain.js`, `live-handlers.js`; thin `sync.js` facade
- [x] 5.2 Extract `reconcile-enqueue.js`, `reconcile-finish.js`; thin `reconcile.js` facade
- [x] 5.3 Update module header docs; keep public exports unchanged for SW/verify

## 6. Verification

- [x] 6.1 Add verify-checklist cases for dead-letter + storage usage
- [x] 6.2 Run `npm test` and `npm run lint`
