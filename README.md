# Azure VM Operations Portal

Combined authenticated portal with three independent operations:

- Alert Suppression
- VM Snapshot
- VM Backup

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
