# VM Health Diagnostic V1 - Single VM - Complete Deployment Steps

## 1. Final scope

VM Health Diagnostic V1 is read-only and accepts exactly **one VM hostname per request**.

Existing modules are not changed:

- Alert Suppression: unchanged
- VM Snapshot: unchanged
- On-Demand VM Backup: unchanged

Health Diagnostic V1 checks VM discovery/configuration, power/provisioning state, Resource Health, VM Agent/extensions, CPU, optional VM Insights memory and logical-disk telemetry, managed disks, NIC/VNet/subnet/NSG references, Backup protection, Update Manager assessment data, AMA/DCR/Log Analytics state, and consolidated findings.

## 2. Architecture

```text
Authenticated Entra user
        |
        v
Azure Static Web App
VM Health Diagnostic tab
        |
        v
POST /api/submitHealthDiagnostic
        |
        +--> create <requestId>.json in private health status container
        |
        v
VM-HEALTH-DIAGNOSTIC-LA
System-assigned managed identity
        |
        +--> Azure Resource Graph
        +--> Compute Instance View / Extensions
        +--> Azure Resource Health
        +--> Azure Monitor Metrics
        +--> DCR associations
        +--> Azure Backup protection-status lookup
        +--> Update Manager data in Resource Graph
        +--> Log Analytics InsightsMetrics
        |
        +--> one per-VM result record
        |
        v
Final request status blob
        |
        v
GET /api/getHealthDiagnosticStatus?requestId=...
        |
        v
Portal Health result
```

There is only **one Health Logic App** and only **one VM is processed per Health request**.

## 3. Create the health status Blob container

You may reuse the Storage Account already used by Snapshot/Backup, but use a separate private container.

Recommended name: `vmhealthstatus`

Azure portal:
1. Storage Account > Data storage > Containers.
2. + Container.
3. Name: `vmhealthstatus`.
4. Anonymous access: Private.
5. Create.

## 4. Generate a SAS URL for the Static Web App API

The Static Web App API needs to create/read the request status document. Generate a **container SAS** with:

- Read
- Create
- Write
- HTTPS only

Do not put the SAS URL into browser JavaScript or HTML.

## 5. Create the Health Logic App

Recommended name: `VM-HEALTH-DIAGNOSTIC-LA`

1. Create a Logic App Consumption workflow using your normal portal resource-group/region standard.
2. Logic App > Identity > System assigned > On > Save.
3. Open Development Tools > Logic app code view.
4. Paste the complete content of `VM_Health_Diagnostic_SINGLE_VM_COMPLETE_CODE_VIEW.json`.
5. Configure the Log Analytics Workspace ID as described below.
6. Save.

The supplied single-VM definition enforces:

```text
Trigger hostnames minItems = 1
Trigger hostnames maxItems = 1
maximumHostnames = 1
For_Each_Hostname concurrency = 1
Collector concurrency = 1
```

## 6. Configure Log Analytics Workspace ID

In Logic App Code view find:

```json
"logAnalyticsWorkspaceId": {
  "value": ""
}
```

Set the **Workspace ID GUID** from Log Analytics workspace > Overview > Workspace ID.

Example:

```json
"logAnalyticsWorkspaceId": {
  "value": "11111111-2222-3333-4444-555555555555"
}
```

Do not paste the ARM Resource ID here.

## 7. Assign RBAC to the Health Logic App managed identity

### Target VM subscriptions

Use `deployment/VM_Health_Diagnostic_Reader_Custom_Role.json`, adjusted for your target subscription scope, and assign it to the Logic App managed identity.

For UAT, if your governance team prefers built-in Reader, you can assign **Reader** at the target subscription plus the included narrow Backup Status custom role.

### Log Analytics workspace

Assign **Log Analytics Data Reader** to the Health Logic App managed identity on the configured workspace.

### Health status Blob container

Assign **Storage Blob Data Contributor** to the Health Logic App managed identity on the `vmhealthstatus` container.

Wait for RBAC propagation before testing.

## 8. Get the Health Logic App HTTP callback URL

1. Open the `When an HTTP request is received` trigger.
2. Copy its HTTP POST URL after the workflow has been saved.
3. Treat the URL as a secret.

## 9. Configure Static Web App application settings

Static Web App > Configuration > Application settings:

```text
HEALTH_LOGIC_APP_CALLBACK_URL=<Health Logic App HTTP POST URL>
HEALTH_STATUS_CONTAINER_SAS_URL=<vmhealthstatus container SAS URL>
```

Keep all existing Alert Suppression, Snapshot, Backup and Entra settings.

## 10. Deploy the portal code

Replace/copy the package into the Git repository backing your Static Web App.

Example PowerShell:

```powershell
cd C:\script\APR-SNAP-BACKUP
git status
git add .
git commit -m "Restrict VM Health Diagnostic to one VM per request"
git push origin main
```

The repository continues to use `app` as the Static Web App application location and `api` as the API location.

## 11. Portal behavior after deployment

The Health tab displays:

```text
VM hostname *
[ WINDEV001 ]

Enter one Azure VM hostname. VM Health Diagnostic runs against one VM per request.  1 / 1

Performance period
[ Last 1 hour ]

Execution mode
Read-only - Single VM
```

The existing Snapshot and Backup tabs still accept their existing maximum of 5 VMs.

## 12. Test order

### Test A - authentication
Open the portal with an assigned Entra user. Confirm the Health tab is visible.

### Test B - valid single VM
Enter one valid VM hostname and submit. Expected: HTTP 202/Accepted and a Request ID.

### Test C - invalid multiple VM bypass test
Call `/api/submitHealthDiagnostic` manually with two hostnames. Expected: HTTP 400 because the API accepts exactly one unique VM.

### Test D - status Blob
Confirm `<requestId>.json` is created in `vmhealthstatus`.

### Test E - Logic App run
Logic App Runs history should show one hostname iteration and final status write.

### Test F - optional telemetry
If VM Insights data is unavailable, memory/logical-disk values should show Unknown, not Healthy.

## 13. Troubleshooting

### Portal says Logic App rejected request
Open Logic App > Runs history. If there is no run, verify `HEALTH_LOGIC_APP_CALLBACK_URL`. If there is a failed run, open the first failed action and inspect status/body.

### Blob write returns 403
Confirm the Logic App managed identity has `Storage Blob Data Contributor` on `vmhealthstatus`.

### Health API cannot create/read status
Confirm `HEALTH_STATUS_CONTAINER_SAS_URL` is a container SAS URL with Read/Create/Write permissions and is not expired.

### Memory or logical disk is Unknown
Confirm VM Insights/AMA/DCR/Log Analytics ingestion and that the Logic App identity has Log Analytics Data Reader.
