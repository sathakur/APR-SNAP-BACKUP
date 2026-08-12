# Azure VM Operations Portal — VM Health Diagnostic V2

This is the clean repository-root package for the existing Azure VM Operations Portal.

## Health V2 design
- One VM per Health Diagnostic request.
- One Health Diagnostic Logic App.
- Read-only diagnostics; no reboot, service restart, disk/network modification, or patch installation.
- No Health Score.
- Missing guest telemetry is displayed as **Unknown**; a stopped/deallocated VM uses **N/A – VM not running** for runtime metrics.

## Main V2 capabilities
- VM discovery/configuration, power/provisioning state and VM Agent.
- Current Resource Health plus Resource Health history.
- Azure Monitor platform metrics (CPU, network and disk metrics where available).
- VM Insights / InsightsMetrics guest memory, logical-disk free space and heartbeat when configured.
- Managed disks, NIC/VNet/subnet/NSG and effective route/effective NSG information.
- Active Azure alerts and recent Azure Activity Log changes.
- VM extensions, AMA and DCR associations.
- Azure Backup protection/details.
- Update Manager patch-assessment details.
- Boot diagnostics configuration.
- Consolidated findings/recommendations plus copy/export helpers in the portal.

## Logic App Code View file
Use exactly:

`VM_Health_Diagnostic_V2_COMPLETE_CODE_VIEW.json`

Paste the entire file into the existing/new VM Health Diagnostic Logic App Code View.

Before saving, set the `logAnalyticsWorkspaceId` parameter to the Workspace/Customer ID GUID used for the VM Insights query.

## Portal deployment
Copy the package contents directly into the Git repository root so that the final paths are:

- `app/portal.html`
- `app/app.js`
- `app/styles.css`
- `api/src/functions/submitHealthDiagnostic.js`
- `api/src/functions/getHealthDiagnosticStatus.js`
- `api/src/shared/healthStatusStore.js`

Do not create an extra outer folder inside the repository.

Then run:

```powershell
cd C:\script\APR-SNAP-BACKUP
git status
git add .
git commit -m "Upgrade VM Health Diagnostic to V2"
git push origin main
```

Wait for the Azure Static Web Apps GitHub Action to complete, then hard refresh the portal (`Ctrl+F5`).

## Static Web App settings
Keep/configure:

- `HEALTH_LOGIC_APP_CALLBACK_URL`
- `HEALTH_STATUS_CONTAINER_SAS_URL`

## Managed identity access
The Health Logic App system-assigned managed identity needs the read/diagnostic permissions defined in:

`deployment/VM_Health_Diagnostic_Reader_Custom_Role.json`

It also needs:
- Log Analytics data query access on the configured workspace.
- Storage Blob Data Contributor on the Health status container used by the Logic App.

## Validation commands
```powershell
Select-String -Path .\app\portal.html -Pattern "VM Health Diagnostic V2","Health Score is intentionally not used"
Select-String -Path .\app\app.js -Pattern "N/A – VM not running","resourceHealthHistory","activeAlerts"
Select-String -Path .\api\src\functions\submitHealthDiagnostic.js -Pattern "MAX_HOSTNAMES = 1"
```
