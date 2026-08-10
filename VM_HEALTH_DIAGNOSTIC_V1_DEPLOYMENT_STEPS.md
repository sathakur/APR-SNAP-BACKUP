# VM Health Diagnostic V1 - Complete Deployment Steps

This package adds **VM Health Diagnostic** to the existing Azure VM Operations Portal without changing the existing Alert Suppression, VM Snapshot, or Ad Hoc VM Backup workflows.

## 1. What V1 does

V1 is diagnostic-only. It does not restart/deallocate a VM, run guest commands, resize disks, change networking, install patches, or alter Azure Backup configuration.

Maximum request size: **5 unique VM hostnames**. The Logic App processes VM diagnostics in parallel with concurrency **5** and collects the per-VM result blobs sequentially.

The portal reports:

1. VM discovery and configuration
2. Power state
3. Provisioning state
4. Azure Resource Health
5. Azure VM Agent state
6. VM extension health
7. Azure Monitor Percentage CPU
8. Guest available memory when VM Insights data exists
9. Guest logical-disk free space when VM Insights data exists
10. Attached Azure managed-disk configuration
11. NIC, private IP, VNet/subnet and NSG references
12. Azure Backup protection state, vault and policy
13. Latest Azure Update Manager patch assessment available in Resource Graph
14. AMA, DCR association and VM Insights/Log Analytics telemetry state
15. Consolidated Healthy / Warning / Critical findings in the portal

Missing optional telemetry is shown as **Unknown**. It is never silently treated as Healthy.

---

## 2. Files added by this release

### Portal/API

- `api/src/functions/submitHealthDiagnostic.js`
- `api/src/functions/getHealthDiagnosticStatus.js`
- `api/src/shared/healthStatusStore.js`
- updated `api/local.settings.example.json`
- updated `app/portal.html`
- updated `app/app.js`
- updated `app/styles.css`

### Azure deployment

- `deployment/LogicApp_VM_Health_Diagnostic_Parallel_Max5.json`
- `deployment/VM_Health_Diagnostic_Reader_Custom_Role.json`
- `deployment/VM_Health_Diagnostic_Status_Sample.json`

---

## 3. Architecture

```text
Authenticated user
      |
      v
Azure Static Web App
VM Health Diagnostic tab
      |
      v
POST /api/submitHealthDiagnostic
      |
      +--> create <requestId>.json in private health-status Blob container
      |
      v
VM Health Diagnostic Logic App
System-assigned managed identity
      |
      +--> Azure Resource Graph
      +--> Compute Instance View / Extensions
      +--> Azure Resource Health
      +--> Azure Monitor Metrics
      +--> DCR associations
      +--> Azure Backup protection-status lookup
      +--> Azure Update Manager data in Resource Graph
      +--> Log Analytics InsightsMetrics
      |
      +--> parallel per-VM result blobs, max concurrency 5
      |
      v
Final request status blob
      |
      v
GET /api/getHealthDiagnosticStatus?requestId=...
      |
      v
Portal result cards and findings
```

The requester identity comes from Azure Static Web Apps authentication. The browser does not choose the requester user ID stored with the health status document.

---

## 4. Create the health status Blob container

You can reuse the same Storage Account already used by Snapshot/Backup, but create a separate private container for clean separation.

Recommended container name:

`vmhealthstatus`

Azure portal steps:

1. Open the existing Storage Account.
2. Go to **Data storage > Containers**.
3. Select **+ Container**.
4. Name: `vmhealthstatus`.
5. Anonymous access level: **Private (no anonymous access)**.
6. Create.

The solution stores:

```text
vmhealthstatus/
  <requestId>.json
  health-parallel-results/
    <requestId>/
      <hostname>.json
```

Do not enable public Blob access.

---

## 5. Create a container SAS for the Static Web App API

The Static Web App API needs to create the initial status document and read it while the portal polls.

Generate a container SAS with only:

- Read
- Create
- Write

Recommended:

- HTTPS only
- short/managed expiry aligned with your secret-rotation process
- no Delete permission
- no List permission required by this code

Copy the complete container SAS URL. Example shape only:

`https://<storage>.blob.core.windows.net/vmhealthstatus?<SAS>`

Do not place this value in JavaScript or `portal.html`.

---

## 6. Create the VM Health Logic App

Create a separate Logic App rather than mixing this workflow into Snapshot or Backup.

Recommended name:

`VM-HEALTH-DIAGNOSTIC-LA`

1. Azure portal > **Create a resource > Logic App**.
2. Use the same region/resource-group standard as the existing operations solution.
3. Choose **Consumption** if that matches the existing Logic Apps.
4. Create it.
5. Open **Identity > System assigned**.
6. Set **Status = On** and Save.
7. Copy the Logic App managed-identity Object (principal) ID for RBAC work.

### Import the workflow

1. Open the Logic App.
2. Open **Development Tools > Logic app code view**.
3. Keep a copy of the original empty definition as rollback.
4. Open:

   `deployment/LogicApp_VM_Health_Diagnostic_Parallel_Max5.json`

5. Replace the code view with the supplied JSON.
6. Before Save, configure the Log Analytics Workspace ID described in the next section.
7. Save.

The supplied definition has:

- outer VM `Foreach` concurrency = **5**
- collector concurrency = **1**
- no shared result-array mutation inside the parallel VM loop
- per-VM temporary result blobs
- HTTP 202 acknowledgement before the longer health collection completes

---

## 7. Configure the Log Analytics Workspace ID

In the Logic App JSON, locate the top-level parameter:

```json
"logAnalyticsWorkspaceId": {
  "value": ""
}
```

Set it to the **Workspace ID GUID**, not the Azure ARM Resource ID.

Example:

```json
"logAnalyticsWorkspaceId": {
  "value": "11111111-2222-3333-4444-555555555555"
}
```

Find it in:

**Log Analytics workspace > Overview > Workspace ID**

If your VMs report VM Insights data to different workspaces, V1 should either be deployed once per workspace scope or enhanced later with a VM-to-workspace mapping. The supplied V1 uses one central Workspace ID.

If you intentionally leave this parameter blank, Azure-only checks still run, but the guest-memory/logical-disk query fails and those values are shown as Unknown/Warning.

---

## 8. Assign Azure RBAC to the Logic App managed identity

### 8.1 Target VM subscriptions

Use:

`deployment/VM_Health_Diagnostic_Reader_Custom_Role.json`

For each target subscription:

1. Replace `<TARGET-SUBSCRIPTION-ID>` in a copy of the role JSON.
2. Subscription > **Access control (IAM)** > **Add > Add custom role**.
3. Use the JSON definition.
4. Create the role.
5. Assign **VM Health Diagnostic Reader** to the **Logic App managed identity**.

Repeat/assign at every subscription that the portal is allowed to diagnose.

This custom role is read-only except for `Microsoft.RecoveryServices/Locations/backupStatus/action`, which is the Recovery Services status lookup used to determine whether a VM is protected. It does not include Backup Now, patch installation, VM Run Command, VM restart, disk write, or network write permissions.

**Simple UAT fallback:** if your Azure governance process does not accept the stricter custom role on the first attempt, assign the built-in **Reader** role to the Health Logic App MI at each target subscription, and also create/assign `deployment/VM_Health_Backup_Status_Only_Custom_Role.json`. This gives broad control-plane read visibility plus only the extra Recovery Services backup-status action; it still grants no VM/disk/network/patch/backup write operation. After UAT, you can return to the stricter custom role if required by security governance.

### 8.2 Log Analytics workspace

On the configured Log Analytics workspace:

1. **Access control (IAM)**.
2. **Add role assignment**.
3. Role: **Log Analytics Data Reader**.
4. Member: the VM Health Logic App managed identity.
5. Review + assign.

This is required for the Logs Query API to read `InsightsMetrics`.

### 8.3 Health status Storage container

On the Storage Account or preferably on the `vmhealthstatus` container scope:

1. **Access control (IAM)**.
2. Add role assignment.
3. Role: **Storage Blob Data Contributor**.
4. Member: the VM Health Logic App managed identity.
5. Review + assign.

The Logic App needs Blob data write/read to write processing/final status and per-VM temporary result documents.

Allow several minutes for Azure RBAC propagation before testing.

---

## 9. Get the Logic App callback URL

1. Open the Logic App Designer.
2. Select **When an HTTP request is received**.
3. Copy the generated HTTP POST URL after the workflow has been saved.
4. Treat this callback URL as a secret because it contains the trigger signature.

---

## 10. Add Static Web App application settings

Open the production Azure Static Web App and add:

```text
HEALTH_LOGIC_APP_CALLBACK_URL
HEALTH_STATUS_CONTAINER_SAS_URL
```

Values:

```text
HEALTH_LOGIC_APP_CALLBACK_URL = <VM Health Logic App HTTP POST URL>
HEALTH_STATUS_CONTAINER_SAS_URL = <vmhealthstatus container SAS URL>
```

Keep all existing settings. Do not remove or rename the existing APR, Snapshot or Backup variables.

The included `api/local.settings.example.json` shows the required variable names for local development.

---

## 11. Deploy the full portal package

Copy/extract the supplied package into the same Git repository used by the current portal.

Example PowerShell:

```powershell
cd "C:\script\APR-SNAP-BACKUP"

git status
git add .
git commit -m "Add read-only VM Health Diagnostic V1"
git push origin main
```

The included GitHub workflow still uses:

```yaml
app_location: "app"
api_location: "api"
output_location: ""
```

Wait for the Azure Static Web Apps deployment workflow to complete successfully.

---

## 12. First test - one VM

Use a normal assigned Entra portal user.

1. Open the portal.
2. Select **VM Health Diagnostic**.
3. Enter one known VM hostname.
4. Select **Last 1 hour**.
5. Select **Run VM health diagnostic**.
6. Confirm a Request ID appears.
7. The portal polls until the request reaches a terminal collection status.

Validate these sections:

- VM configuration & runtime
- Resource Health
- CPU average/max
- memory if InsightsMetrics is available
- guest logical disks if InsightsMetrics is available
- Azure managed disks
- NIC/VNet/subnet/NSG references
- VM extensions
- AMA / DCR / Log Analytics
- Azure Backup protection
- Update Manager patch assessment
- consolidated findings

---

## 13. Parallel test - five VMs

Submit five known hostnames in one request.

Expected:

- one Request ID
- maximum five concurrent VM branches
- one temporary result Blob per hostname
- sequential collector after all VM branches finish
- one final status document
- one portal card per VM

Do not change the collector concurrency to greater than 1 while it appends to the shared `HealthResults` array.

---

## 14. Expected collection statuses

### Completed

All configured data-source calls succeeded for all discovered VMs.

### PartiallyCompleted

At least one VM was discovered and returned a result, but one or more optional/read-only data sources were unavailable or another VM failed discovery/collection.

### Failed

No requested VM produced a successful/partial health result, or request validation failed.

These are **collection statuses**. A successfully collected VM can still be shown as **Critical** by the portal health rules (for example, very low disk free space).

---

## 15. Portal health-rule thresholds

These are portal operational rules, not Microsoft service-health definitions:

- CPU average >= 90%: Critical
- CPU average >= 80%, or max >= 90%: Warning
- available memory < 10%: Critical
- available memory < 20%: Warning
- logical-disk free < 10%: Critical
- logical-disk free < 20%: Warning
- VM not running: Critical
- provisioning not succeeded: Critical
- Resource Health Unavailable: Critical
- Resource Health Degraded/Unknown: Warning
- failed VM extensions: Warning
- Azure Backup state other than Protected: Warning
- pending Critical/Security patches: Warning
- pending reboot from patch assessment: Warning
- AMA not detected: Warning
- no DCR association: Warning
- VM Insights guest telemetry not returned: Warning / values remain Unknown

Adjust thresholds in `app/app.js` only after agreeing your operational standard.

---

## 16. Troubleshooting

### Portal says Logic App is not connected

Check Static Web App setting:

`HEALTH_LOGIC_APP_CALLBACK_URL`

Restart/redeploy the Static Web App if your environment requires it after settings changes.

### Portal says health status store is unavailable

Check:

`HEALTH_STATUS_CONTAINER_SAS_URL`

The SAS needs Read + Create + Write and must not be expired.

### Logic App Write_Processing_Status / Write_VM_Health_Result returns 403

Assign **Storage Blob Data Contributor** to the Logic App managed identity on the health status container/storage account.

### Query_VM_Resource_Graph returns 403 / no data

Verify the Logic App managed identity has the supplied health reader role on every target subscription. Resource Graph only returns resources the identity is authorized to read.

### Get_Instance_View returns 403

Verify:

`Microsoft.Compute/virtualMachines/instanceView/read`

### Get_Resource_Health returns 403

Verify the Resource Health read/current-read permissions in the custom role.

### Get_Backup_Protection_Status returns 403

Verify:

`Microsoft.RecoveryServices/Locations/backupStatus/action`

at the target subscription scope.

### Query_Guest_Metrics returns 403

Verify **Log Analytics Data Reader** is assigned to the Logic App managed identity at the configured workspace.

### Query_Guest_Metrics returns 200 but no rows

Check:

- VM is sending VM Insights data
- `InsightsMetrics` exists in that workspace
- Workspace ID is correct
- VM computer name matches the collected `Computer` field
- selected time range contains data

V1 intentionally reports guest memory/disk as Unknown when no rows are returned.

### Patch assessment is Unknown

The supplied V1 reads the latest Update Manager assessment already present in Azure Resource Graph. It does **not** trigger an assessment. If no recent assessment exists, the portal reports Unknown rather than making a VM change.

### More than one VM matched a hostname

Use a unique Azure VM name or OS hostname. The workflow intentionally fails ambiguous discovery rather than diagnosing the wrong VM.

---

## 17. Security controls retained

- Microsoft Entra authentication remains unchanged.
- Existing Enterprise Application `Assignment required = Yes` remains the portal-access control.
- Health status API verifies that the authenticated Entra user owns the Request ID before returning the status document.
- The browser never receives the health container SAS URL.
- The Logic App uses managed identity for Azure ARM, Storage, Resource Health, Metrics, Backup and Log Analytics calls.
- No VM Run Command is used in V1.
- No VM Power Operations are included.

---

## 18. Rollback

If Health Diagnostic must be removed:

1. Revert the portal Git commit for this release.
2. Remove `HEALTH_LOGIC_APP_CALLBACK_URL` and `HEALTH_STATUS_CONTAINER_SAS_URL` from Static Web App settings.
3. Disable/delete only the dedicated Health Logic App if approved.
4. Remove its dedicated role assignments.
5. Leave APR, Snapshot and Backup Logic Apps/settings untouched.

