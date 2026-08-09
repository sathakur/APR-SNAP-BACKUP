# VM Backup History — Keep Only Last 5 Requests

This update keeps and displays only the latest **5** VM Backup requests per authenticated Microsoft Entra user.

When a 6th request is submitted, the oldest request is removed from the user's history index.

## Files changed

```text
api/src/shared/backupRequestHistoryStore.js
api/src/functions/getMyBackupRequests.js
app/app.js
app/index.html
```

## Important

This only rotates entries out of the **My Backup Requests history index**.
It does not delete the underlying request-status blob, so no Blob Delete permission is required.

## Deploy

Extract the full package into:

```text
C:\script\APR-SNAP-BACKUP
```

Then run:

```powershell
cd "C:\script\APR-SNAP-BACKUP"

git status
git add .
git commit -m "Keep only last five backup requests"
git pull --rebase origin main
git push origin main
```

No Logic App change is required.
No Static Web App environment-variable change is required.
No RBAC change is required.
