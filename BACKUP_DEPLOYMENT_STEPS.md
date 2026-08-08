# Azure VM Operations Portal — VM Backup Deployment

This package adds a third **VM Backup** tab while keeping the existing Alert
Suppression and VM Snapshot implementations separate.

## Architecture

```text
Azure VM Operations Portal
│
├── Alert Suppression
│   └── /api/submitSuppression
│       └── Existing APR Logic App
│
├── VM Snapshot
│   ├── /api/submitSnapshot
│   └── Existing Snapshot Logic App
│
└── VM Backup
    ├── /api/submitBackup
    ├── /api/getBackupStatus
    └── New VM Backup Logic App
```

The Backup feature does not enable Azure Backup protection and does not modify
backup policies. Only VMs already protected by Azure Backup can run Backup Now.

---

## 1. Deploy portal code

Extract the complete ZIP directly into:

```text
C:\script\APR-SNAPHOT
```

Verify:

```powershell
cd "C:\script\APR-SNAPHOT"

Test-Path app\index.html
Test-Path api\src\functions\submitSuppression.js
Test-Path api\src\functions\submitSnapshot.js
Test-Path api\src\functions\submitBackup.js
Test-Path api\src\functions\getBackupStatus.js
```

All should return `True`.

---

## 2. Keep the existing Static Web App workflow

Keep:

```text
.github\workflows\azure-static-web-apps-zealous-grass-03c5f4003.yml
```

The deployment paths must remain:

```yaml
app_location: "app"
api_location: "api"
output_location: ""
skip_app_build: true
```

---

## 3. Create backup-status Blob container

You can use the **same Storage Account** already used for Snapshot status.

Create a second private Blob container:

```text
backup-status
```

Do not enable anonymous/public access.

Generate a container SAS with only:

```text
Read
Create
Write
```

Copy the complete container SAS URL:

```text
https://<storage-account>.blob.core.windows.net/backup-status?<SAS>
```

This becomes:

```text
BACKUP_STATUS_CONTAINER_SAS_URL
```

The Static Web App API uses the SAS to:
- create the initial backup status record
- poll/read the status record
- enforce the 3 backup requests/user/24h quota

The Backup Logic App writes to the same status record with Managed Identity.

---

## 4. Create the new VM Backup Logic App

Recommended:

```text
Resource group:
rg-vm-backup-automation

Logic App:
la-vm-backup-portal

Plan:
Consumption
```

Enable:

```text
Identity
→ System assigned
→ On
```

Import:

```text
deployment/LogicApp_VM_Backup_Final.json
```

through:

```text
Logic App
→ Development Tools
→ Logic app code view
```

Save the workflow.

---

## 5. Assign minimum Azure Backup permissions

Use:

```text
deployment/VM_Backup_Portal_Custom_Role.json
```

Replace:

```text
/subscriptions/<TARGET-SUBSCRIPTION-ID>
```

with the approved subscription or define it at an approved parent Management
Group.

The role contains:

```text
Microsoft.ResourceGraph/resources/read
Microsoft.Compute/virtualMachines/read
Microsoft.Resources/subscriptions/read
Microsoft.RecoveryServices/Locations/backupStatus/action
Microsoft.RecoveryServices/Vaults/read
Microsoft.RecoveryServices/Vaults/backupFabrics/protectionContainers/protectedItems/read
Microsoft.RecoveryServices/Vaults/backupFabrics/protectionContainers/protectedItems/backup/action
Microsoft.RecoveryServices/Vaults/backupFabrics/protectionContainers/protectedItems/operationsStatus/read
```

It does NOT allow:
- enabling/disabling protection
- changing backup policy
- deleting backup data
- restore
- VM modification

Assign the role to:

```text
la-vm-backup-portal
```

---

## 6. Give Backup Logic App access to backup-status container

Open:

```text
Storage Account
→ Containers
→ backup-status
→ Access Control (IAM)
```

Assign:

```text
Storage Blob Data Contributor
```

to the **la-vm-backup-portal system-assigned managed identity**.

Scope it only to the `backup-status` container.

The Logic App status-write HTTP actions use:

```text
Managed Identity
Audience: https://storage.azure.com/
```

---

## 7. Copy Backup Logic App callback URL

Open:

```text
la-vm-backup-portal
→ Designer
→ When an HTTP request is received
```

Copy the complete HTTP POST URL.

---

## 8. Static Web App Production variables

Open:

```text
Static Web App
→ Environment variables
→ Production
```

Keep the existing values:

```text
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
LOGIC_APP_CALLBACK_URL
SNAPSHOT_LOGIC_APP_CALLBACK_URL
SNAPSHOT_STATUS_CONTAINER_SAS_URL
```

Add:

```text
BACKUP_LOGIC_APP_CALLBACK_URL
BACKUP_STATUS_CONTAINER_SAS_URL
```

Where:

```text
BACKUP_LOGIC_APP_CALLBACK_URL
→ la-vm-backup-portal Request trigger HTTP POST URL

BACKUP_STATUS_CONTAINER_SAS_URL
→ backup-status container SAS URL
```

---

## 9. Deploy

```powershell
cd "C:\script\APR-SNAPHOT"

git add .
git commit -m "Add Azure VM Backup operations"
git push origin main
```

Wait for GitHub Actions to complete successfully.

---

## 10. VM Backup behavior

Portal limits:

```text
Maximum VMs/request: 5
Maximum requests/user/rolling 24h: 3
```

The VM Backup Logic App performs:

```text
Hostname
→ Azure Resource Graph VM lookup
→ Azure Backup protection-status lookup
→ If Protected:
     Read protected item
     Capture current lastBackupStatus
     Capture current lastRecoveryPoint
     Trigger Backup Now
     Poll Azure Backup operation
     Refresh protected item
     Capture latest lastBackupStatus
     Capture latest lastRecoveryPoint
→ If Not Protected:
     report NotProtected
```

The portal table includes:

```text
Hostname
Protection
Vault
Policy
Last backup status
Last successful backup
Request status
Details
```

`Last successful backup` is taken from the protected item's
`lastRecoveryPoint`, which represents the most recent backup copy/recovery point.

---

## 11. First test

Use one non-production VM that is already protected by Azure Backup.

Submit:

```text
VM hostname: <test VM>
Change / incident: CHG...
Reason: Backup portal test
```

Expected portal progression:

```text
VM backup request submitted
→ VM backup is in progress
→ VM backup completed successfully
```

Expected result example:

```text
Hostname              VM01
Protection            Protected
Vault                 rsv-prod-we
Policy                Daily-VM
Last backup status    Completed
Last successful backup 08/08/2026 10:40 CEST
Request status        Completed
```

If the VM is not protected:

```text
Protection            NotProtected
Request status        NotProtected
Details               VM is not currently protected by Azure Backup
```

No backup policy is created or changed.
