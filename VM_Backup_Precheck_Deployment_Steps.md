# VM Backup Pre-check — Deployment Steps

This update changes the VM Backup experience to:

```text
Enter VM hostname(s)
    ↓
Check Backup Status
    ↓
Show protection / vault / policy / last backup / last successful backup
    ↓
Check active Backup Job
    ↓
Estimate approximate duration from recent successful jobs
    ↓
Enable Trigger Backup Now only when every VM is eligible
```

The existing corrected VM Backup Logic App still tracks the **actual Azure Backup Job**
until it reaches a terminal state.

## Files

- `api/src/functions/checkBackupStatus.js`
- `app/index.html`
- `app/app.js`
- `app/styles.css`
- `deployment/LogicApp_VM_Backup_Precheck.json`
- `deployment/VM_Backup_Status_Reader_Custom_Role.json`

## 1. Deploy the portal files

Extract the complete ZIP into:

```text
C:\script\APR-SNAPHOT
```

Verify:

```powershell
cd "C:\script\APR-SNAPHOT"

Test-Path api\src\functions\checkBackupStatus.js
Test-Path deployment\LogicApp_VM_Backup_Precheck.json
Test-Path deployment\VM_Backup_Status_Reader_Custom_Role.json
```

All should return `True`.

## 2. Create a new read-only Logic App

Recommended:

```text
Resource Group: rg-vm-backup-automation
Logic App:      la-vm-backup-status
Plan:           Consumption
```

Enable:

```text
Identity
→ System assigned
→ On
```

Open:

```text
Logic App
→ Development Tools
→ Logic app code view
```

Replace the workflow with:

```text
deployment/LogicApp_VM_Backup_Precheck.json
```

Save.

This Logic App is read-only. It does not need Blob Storage access.

## 3. Assign the read-only custom role

Use:

```text
deployment/VM_Backup_Status_Reader_Custom_Role.json
```

Assign it to the **la-vm-backup-status** managed identity at the required
subscription(s), or an approved parent scope.

The role includes:

```text
Microsoft.ResourceGraph/resources/read
Microsoft.Compute/virtualMachines/read
Microsoft.Resources/subscriptions/read
Microsoft.RecoveryServices/Locations/backupStatus/action
Microsoft.RecoveryServices/Vaults/read
Microsoft.RecoveryServices/Vaults/backupFabrics/protectionContainers/protectedItems/read
Microsoft.RecoveryServices/Vaults/backupJobs/read
```

It does NOT include:

```text
protectedItems/backup/action
protectedItems/write
backupPolicies/write
restore/action
backupJobs/cancel/action
backupJobs/retry/action
virtualMachines/write
```

## 4. Get the pre-check Logic App callback URL

Open:

```text
la-vm-backup-status
→ Designer
→ When an HTTP request is received
```

Copy the complete HTTP POST URL.

Do not post that URL in chat or documentation because it contains a signature.

## 5. Add one new Static Web App environment variable

Open:

```text
Static Web App
→ victorious-flower-0b4feae03
→ Environment variables
→ Production
```

Add:

```text
BACKUP_CHECK_LOGIC_APP_CALLBACK_URL
```

Value:

```text
<complete HTTP POST URL from la-vm-backup-status>
```

Keep the existing Backup variables:

```text
BACKUP_LOGIC_APP_CALLBACK_URL
BACKUP_STATUS_CONTAINER_SAS_URL
```

So Backup now uses:

```text
BACKUP_CHECK_LOGIC_APP_CALLBACK_URL
    → read-only pre-check Logic App

BACKUP_LOGIC_APP_CALLBACK_URL
    → Backup Now Logic App

BACKUP_STATUS_CONTAINER_SAS_URL
    → backup-status Blob container
```

## 6. Keep the existing Backup Logic App role

The **Backup Now** Logic App still needs the corrected operator role, including:

```text
Microsoft.RecoveryServices/Vaults/backupJobs/read
Microsoft.RecoveryServices/Vaults/backupFabrics/protectionContainers/protectedItems/backup/action
```

Do not replace the Backup Now Logic App role with the read-only role.

## 7. GitHub workflow

The full package contains the current `victorious-flower` workflow with:

```yaml
app_location: "app"
api_location: "api"
output_location: ""
skip_app_build: true
```

Remove obsolete Static Web App workflow files for old sites only after confirming
they are no longer needed.

## 8. Deploy

```powershell
cd "C:\script\APR-SNAPHOT"

git add .
git commit -m "Add VM Backup status pre-check"
git push origin main
```

Wait for the `victorious-flower` GitHub Action to succeed.

## 9. Test

Open the VM Backup tab.

Enter one protected VM and click:

```text
Check Backup Status
```

Expected information:

```text
VM
Subscription
Resource Group
Protection
Vault
Policy
Last backup status
Last backup time
Last successful backup
Current backup job
Approx. duration
Backup Now eligibility
```

If no backup job is currently running:

```text
Backup Now: Ready
```

and the change number, reason, and `Trigger Backup Now` button become enabled.

If a job is already running:

```text
Current backup job: InProgress
Backup Now: Blocked
```

and the trigger remains disabled.

If the VM is not protected:

```text
Protection: NotProtected
Backup Now: Blocked
```

The portal does not automatically enable Azure Backup protection.

## Approximate backup duration

The browser calculates a VM-specific estimate from up to five recent completed
Azure VM Backup jobs returned by the read-only Logic App. It uses the median duration
to reduce the effect of one unusually slow job.

Example:

```text
Approx. duration: ~18 min
Median of 4 recent successful backup jobs.
Actual duration may vary.
```

If no recent completed jobs are available:

```text
Not enough recent history
```

No fixed completion-time promise is shown.
