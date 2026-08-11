# Azure VM Operations Portal




Combined authenticated portal with four independent operations:

- Alert Suppression
- VM Snapshot
- VM Backup
- VM Health Diagnostic

## VM Backup

VM Backup supports:
- maximum 5 unique VMs per request
- maximum 3 backup requests per authenticated user in a rolling 24-hour period
- only VMs already protected by Azure Backup
- current Azure Backup protection status
- vault and policy
- last backup status
- last successful backup/recovery point date
- asynchronous Backup Now tracking
- Completed / PartiallyCompleted / Failed portal confirmation

The existing APR and Snapshot backends remain separate and unchanged.


## VM Backup pre-check

The VM Backup tab now performs a read-only Azure Backup status check before
Backup Now is enabled. It shows protection, vault, policy, last backup status,
last successful backup, active job state, and a VM-specific approximate duration.


## My Backup Requests

The VM Backup tab now includes server-side per-user request history. The latest
request IDs are indexed in the existing `backup-status` Blob container under a
SHA-256 hash of the authenticated Entra user ID. No Blob List permission is required.
Users can return later, including from another browser/device, and use **View** or
**View / Resume** to inspect a request.


## Ad Hoc VM Backup parallel execution

The VM Backup tab is now named **Ad Hoc VM Backup**. Up to five VMs in one request are processed
in parallel. Each concurrent VM writes a unique result record under
`backup-status/parallel-results/<request-id>/<hostname>.json`; results are collected sequentially
after the parallel loop so shared Logic App variables are not mutated concurrently.


## VM Health Diagnostic V1

VM Health Diagnostic adds a read-only troubleshooting view for up to five VMs per request. The dedicated Logic App processes VMs in parallel (maximum concurrency 5) and collects per-VM results safely through temporary Blob result records.

V1 includes VM discovery/configuration, power/provisioning state, Azure Resource Health, VM Agent and extensions, CPU metrics, optional VM Insights memory/logical-disk telemetry, managed disks, NIC/VNet/subnet/NSG references, Azure Backup protection, Update Manager assessment data, AMA/DCR/Log Analytics status, and consolidated portal findings.

Deployment instructions: `VM_HEALTH_DIAGNOSTIC_V1_DEPLOYMENT_STEPS.md`.
