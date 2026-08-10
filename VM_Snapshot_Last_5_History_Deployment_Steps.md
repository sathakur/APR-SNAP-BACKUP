# VM Snapshot – Last 5 Request History Deployment Steps

## What this update adds

The VM Snapshot tab now includes **My Snapshot Requests**, matching the existing VM Backup history pattern.

For each authenticated Microsoft Entra user, the portal stores only that user's latest **5** snapshot requests. When a 6th request is submitted, the oldest history entry is removed automatically.

The history table shows:

- Request ID
- VM hostnames
- Snapshot scope
- Retention period
- Change / incident number
- Submitted time
- Current/final status
- Snapshots created
- Failures
- Completed time
- View / Resume action

Selecting **View** loads the original request result. Selecting **View / Resume** for a request that is still running restarts automatic status polling.

## Security model

History is separated by the authenticated Microsoft Entra `userId`.

The browser never chooses which user's history to read. The API derives the user ID from the Static Web Apps `x-ms-client-principal` header and reads only the SHA-256-keyed history document for that authenticated user.

The existing `getSnapshotStatus` ownership check remains in place, so a user cannot use another user's Request ID to read that request.

## Storage design

No new storage account or container is required.

The existing setting is reused:

`SNAPSHOT_STATUS_CONTAINER_SAS_URL`

Snapshot request history is stored below a separate virtual path in the same private container:

`snapshot-request-history/<SHA256-of-Entra-userId>.json`

This path is separate from individual snapshot status blobs and also avoids collision with Backup history even if both features ever use the same container.

## New API files

### 1. api/src/shared/snapshotRequestHistoryStore.js

Maintains the per-user last-five request index using optimistic ETag concurrency control.

### 2. api/src/functions/getMySnapshotRequests.js

Returns the authenticated user's latest five requests and joins each history entry with the current snapshot status document.

## Modified files

### api/src/functions/submitSnapshot.js

After the initial status document is created, the request is added to the authenticated user's snapshot history. History tracking is best-effort: if history cannot be written, the actual snapshot request is still submitted and the user is told to retain the Request ID.

### app/portal.html

Adds the **My Snapshot Requests** card below Snapshot Results.

### app/app.js

Adds:

- Load latest 5 snapshot requests
- Refresh history
- Render history table
- View completed request
- Resume monitoring of in-progress request
- Refresh history automatically after submission and terminal completion

## Azure changes required

### No new Logic App deployment

Keep the existing VM Snapshot Logic App unchanged.

### No new custom role

Keep the existing snapshot permissions unchanged.

### No new Static Web App application setting

The feature reuses:

`SNAPSHOT_STATUS_CONTAINER_SAS_URL`

If current snapshot submission and status polling already work, the existing SAS normally already has the permissions required to create/read/write the history blob as well.

## Deployment

### Option A – Replace the repository with the supplied complete package

Extract the ZIP and copy its contents to the repository root.

Expected structure:

```text
.github/
api/
app/
deployment/
VM_Snapshot_Last_5_History_Deployment_Steps.md
...
```

Then run:

```powershell
git add .
git commit -m "Add authenticated VM snapshot request history"
git push origin main
```

Your existing Azure Static Web Apps GitHub workflow will deploy the frontend and API.

### Option B – Copy only the changed/new files

Add:

```text
api/src/shared/snapshotRequestHistoryStore.js
api/src/functions/getMySnapshotRequests.js
```

Replace:

```text
api/src/functions/submitSnapshot.js
app/portal.html
app/app.js
```

No change is required to `staticwebapp.config.json` because `/api/*` is already restricted to the `authenticated` role.

## Test procedure

1. Open the portal in an InPrivate/Incognito browser window.
2. Sign in using Microsoft Entra ID.
3. Open **VM Snapshot**.
4. Confirm **My Snapshot Requests** appears below the snapshot result area.
5. Submit a new snapshot request for one or more VMs.
6. Confirm the request appears in history shortly after submission.
7. While the request is running, confirm the row shows an in-progress status and **View / Resume**.
8. Click **View / Resume** and confirm the selected request loads above the history table and automatic polling resumes.
9. After completion, confirm the history row updates with:
   - Completed/PartiallyCompleted/Failed status
   - Snapshot count
   - Failure count
   - Completed timestamp
10. Click **View** on the completed request and confirm the detailed per-disk snapshot results are displayed.
11. Submit more than five snapshot requests (within your normal quota/testing constraints over time) and confirm only the latest five history entries are retained.
12. Sign in with a different Entra user and confirm that user's history is separate.

## Important note about the existing request quota

The existing portal limit of **3 snapshot requests per authenticated user in a rolling 24-hour period** is unchanged. Therefore, seeing five real history entries may require requests submitted across more than one rolling 24-hour period. History retention and request quota are independent controls.
