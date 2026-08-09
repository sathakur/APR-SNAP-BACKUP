# Login Screen + Microsoft Entra ID Deployment Steps

## What changed

The existing Azure VM Operations Portal is preserved as `app/portal.html`.

A new public landing page is now `app/index.html`. The landing page contains a **Sign in with Microsoft** button. It does not collect a username or password itself. When selected, Azure Static Web Apps redirects the user to Microsoft Entra ID, where Microsoft handles username/password, MFA, Conditional Access, and SSO.

After successful authentication, the user is redirected to `/portal.html`.

## Files involved

- `app/index.html` — new branded sign-in landing page
- `app/portal.html` — existing portal, unchanged visually
- `app/staticwebapp.config.json` — keeps landing page public and protects portal/API routes
- `app/app.js` — existing business logic; only authentication redirect targets now return to `/portal.html`
- `app/signed-out.html` — returns the user to the branded sign-in page
- `app/unauthorized.html` — retained for authenticated users without permission

## Deployment

1. Copy the complete package into the existing Git repository.
2. Do not change the existing `api`, `deployment`, or Logic App files.
3. Confirm the GitHub Actions workflow still uses:
   - `app_location: "app"`
   - `api_location: "api"`
4. Commit and push the changes to the branch used by Azure Static Web Apps.
5. Wait for the Static Web Apps GitHub Actions deployment to complete successfully.

## Azure Static Web Apps settings

Your existing custom Microsoft Entra registration uses these application settings:

- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`

Leave these values as they are if authentication is already working.

Because the current `staticwebapp.config.json` contains a custom Entra registration, the Static Web App must use a plan that supports custom authentication.

## Entra App Registration verification

In Microsoft Entra ID > App registrations > your portal application > Authentication, verify the Static Web Apps callback URL exists:

`https://<YOUR_STATIC_WEB_APP_DOMAIN>/.auth/login/aad/callback`

For the current Azure Static Web Apps hostname, use the same hostname already configured for the working portal.

Do not add `/portal.html` as an Entra callback URL. `/portal.html` is the post-login page inside Static Web Apps; the authentication callback remains the `/.auth/login/aad/callback` endpoint.

## Test procedure

1. Open the root portal URL in an InPrivate/Incognito window.
2. Confirm the branded **Sign in to your account** page appears.
3. Select **Sign in with Microsoft**.
4. Enter the corporate Microsoft account credentials on the Microsoft page.
5. Complete MFA if requested.
6. Confirm the browser returns to `/portal.html`.
7. Confirm the existing portal appears with:
   - Authenticated requester name
   - Identity verified
   - Alert Suppression tab
   - VM Snapshot tab
   - On-Demand VM Backup tab
8. Test one existing pre-check or request flow to confirm APIs still respond.
9. Select **Sign out** and confirm the existing signed-out page appears.
10. Select **Return to sign in** and confirm it returns to the branded landing page.

## Security behavior

- The custom landing page never receives or stores the user's Microsoft password.
- `/portal.html` requires the built-in `authenticated` role.
- `/api/*` requires the built-in `authenticated` role.
- Anonymous users can access only the sign-in landing page and the signed-out / unauthorized helper pages.
- The user identity continues to be obtained through `/.auth/me` in the existing portal code.
