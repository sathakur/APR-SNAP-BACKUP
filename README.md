# Azure VM Operations Portal - Single-VM Health Diagnostic Final

This package contains the complete authenticated Azure VM Operations Portal source code.

Portal modules:

- Alert Suppression - existing behavior unchanged
- VM Snapshot - existing behavior unchanged; maximum 5 VMs per request
- On-Demand VM Backup - existing behavior unchanged; maximum 5 VMs per request
- VM Health Diagnostic V1 - read-only and restricted to exactly 1 VM per request

## VM Health Diagnostic V1

The Health Diagnostic tab uses a single-line VM hostname field. The single-VM restriction is enforced in all three layers:

1. Browser: `HEALTH_MAX_HOSTNAMES = 1` and the UI accepts a single hostname.
2. Static Web App API: `submitHealthDiagnostic.js` rejects any request that does not contain exactly one unique hostname.
3. Logic App: the HTTP trigger schema sets `minItems: 1` and `maxItems: 1`; `maximumHostnames` is 1 and the VM loop concurrency is 1.

The module remains diagnostic-only. It does not reboot/deallocate VMs, execute guest Run Command, resize disks, modify networking, install patches, or alter Azure Backup configuration.

### Health checks

- VM discovery/configuration
- Power state
- Provisioning state
- Azure Resource Health
- VM Agent state
- VM extension health
- CPU metrics
- VM Insights available-memory telemetry when present
- VM Insights logical-disk free-space telemetry when present
- Azure managed disks
- NIC/private IP/VNet/subnet/NSG references
- Azure Backup protection status
- latest Update Manager assessment available through Resource Graph
- AMA/DCR/Log Analytics telemetry state
- consolidated Healthy/Warning/Critical findings

Missing optional guest telemetry is shown as `Unknown`, not Healthy.

## Main files

Portal:
- `app/portal.html`
- `app/app.js`
- `app/styles.css`
- `app/staticwebapp.config.json`

Health API:
- `api/src/functions/submitHealthDiagnostic.js`
- `api/src/functions/getHealthDiagnosticStatus.js`
- `api/src/shared/healthStatusStore.js`

Health Logic App:
- `VM_Health_Diagnostic_SINGLE_VM_COMPLETE_CODE_VIEW.json` - easiest file to paste directly in Logic App Code view
- `deployment/LogicApp_VM_Health_Diagnostic_Single_VM.json` - same workflow kept under deployment

RBAC/deployment:
- `deployment/VM_Health_Diagnostic_Reader_Custom_Role.json`
- `deployment/VM_Health_Backup_Status_Only_Custom_Role.json`
- `VM_HEALTH_DIAGNOSTIC_V1_DEPLOYMENT_STEPS.md`
- `VM_HEALTH_SINGLE_VM_PORTAL_DEPLOYMENT.md`
