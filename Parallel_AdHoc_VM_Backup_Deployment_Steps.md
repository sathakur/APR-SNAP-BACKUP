# Ad Hoc VM Backup — Parallel Processing (Maximum 5 VMs)

## What changed

1. The portal tab name is now:

```text
Ad Hoc VM Backup
```

2. A request containing multiple VMs now starts the VM backup workflows in parallel.

Maximum parallelism:

```text
5 VMs
```

3. Shared Logic App variables are **not modified from the parallel VM loop**.

This is important because using `AppendToArrayVariable` or `IncrementVariable` from concurrent
For Each iterations can produce unreliable results.

The new design is:

```text
Request
   |
   +---- VM01 -> Backup Now -> Monitor actual Backup Job -> VM01 result blob
   |
   +---- VM02 -> Backup Now -> Monitor actual Backup Job -> VM02 result blob
   |
   +---- VM03 -> Backup Now -> Monitor actual Backup Job -> VM03 result blob
   |
   +---- VM04 -> Backup Now -> Monitor actual Backup Job -> VM04 result blob
   |
   +---- VM05 -> Backup Now -> Monitor actual Backup Job -> VM05 result blob
                                   |
                                   v
                     Sequential result collection
                                   |
                                   v
                         Final request status
```

The parallel For Each configuration is:

```json
"runtimeConfiguration": {
  "concurrency": {
    "repetitions": 5
  }
}
```

## Safe result aggregation

Each VM writes its result to a unique blob under the existing `backup-status` container:

```text
parallel-results/<request-id>/<hostname>.json
```

After all parallel VM iterations finish, the Logic App uses a second sequential loop to read
those VM result blobs and create the final request result.

No shared success/failure counters are updated inside the parallel loop.

## Nesting validation

Maximum action nesting depth in the generated Logic App:

```text
8
```

This stays within the limit that caused the previous deployment validation error.

## Logic App file

Use:

```text
deployment/LogicApp_VM_Backup_Parallel_Max5.json
```

or the standalone:

```text
LogicApp_VM_Backup_Parallel_Max5.json
```

## Deploy the Logic App

Open the Backup Now Logic App:

```text
ARP-SNAP-BACKUP02
```

Then:

```text
Development Tools
→ Logic app code view
```

Replace the current workflow definition with:

```text
LogicApp_VM_Backup_Parallel_Max5.json
```

Click:

```text
Save
```

The same system-assigned managed identity can be used.

Keep its current Backup Now permissions and:

```text
Storage Blob Data Contributor
```

on the `backup-status` container.

No new RBAC permission is required for the parallel design.

## Static Web App callback variables

No callback-variable change is required if these are already correct:

```text
BACKUP_CHECK_LOGIC_APP_CALLBACK_URL
    = read-only Backup Status / pre-check Logic App

BACKUP_LOGIC_APP_CALLBACK_URL
    = ARP-SNAP-BACKUP02 Backup Now Logic App

BACKUP_STATUS_CONTAINER_SAS_URL
    = existing backup-status container SAS
```

## Deploy the portal tab-name change

Extract:

```text
Azure_VM_Operations_Portal_Parallel_AdHoc_Backup_Final.zip
```

over:

```text
C:\script\APR-SNAP-BACKUP
```

Then:

```powershell
cd "C:\script\APR-SNAP-BACKUP"

git status
git add .
git commit -m "Run ad hoc VM backups in parallel"
git pull --rebase origin main
git push origin main
```

## Test

Use two already-protected VMs first.

Example:

```text
WINVMTEST01
LINVMDEV01
```

After clicking **Trigger Backup Now**, open:

```text
ARP-SNAP-BACKUP02
→ Runs history
→ latest run
```

Inside `For_Each_Hostname`, both VM iterations should be active at approximately the same time.

If each VM normally needs around 40 minutes, two parallel backups should normally finish around
the duration of the slower VM, rather than roughly 80 minutes sequentially. Actual Azure Backup
duration can still vary.

## Storage note

The per-VM result blobs are small JSON status records. This workflow does not delete them because
the solution intentionally avoids Blob Delete permission. A Storage lifecycle rule can be added
later if automatic cleanup is required.
