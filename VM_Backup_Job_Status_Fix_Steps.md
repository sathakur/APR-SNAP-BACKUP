# VM Backup Job Status Fix

## Why the portal showed Completed too early

The Backup Now trigger is asynchronous. Azure first completes the **trigger operation**
that creates/starts a Backup Job. The previous Logic App treated the trigger operation's
`Succeeded` state as if the backup job itself had completed.

The corrected workflow:

1. Triggers Backup Now.
2. Polls the protected-item operation status.
3. Reads the returned `jobId`.
4. Polls `/backupJobs/{jobId}` every 30 seconds.
5. Keeps the portal status as Processing while the job is `InProgress`.
6. Writes Completed only when the actual Backup Job is `Completed`.
7. Handles `CompletedWithWarnings`, `Failed`, and `Cancelled` separately.
8. Uses the completed Backup Job end time as the successful backup date for the
   just-triggered backup and also retains the protected item's recovery-point timestamp.

## Required RBAC change

Add this action to the Backup Logic App custom role:

```text
Microsoft.RecoveryServices/Vaults/backupJobs/read
```

Do not add cancel/retry permissions.

## Deploy

### 1. Update the custom role

Use:

```text
VM_Backup_Portal_Custom_Role_Job_Status_Fix.json
```

Update the existing custom role or add the `backupJobs/read` action manually.

### 2. Update the VM Backup Logic App

Use:

```text
LogicApp_VM_Backup_Final_Job_Status_Fix.json
```

Open the VM Backup Logic App code view, replace the workflow JSON, save, and verify
the system-assigned managed identity is still enabled.

### 3. Portal code

The backend status fix is in the Logic App. The included portal package only adds
correct visual handling for `CompletedWithWarnings`.

Deploy portal code normally if using the complete ZIP.

## Expected behavior

```text
Trigger Backup Now
    ↓
Submitted
    ↓
Processing / Azure Backup Job = InProgress
    ↓
Completed / CompletedWithWarnings / Failed / Cancelled
```

The green `VM backup completed successfully` message is now written only after the
actual Azure Backup Job status becomes `Completed`.
