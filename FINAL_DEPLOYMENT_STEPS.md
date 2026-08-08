# Azure VM Operations Portal — Deployment Update

This release keeps the existing APR Alert Suppression implementation unchanged.

## Changes

1. Portal title: `Azure VM Operations Portal`
2. Subtitle: authenticated self-service for Azure VM alert suppression and managed-disk snapshot requests
3. Snapshot requests: maximum **5 unique VMs per request**
4. Per authenticated user: maximum **3 snapshot requests in any rolling 24-hour period**
5. Existing snapshot retention remains: 1, 3, 7, or 14 days
6. Existing snapshot status Storage Account/container remains in use

## Rate-limit storage

No new Azure resource is required.

The Static Web App API uses the existing:

`SNAPSHOT_STATUS_CONTAINER_SAS_URL`

to keep a small per-user quota document under:

`request-limits/<SHA256-user-id>.json`

The user's Entra user ID is hashed before being used in the blob name.

The same container SAS must continue to have:

- Read
- Create
- Write

No List permission is required.

The quota is a rolling 24-hour window, not a calendar-day reset.

## Deploy the portal

Extract the complete package directly into:

`C:\script\APR-SNAPHOT`

Then run:

```powershell
cd "C:\script\APR-SNAPHOT"

git add .
git commit -m "Add VM snapshot request limits and update portal title"
git push origin main
```

## Static Web App workflow

Keep:

`.github\workflows\azure-static-web-apps-zealous-grass-03c5f4003.yml`

and confirm:

```yaml
app_location: "app"
api_location: "api"
output_location: ""
skip_app_build: true
```

## Static Web App Production variables

Keep:

- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `LOGIC_APP_CALLBACK_URL`
- `SNAPSHOT_LOGIC_APP_CALLBACK_URL`
- `SNAPSHOT_STATUS_CONTAINER_SAS_URL`

No new environment variable is needed for the rate limit.

## Snapshot Logic App

Update the Snapshot Logic App with:

`deployment/LogicApp_VM_Snapshot_Final.json`

The workflow parameter `maximumHostnames` is now 5.

The existing APR Logic App must not be replaced.

## Expected behavior

Snapshot VM input:

- 1 to 5 unique VM hostnames accepted
- 6 or more rejected before the Logic App is called

Per-user request quota:

- Request 1 within 24h: accepted
- Request 2 within 24h: accepted
- Request 3 within 24h: accepted
- Request 4 within 24h: HTTP 429 and portal shows `Snapshot request limit reached`
- The next request becomes available 24 hours after the oldest request in the active window

APR behavior remains unchanged:

- Existing APR limit remains 20 VMs
- Existing APR Logic App and permissions remain unchanged
