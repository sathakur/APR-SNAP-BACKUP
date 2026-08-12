# Portal Change - VM Health Diagnostic Restricted to One VM

## Changed files

- `app/portal.html`
  - Health hostname input is a single-line field.
  - Label is singular: VM hostname.
  - Helper text and 0/1 counter reflect the one-VM limit.
  - Execution mode shows Read-only - Single VM.

- `app/app.js`
  - `HEALTH_MAX_HOSTNAMES = 1`.
  - Browser validation requires exactly one VM hostname.
  - Existing Snapshot and Backup constants remain unchanged.

- `api/src/functions/submitHealthDiagnostic.js`
  - `MAX_HOSTNAMES = 1`.
  - API rejects any request other than exactly one unique hostname.

- `deployment/LogicApp_VM_Health_Diagnostic_Single_VM.json`
  - trigger `minItems = 1`, `maxItems = 1`.
  - `maximumHostnames = 1`.
  - hostname loop concurrency = 1.

No changes were made to Alert Suppression, Snapshot, Backup history, Snapshot history, or Entra login behavior.

## Deploy only portal/API changes

If your Health Logic App is already using the single-VM JSON, deploy only:

```text
app/portal.html
app/app.js
app/styles.css
api/src/functions/submitHealthDiagnostic.js
api/src/functions/getHealthDiagnosticStatus.js
api/src/shared/healthStatusStore.js
```

Then commit/push to the Static Web App repository.

## Deploy the complete package

If you want the whole known-good project tree, replace the repository content with this package, preserve the production application-setting values in Azure, then commit/push.
