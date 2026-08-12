# VM Health Diagnostic V2 — Complete Deployment Steps

## Scope

This package upgrades **VM Health Diagnostic only**. Existing Alert Suppression, VM Snapshot, and On-Demand VM Backup modules remain unchanged.

V2 remains:

- one VM per request
- one Health Diagnostic Logic App
- read-only / diagnostic-only
- no reboot/start/stop/redeploy
- no service restart
- no disk/network modification
- no patch installation
- no backup configuration change
- **no Health Score**

## V2 result features

1. Correct unavailable telemetry handling: `Unknown` or `N/A – VM not running`, never fake `0.0%`.
2. Current Resource Health plus Resource Health history/recommended-action metadata.
3. Active fired Azure Monitor alerts for the VM.
4. Azure Activity Log changes for the VM during the last 24 hours.
5. Expanded Azure Monitor platform metrics: CPU, network, disk I/O, disk latency and consumed IOPS/bandwidth where supported.
6. VM Insights memory, logical-disk free space and heartbeat freshness.
7. Managed-disk configuration.
8. NIC/VNet/subnet/NSG plus effective routes and effective NSGs for the primary NIC.
9. VM extensions, AMA and DCR associations.
10. Detailed Azure Backup protection, last-backup status/time and latest recovery point where available.
11. Detailed latest Update Manager assessment and pending classifications.
12. Boot Diagnostics enabled/disabled state. Temporary boot-log SAS URLs are deliberately not returned.
13. Data-freshness section.
14. Consolidated findings and recommended next actions.
15. Copy for incident, Download JSON, Export CSV and Open VM in Azure buttons.

> Target-specific Network Watcher connectivity testing is not automatically run because it requires a destination address/port. It is best implemented as an optional follow-on diagnostic action rather than silently probing arbitrary endpoints.

---

## 1. Back up the current repository

Example:

```powershell
cd C:\script\APR-SNAP-BACKUP
git status
git branch backup-before-health-v2
```

## 2. Deploy the portal/API code

Copy the contents of this package into the **repository root** so these paths are directly present:

```text
app\portal.html
app\app.js
app\styles.css
api\src\functions\submitHealthDiagnostic.js
api\src\functions\getHealthDiagnosticStatus.js
VM_Health_Diagnostic_SINGLE_VM_COMPLETE_CODE_VIEW.json
```

Health remains single-VM. The existing API continues to enforce `MAX_HOSTNAMES = 1`.

Verify locally:

```powershell
Select-String -Path .\app\portal.html -Pattern "VM Health Diagnostic V2","Health Score is intentionally not used"
Select-String -Path .\app\app.js -Pattern "VM Health Diagnostic V2","N/A – VM not running"
Select-String -Path .\api\src\functions\submitHealthDiagnostic.js -Pattern "MAX_HOSTNAMES = 1"
```

## 3. Update the Health Logic App

Open your existing Health Logic App, for example:

`VM-HEALTH-DIAGNOSTIC-LA`

Go to **Development Tools → Logic app code view**.

Replace the Health Logic App definition with:

`VM_Health_Diagnostic_V2_USE_THIS_CODE_VIEW.json`

Before saving, set:

```json
"logAnalyticsWorkspaceId": {
  "value": "YOUR-WORKSPACE-ID-GUID"
}
```

Do not use the Workspace resource ID here. Use the workspace/customer ID GUID used by the Log Analytics Query API.

The additional V2 API parameters are already included:

```text
alertsManagementApiVersion = 2019-03-01
activityLogApiVersion      = 2015-04-01
networkApiVersion          = 2025-05-01
resourceHealthApiVersion   = 2025-05-01
computeApiVersion          = 2026-03-01
metricsApiVersion          = 2023-10-01
```

Save the Logic App.

## 4. Managed Identity

Health Logic App → **Identity** → System assigned → **On**.

Keep the same managed identity if you are upgrading the existing Health LA.

## 5. Update RBAC

Use:

`deployment/VM_Health_Diagnostic_Reader_Custom_Role.json`

Replace:

`<TARGET-SUBSCRIPTION-ID>`

with the target subscription ID before creating/updating the role.

V2 additionally needs read/diagnostic actions for:

```text
Microsoft.AlertsManagement/alerts/read
Microsoft.Insights/eventtypes/values/read
Microsoft.Network/networkInterfaces/effectiveRouteTable/action
Microsoft.Network/networkInterfaces/effectiveNetworkSecurityGroups/action
Microsoft.RecoveryServices/vaults/backupFabrics/protectionContainers/protectedItems/read
```

The network `action` operations above return effective configuration; they do not alter NSGs/routes.

Assign the custom role to the Health Logic App managed identity at every target subscription that contains VMs to diagnose.

## 6. Log Analytics permissions

On the configured Log Analytics workspace assign the Health Logic App managed identity:

**Log Analytics Data Reader**

This is required for `InsightsMetrics` memory, disk and heartbeat data.

If VM Insights/AMA is not configured, the portal will show `Unknown` instead of `0%`.

## 7. Health status Blob permissions

Keep your existing private Health status container, e.g.:

`vmhealthstatus`

Assign the Health Logic App managed identity:

**Storage Blob Data Contributor**

The Static Web App API still uses `HEALTH_STATUS_CONTAINER_SAS_URL` to read/write request status records.

## 8. Static Web App configuration

No new Static Web App setting is required for V2.

Keep:

```text
HEALTH_LOGIC_APP_CALLBACK_URL
HEALTH_STATUS_CONTAINER_SAS_URL
```

If you created a new Logic App instead of updating the existing one, replace `HEALTH_LOGIC_APP_CALLBACK_URL` with the new HTTP trigger URL.

## 9. Deploy through Git

```powershell
cd C:\script\APR-SNAP-BACKUP
git status
git add .
git commit -m "Upgrade VM Health Diagnostic to V2 read-only diagnostics"
git push origin main
```

Wait for the Azure Static Web Apps GitHub Action to succeed.

Then hard-refresh:

`Ctrl + F5`

## 10. First validation

Use one running VM with AMA/VM Insights configured.

Expected result sections:

```text
VM configuration & runtime
Performance
Storage & disk performance
Network & effective configuration
Azure alerts & recent changes
Resource Health history
VM extensions
Monitoring / AMA / DCR / Log Analytics
Backup & patching
Boot diagnostics
Recommendations
```

## 11. Validate a deallocated VM

For a deallocated VM, the portal should show:

```text
Power: VM deallocated
CPU: N/A – VM not running
Memory: N/A – VM not running
Lowest disk free: N/A – VM not running
```

It must **not** show `0.0%` for unavailable runtime telemetry.

## 12. Validate missing VM Insights

If AMA/DCR/VM Insights data is unavailable:

```text
Memory available: Unknown   (when VM is running)
Lowest disk free: Unknown
Monitoring: Unknown/Partial
```

The Findings section will explain which source is unavailable.

## 13. Validate Alerts and Activity Log

If the VM has a fired Azure Monitor alert, expand:

`Azure alerts & recent changes`

Verify the alert is displayed with severity, monitor service and start time.

Recent control-plane changes to the VM should appear from Activity Log for the last 24 hours.

## 14. Validate Effective Network Configuration

On a running VM, expand:

`Network & effective configuration`

Check the primary NIC, effective routes and effective NSGs.

If Azure cannot return effective configuration (for example due to RBAC/state/platform restrictions), the diagnostic remains usable and the missing source is reported as a warning.

## 15. Validate Backup Detail

For an Azure Backup-protected VM verify:

- Protection = Protected
- Vault
- Policy
- Last backup status
- Last backup timestamp
- Last recovery point

If Resource Graph does not expose a protected-item record in the identity's scope, the basic Backup Status result can still show protection, while detailed fields remain Unknown.

## 16. Export tests

Test:

- Copy for incident
- Download JSON
- Export CSV
- Open VM in Azure

These actions are client-side only and do not change Azure resources.

## Rollback

If required:

1. Restore the previous `app/portal.html`, `app/app.js`, and `app/styles.css`.
2. Restore the previous Health Logic App JSON.
3. Push the rollback commit.

The existing Health status blobs remain backward compatible because V2 only adds fields to each VM result record.
