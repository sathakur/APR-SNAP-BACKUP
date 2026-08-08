# My Backup Requests — Deployment Steps

This update adds **server-side per-user VM Backup request history**.

Users can close the browser while Azure Backup is running and later return to the
VM Backup tab to see the current/final status of their recent requests.

## What is added

```text
My Backup Requests

Request ID   VMs          Change   Submitted   Status       Completed VMs   Completed
...          LINVMDEV01   CH123    14:52 CEST  Processing   0/1             -
...          WINVMTEST01  CH122    12:10 CEST  Completed    1/1             12:51 CEST
```

Each row has:

```text
View
```

or:

```text
View / Resume
```

For an active request, **View / Resume** loads the request and restarts live polling.

## Architecture

No new Azure resource is required.

The existing `backup-status` Blob container is reused:

```text
backup-status/
├── <requestId>.json
├── request-limits/
│   └── <SHA256-user-id>.json
└── request-history/
    └── <SHA256-user-id>.json
```

`request-history` is a virtual Blob Storage folder. It does not need to be created
manually.

The user's raw Entra user ID is **not** used as the blob name. The API hashes it with
SHA-256.

The history index keeps the newest **100 requests per authenticated user**.
The portal displays the newest **25**.

## Storage SAS permissions

No new SAS permission is required.

Keep the existing:

```text
BACKUP_STATUS_CONTAINER_SAS_URL
```

with:

```text
Read    ✓
Create  ✓
Write   ✓
List    ✗
Delete  ✗
```

The implementation does not list the container. It reads the authenticated user's
known `request-history/<hash>.json` blob and then reads each indexed request status.

## New API files

```text
api/src/functions/getMyBackupRequests.js
api/src/shared/backupRequestHistoryStore.js
```

`submitBackup.js` is also updated so every newly accepted backup request is added to
the authenticated user's server-side request history.

## Deploy

Extract:

```text
Azure_VM_Operations_Portal_My_Backup_Requests_Final.zip
```

into:

```text
C:\script\APR-SNAP-BACKUP
```

Verify:

```powershell
cd "C:\script\APR-SNAP-BACKUP"

Test-Path api\src\functions\getMyBackupRequests.js
Test-Path api\src\shared\backupRequestHistoryStore.js
```

Both should return:

```text
True
```

Then:

```powershell
git status
git add .
git commit -m "Add My Backup Requests history"
git pull --rebase origin main
git push origin main
```

If `git pull --rebase` reports a conflict in the `victorious-flower` workflow,
keep the current GitHub `victorious-flower` workflow and continue the rebase.

## GitHub Actions

Confirm only the current workflow is being used:

```text
.github/workflows/azure-static-web-apps-victorious-flower-0b4feae03.yml
```

It must contain:

```yaml
app_location: "app"
api_location: "api"
output_location: ""
skip_app_build: true
```

## Static Web App environment variables

No new environment variable is required for My Backup Requests.

Keep:

```text
BACKUP_CHECK_LOGIC_APP_CALLBACK_URL
BACKUP_LOGIC_APP_CALLBACK_URL
BACKUP_STATUS_CONTAINER_SAS_URL
```

## Logic Apps

No change is required to the Backup Now Logic App for this history feature.

The complete package also contains the corrected Backup Pre-check Logic App with the
Azure Backup Jobs 12-hour `AM/PM` time-filter fix:

```text
deployment/LogicApp_VM_Backup_Precheck.json
```

If that corrected workflow is already deployed, there is nothing else to change.

## Test

1. Sign in.
2. Open **VM Backup**.
3. Submit a new backup.
4. Confirm it appears immediately under **My Backup Requests** as `Submitted` or
   `Processing`.
5. Close the browser.
6. Reopen the portal later with the same Microsoft Entra user.
7. Open **VM Backup**.
8. The request should appear from server-side history.
9. Click **View / Resume** while processing, or **View** after completion.

## Existing requests

Requests created **before this update** are not automatically backfilled into the
new server-side history index.

An already-active request stored in the same browser can still continue through the
existing `activeBackupRequestId` local-storage mechanism.

All new requests submitted after this deployment are indexed server-side.
