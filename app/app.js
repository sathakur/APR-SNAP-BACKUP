const MAX_HOSTNAMES = 20;
const SNAPSHOT_MAX_HOSTNAMES = 5;
const FIXED_TIME_ZONE = "W. Europe Standard Time";
const IANA_TIME_ZONE = "Europe/Amsterdam";
const MINIMUM_LEAD_MINUTES = 45;
const MAXIMUM_DURATION_HOURS = 24;
const IDLE_TIMEOUT_MINUTES = 60;
const IDLE_ACTIVITY_THROTTLE_MS = 30000;
const LAST_ACTIVITY_STORAGE_KEY =
  "alertSuppressionLastActivityUtc";

const form = document.getElementById("suppressionForm");
const hostnamesInput = document.getElementById("hostnames");
const hostnameCount = document.getElementById("hostnameCount");
const validationMessage = document.getElementById("validationMessage");
const submitButton = document.getElementById("submitButton");
const clearButton = document.getElementById("clearButton");
const resultArea = document.getElementById("resultArea");
const authenticatedUserName = document.getElementById("authenticatedUserName");
const authenticatedProvider = document.getElementById("authenticatedProvider");
const identityStatus = document.getElementById("identityStatus");

const suppressionTabButton =
  document.getElementById("suppressionTabButton");
const snapshotTabButton =
  document.getElementById("snapshotTabButton");
const suppressionPanel =
  document.getElementById("suppressionPanel");
const snapshotPanel =
  document.getElementById("snapshotPanel");

const snapshotForm = document.getElementById("snapshotForm");
const snapshotHostnamesInput =
  document.getElementById("snapshotHostnames");
const snapshotHostnameCount =
  document.getElementById("snapshotHostnameCount");
const snapshotValidationMessage =
  document.getElementById("snapshotValidationMessage");
const snapshotSubmitButton =
  document.getElementById("snapshotSubmitButton");
const snapshotClearButton =
  document.getElementById("snapshotClearButton");
const snapshotResultArea =
  document.getElementById("snapshotResultArea");
const snapshotRetentionDays =
  document.getElementById("snapshotRetentionDays");
const snapshotExpiryDate =
  document.getElementById("snapshotExpiryDate");

const backupTabButton =
  document.getElementById("backupTabButton");
const backupPanel =
  document.getElementById("backupPanel");
const backupForm =
  document.getElementById("backupForm");
const backupHostnamesInput =
  document.getElementById("backupHostnames");
const backupHostnameCount =
  document.getElementById("backupHostnameCount");
const backupCheckButton =
  document.getElementById("backupCheckButton");
const backupPrecheckArea =
  document.getElementById("backupPrecheckArea");
const backupActionFields =
  document.getElementById("backupActionFields");
const backupValidationMessage =
  document.getElementById("backupValidationMessage");
const backupSubmitButton =
  document.getElementById("backupSubmitButton");
const backupClearButton =
  document.getElementById("backupClearButton");
const backupResultArea =
  document.getElementById("backupResultArea");
const backupHistoryRefreshButton =
  document.getElementById("backupHistoryRefreshButton");
const backupHistoryMessage =
  document.getElementById("backupHistoryMessage");
const backupHistoryTableArea =
  document.getElementById("backupHistoryTableArea");

const SNAPSHOT_STATUS_POLL_INTERVAL_MS = 5000;
const SNAPSHOT_STATUS_MAX_POLLS = 360;

let snapshotStatusPollTimer = null;
let snapshotStatusPollCount = 0;
let currentSnapshotRequestId = null;

const BACKUP_MAX_HOSTNAMES = 5;
const BACKUP_STATUS_POLL_INTERVAL_MS = 10000;
const BACKUP_STATUS_MAX_POLLS = 2160;

let backupStatusPollTimer = null;
let backupStatusPollCount = 0;
let currentBackupRequestId = null;
let backupPrecheckFingerprint = "";
let backupPrecheckPassed = false;

let authenticatedPrincipal = null;


let idleLogoutTimer = null;
let idleCheckInterval = null;
let lastActivityWrittenAt = 0;
let logoutStarted = false;

function getSignedOutUrl(reason) {
  const url = new URL("/signed-out.html", window.location.origin);
  url.searchParams.set("reason", reason);
  return `${url.pathname}${url.search}`;
}

function logoutUser(reason = "manual") {
  if (logoutStarted) return;

  logoutStarted = true;
  clearTimeout(idleLogoutTimer);
  clearInterval(idleCheckInterval);

  try {
    localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
  } catch {
    // Continue with logout when browser storage is unavailable.
  }

  const redirectUrl = encodeURIComponent(
    getSignedOutUrl(reason)
  );

  window.location.replace(
    `/.auth/logout?post_logout_redirect_uri=${redirectUrl}`
  );
}

function readStoredLastActivity() {
  try {
    const rawValue = localStorage.getItem(
      LAST_ACTIVITY_STORAGE_KEY
    );

    if (!rawValue) return null;

    const storedValue = Number(rawValue);

    return Number.isFinite(storedValue) && storedValue > 0
      ? storedValue
      : null;
  } catch {
    return null;
  }
}

function writeLastActivity(timestamp) {
  try {
    localStorage.setItem(
      LAST_ACTIVITY_STORAGE_KEY,
      String(timestamp)
    );
  } catch {
    // The current-tab timer still works without localStorage.
  }

  lastActivityWrittenAt = timestamp;
}

function getIdleMilliseconds() {
  const lastActivity =
    readStoredLastActivity() ?? lastActivityWrittenAt;

  if (!lastActivity) return 0;

  return Date.now() - lastActivity;
}

function hasIdleSessionExpired() {
  return (
    getIdleMilliseconds() >=
    IDLE_TIMEOUT_MINUTES * 60 * 1000
  );
}

function checkIdleTimeout() {
  if (logoutStarted) return true;

  if (hasIdleSessionExpired()) {
    logoutUser("idle");
    return true;
  }

  return false;
}

function scheduleIdleLogout() {
  clearTimeout(idleLogoutTimer);

  const lastActivity =
    readStoredLastActivity() ?? lastActivityWrittenAt;

  if (!lastActivity) return;

  const remainingMilliseconds =
    IDLE_TIMEOUT_MINUTES * 60 * 1000 -
    (Date.now() - lastActivity);

  if (remainingMilliseconds <= 0) {
    logoutUser("idle");
    return;
  }

  idleLogoutTimer = window.setTimeout(
    () => checkIdleTimeout(),
    remainingMilliseconds
  );
}

function recordUserActivity() {
  if (logoutStarted) return;

  // Do not allow a focus, click, or key press to revive an already
  // expired session. Check expiry before updating the timestamp.
  if (checkIdleTimeout()) return;

  const now = Date.now();

  if (
    now - lastActivityWrittenAt >=
    IDLE_ACTIVITY_THROTTLE_MS
  ) {
    writeLastActivity(now);
  }

  scheduleIdleLogout();
}

function startIdleLogoutMonitoring() {
  const storedLastActivity = readStoredLastActivity();

  if (storedLastActivity) {
    lastActivityWrittenAt = storedLastActivity;

    if (checkIdleTimeout()) return;
  } else {
    writeLastActivity(Date.now());
  }

  const activityEvents = [
    "pointerdown",
    "keydown",
    "wheel",
    "scroll",
    "touchstart"
  ];

  for (const eventName of activityEvents) {
    window.addEventListener(
      eventName,
      recordUserActivity,
      { passive: true }
    );
  }

  // Focus or returning to a hidden tab must first verify that the
  // previous session has not already expired. It must not reset the
  // timer before that check.
  window.addEventListener("focus", () => {
    if (!checkIdleTimeout()) {
      scheduleIdleLogout();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      !checkIdleTimeout()
    ) {
      scheduleIdleLogout();
    }
  });

  window.addEventListener("pageshow", () => {
    if (!checkIdleTimeout()) {
      scheduleIdleLogout();
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === LAST_ACTIVITY_STORAGE_KEY) {
      const updatedActivity = readStoredLastActivity();

      if (updatedActivity) {
        lastActivityWrittenAt = updatedActivity;
      }

      if (!checkIdleTimeout()) {
        scheduleIdleLogout();
      }
    }
  });

  // Browser timers can be delayed while a tab is hidden or a device
  // sleeps. A wall-clock check makes logout reliable when execution resumes.
  idleCheckInterval = window.setInterval(
    () => checkIdleTimeout(),
    30000
  );

  scheduleIdleLogout();
}


function activateOperationTab(tabName) {
  const tabMap = {
    suppression: {
      button: suppressionTabButton,
      panel: suppressionPanel
    },
    snapshot: {
      button: snapshotTabButton,
      panel: snapshotPanel
    },
    backup: {
      button: backupTabButton,
      panel: backupPanel
    }
  };

  const selected =
    tabMap[tabName]
      ? tabName
      : "suppression";

  for (
    const [name, config]
    of Object.entries(tabMap)
  ) {
    const isActive =
      name === selected;

    config.panel.hidden =
      !isActive;

    config.button
      .classList
      .toggle(
        "active",
        isActive
      );

    config.button
      .setAttribute(
        "aria-selected",
        String(isActive)
      );
  }

  history.replaceState(
    null,
    "",
    `#${selected}`
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseHostnames(rawValue) {
  const values = rawValue
    .split(/[\n,;]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.toUpperCase());

  return [...new Set(values)];
}

function getCentralEuropeanParts(date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: IANA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function getCentralEuropeanOffsetMilliseconds(date) {
  const parts = getCentralEuropeanParts(date);

  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return representedAsUtc - date.getTime();
}

function parseCentralEuropeanDateTime(value) {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) return null;

  const [, year, month, day, hour, minute, second = "0"] = match;

  const expected = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second)
  };

  const localFieldsAsUtc = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
    expected.second
  );

  let utcMilliseconds = localFieldsAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offset = getCentralEuropeanOffsetMilliseconds(
      new Date(utcMilliseconds)
    );

    const adjusted = localFieldsAsUtc - offset;

    if (Math.abs(adjusted - utcMilliseconds) < 1000) {
      utcMilliseconds = adjusted;
      break;
    }

    utcMilliseconds = adjusted;
  }

  const actual = getCentralEuropeanParts(
    new Date(utcMilliseconds)
  );

  const isValid =
    actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hour === expected.hour &&
    actual.minute === expected.minute &&
    actual.second === expected.second;

  return isValid ? utcMilliseconds : null;
}

function updateHostnameCount() {
  const count = parseHostnames(hostnamesInput.value).length;

  hostnameCount.textContent = `${count} / ${MAX_HOSTNAMES}`;
  hostnameCount.classList.toggle("over-limit", count > MAX_HOSTNAMES);
}

function getClaim(principal, claimTypes) {
  if (!Array.isArray(principal?.claims)) return "";

  const accepted = new Set(
    claimTypes.map((claimType) => claimType.toLowerCase())
  );

  const claim = principal.claims.find((item) =>
    accepted.has(String(item?.typ || "").toLowerCase())
  );

  return String(claim?.val || "").trim();
}

async function loadAuthenticatedUser() {
  const response = await fetch("/.auth/me", {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      `Unable to read authenticated identity (HTTP ${response.status}).`
    );
  }

  const payload = await response.json();
  const principal = payload?.clientPrincipal;

  if (
    !principal ||
    !Array.isArray(principal.userRoles) ||
    !principal.userRoles.includes("authenticated")
  ) {
    window.location.assign(
      "/.auth/login/aad?post_login_redirect_uri=/"
    );
    return;
  }

  const nameFromClaim = getClaim(principal, [
    "name",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
  ]);

  const displayName =
    nameFromClaim ||
    String(principal.userDetails || "").trim() ||
    "Authenticated user";

  authenticatedPrincipal = principal;
  authenticatedUserName.textContent = displayName;
  authenticatedProvider.textContent =
    principal.identityProvider === "aad"
      ? "Microsoft Entra ID"
      : String(principal.identityProvider || "Authenticated identity");

  identityStatus.textContent = "Identity verified";
  identityStatus.classList.remove("error");
  identityStatus.classList.add("verified");

  submitButton.disabled = false;
  submitButton.textContent = "Submit suppression request";

  snapshotSubmitButton.disabled = false;
  snapshotSubmitButton.textContent = "Create VM snapshots";

  backupCheckButton.disabled = false;
  backupCheckButton.textContent = "Check Backup Status";

  backupSubmitButton.disabled = true;
  backupSubmitButton.textContent = "Check backup status first";
}

function validateForm(payload) {
  if (!authenticatedPrincipal) {
    return "Your authenticated identity is not available. Refresh the page.";
  }

  if (payload.hostnames.length < 1) {
    return "Enter at least one hostname.";
  }

  if (payload.hostnames.length > MAX_HOSTNAMES) {
    return `A maximum of ${MAX_HOSTNAMES} unique hostnames is allowed.`;
  }

  const hostnamePattern = /^[A-Z0-9._-]{1,253}$/;
  const invalidHostname = payload.hostnames.find(
    (hostname) => !hostnamePattern.test(hostname)
  );

  if (invalidHostname) {
    return `Invalid hostname: ${invalidHostname}.`;
  }

  if (!payload.startDateTime || !payload.endDateTime) {
    return "Enter the start and end date/time.";
  }

  const startMilliseconds = parseCentralEuropeanDateTime(payload.startDateTime);
  const endMilliseconds = parseCentralEuropeanDateTime(payload.endDateTime);

  if (startMilliseconds === null || endMilliseconds === null) {
    return "Enter valid start and end dates in Central European Time.";
  }

  if (payload.timeZone !== FIXED_TIME_ZONE) {
    return "Only Central European Time is allowed.";
  }

  if (endMilliseconds <= startMilliseconds) {
    return "End date/time must be later than start date/time.";
  }

  const minimumStart =
    Date.now() + MINIMUM_LEAD_MINUTES * 60 * 1000;

  if (startMilliseconds < minimumStart) {
    return `Start time must be at least ${MINIMUM_LEAD_MINUTES} minutes in the future.`;
  }

  const durationMilliseconds = endMilliseconds - startMilliseconds;

  if (
    durationMilliseconds >
    MAXIMUM_DURATION_HOURS * 60 * 60 * 1000
  ) {
    return `The suppression window cannot exceed ${MAXIMUM_DURATION_HOURS} hours.`;
  }

  if (!payload.changeNumber) {
    return "Enter the change or incident number.";
  }

  if (!payload.reason) {
    return "Enter the reason for suppression.";
  }

  return "";
}


const ALLOWED_SNAPSHOT_RETENTION_DAYS =
  new Set([1, 3, 7, 14]);

function calculateSnapshotExpiryUtc(retentionDays) {
  const days = Number(retentionDays);

  if (!ALLOWED_SNAPSHOT_RETENTION_DAYS.has(days)) {
    return "";
  }

  return new Date(
    Date.now() + days * 24 * 60 * 60 * 1000
  ).toISOString();
}

function formatSnapshotExpiryForDisplay(expiresUtc) {
  if (!expiresUtc) return "";

  const date = new Date(expiresUtc);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IANA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    hourCycle: "h23"
  }).format(date);
}

function updateSnapshotExpiryPreview() {
  const expiresUtc = calculateSnapshotExpiryUtc(
    snapshotRetentionDays.value
  );

  snapshotExpiryDate.value =
    formatSnapshotExpiryForDisplay(expiresUtc);
}

function updateSnapshotHostnameCount() {
  const count =
    parseHostnames(snapshotHostnamesInput.value).length;

  snapshotHostnameCount.textContent =
    `${count} / ${SNAPSHOT_MAX_HOSTNAMES}`;

  snapshotHostnameCount.classList.toggle(
    "over-limit",
    count > SNAPSHOT_MAX_HOSTNAMES
  );
}

function validateSnapshotForm(payload) {
  if (!authenticatedPrincipal) {
    return "Your authenticated identity is not available. Refresh the page.";
  }

  if (payload.hostnames.length < 1) {
    return "Enter at least one hostname.";
  }

  if (payload.hostnames.length > SNAPSHOT_MAX_HOSTNAMES) {
    return `A maximum of ${SNAPSHOT_MAX_HOSTNAMES} unique hostnames is allowed per snapshot request.`;
  }

  const hostnamePattern = /^[A-Z0-9._-]{1,253}$/;
  const invalidHostname = payload.hostnames.find(
    (hostname) => !hostnamePattern.test(hostname)
  );

  if (invalidHostname) {
    return `Invalid hostname: ${invalidHostname}.`;
  }

  if (!["OSOnly", "AllDisks"].includes(payload.snapshotScope)) {
    return "Select a valid snapshot scope.";
  }

  if (
    !ALLOWED_SNAPSHOT_RETENTION_DAYS.has(
      Number(payload.retentionDays)
    )
  ) {
    return "Select a valid snapshot retention period.";
  }

  const changeNumberPattern = /^[A-Za-z0-9._-]{1,40}$/;

  if (!changeNumberPattern.test(payload.changeNumber)) {
    return (
      "Change / incident number may contain only letters, numbers, " +
      "full stops, underscores and hyphens."
    );
  }

  if (!payload.reason) {
    return "Enter the reason for the snapshot request.";
  }

  return "";
}

function stopSnapshotStatusPolling(clearStoredRequest = false) {
  if (snapshotStatusPollTimer) {
    clearTimeout(snapshotStatusPollTimer);
    snapshotStatusPollTimer = null;
  }

  snapshotStatusPollCount = 0;

  if (clearStoredRequest) {
    currentSnapshotRequestId = null;

    try {
      sessionStorage.removeItem(
        "activeSnapshotRequestId"
      );
    } catch {
      // Continue without browser session storage.
    }
  }
}

function snapshotStatusIsTerminal(status) {
  return [
    "Completed",
    "PartiallyCompleted",
    "Failed"
  ].includes(status);
}

function formatStatusDetails(details) {
  if (details === null || details === undefined) {
    return "";
  }

  if (typeof details === "string") {
    return details;
  }

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function buildSnapshotStatusTable(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }

  const rows = items
    .map((item) => {
      const diskLabel =
        item.diskType === "Data" &&
        item.lun !== undefined &&
        item.lun !== null
          ? `Data (LUN ${item.lun})`
          : item.diskType || "VM";

      return `
        <tr>
          <td>${escapeHtml(item.hostname || "")}</td>
          <td>${escapeHtml(diskLabel)}</td>
          <td>${escapeHtml(item.sourceDiskName || "")}</td>
          <td>${escapeHtml(item.snapshotName || "")}</td>
          <td>
            <span class="badge ${
              item.status === "Created"
                ? "badge-success"
                : "badge-error"
            }">
              ${escapeHtml(item.status || "Unknown")}
            </span>
          </td>
          <td>${escapeHtml(
            item.message ||
            item.reason ||
            formatStatusDetails(item.details) ||
            ""
          )}</td>
        </tr>`;
    })
    .join("");

  return `
    <h3>Snapshot results</h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Hostname</th>
            <th>Disk</th>
            <th>Source disk</th>
            <th>Snapshot</th>
            <th>Status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderSnapshotStatus(result) {
  const status = result.status || "Submitted";

  let bannerClass = "status-warning";
  let heading = "Snapshot creation in progress";

  if (status === "Completed") {
    bannerClass = "status-success";
    heading = "VM snapshots created successfully";
  } else if (status === "PartiallyCompleted") {
    bannerClass = "status-warning";
    heading = "Snapshot request partially completed";
  } else if (status === "Failed") {
    bannerClass = "status-error";
    heading = "Snapshot request failed";
  } else if (status === "RateLimited") {
    bannerClass = "status-error";
    heading = "Snapshot request limit reached";
  } else if (status === "Submitted") {
    heading = "Snapshot request submitted";
  }

  snapshotResultArea.hidden = false;
  snapshotResultArea.innerHTML = `
    <div class="status-banner ${bannerClass}">
      <h2>${escapeHtml(heading)}</h2>
      <div class="copy-row">
        <strong>Request ID:</strong>
        <code>${escapeHtml(
          result.requestId || "Not available"
        )}</code>
        ${
          result.requestId
            ? `
              <button id="copySnapshotRequestId"
                type="button" class="secondary">
                Copy Request ID
              </button>`
            : ""
        }
      </div>
      <p>${escapeHtml(
        result.message ||
        "The request is being processed."
      )}</p>
    </div>

    ${
      status !== "RateLimited"
        ? `<div class="summary snapshot-summary">
      <div class="summary-item">
        <strong>${escapeHtml(
          result.submittedCount ?? 0
        )}</strong>
        <span>VMs submitted</span>
      </div>
      <div class="summary-item">
        <strong>${escapeHtml(
          result.successCount ?? 0
        )}</strong>
        <span>Snapshots created</span>
      </div>
      <div class="summary-item">
        <strong>${escapeHtml(
          result.failureCount ?? 0
        )}</strong>
        <span>Failures</span>
      </div>
      <div class="summary-item">
        <strong>${escapeHtml(
          result.retentionDays
            ? `${result.retentionDays} day${
                Number(result.retentionDays) === 1 ? "" : "s"
              }`
            : "Not available"
        )}</strong>
        <span>Retention</span>
      </div>
      <div class="summary-item">
        <strong>${escapeHtml(
          result.expiresUtc
            ? formatSnapshotExpiryForDisplay(
                result.expiresUtc
              )
            : "Not available"
        )}</strong>
        <span>Expires</span>
      </div>
    </div>`
        : ""
    }

    ${
      !snapshotStatusIsTerminal(status)
        ? `
          <div class="information-note">
            The portal is checking the Snapshot Logic App result automatically.
            Keep this tab open for live confirmation.
          </div>`
        : ""
    }

    ${buildSnapshotStatusTable(result.results)}
  `;

  document
    .getElementById("copySnapshotRequestId")
    ?.addEventListener("click", async () => {
      if (!result.requestId) return;

      await navigator.clipboard.writeText(
        result.requestId
      );

      document.getElementById(
        "copySnapshotRequestId"
      ).textContent = "Copied";
    });
}

async function pollSnapshotStatus(requestId) {
  if (
    !requestId ||
    requestId !== currentSnapshotRequestId
  ) {
    return;
  }

  snapshotStatusPollCount += 1;

  try {
    const response = await fetch(
      `/api/getSnapshotStatus?requestId=${encodeURIComponent(
        requestId
      )}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        cache: "no-store"
      }
    );

    if (response.status === 401) {
      window.location.assign(
        "/.auth/login/aad?post_login_redirect_uri=/"
      );
      return;
    }

    const result = await response.json();

    if (response.ok) {
      renderSnapshotStatus(result);

      if (snapshotStatusIsTerminal(result.status)) {
        stopSnapshotStatusPolling(true);
        return;
      }
    } else if (response.status !== 404) {
      console.error(
        "Snapshot status polling failed.",
        result
      );
    }
  } catch (error) {
    console.error(
      "Snapshot status polling error.",
      error
    );
  }

  if (
    snapshotStatusPollCount >=
    SNAPSHOT_STATUS_MAX_POLLS
  ) {
    snapshotValidationMessage.textContent =
      "Snapshot status polling timed out after 30 minutes. " +
      "Use the Request ID to check the Snapshot Logic App run history.";
    stopSnapshotStatusPolling(false);
    return;
  }

  snapshotStatusPollTimer = window.setTimeout(
    () => pollSnapshotStatus(requestId),
    SNAPSHOT_STATUS_POLL_INTERVAL_MS
  );
}

function startSnapshotStatusPolling(requestId) {
  stopSnapshotStatusPolling(false);

  currentSnapshotRequestId = requestId;
  snapshotStatusPollCount = 0;

  try {
    sessionStorage.setItem(
      "activeSnapshotRequestId",
      requestId
    );
  } catch {
    // Continue without browser session storage.
  }

  pollSnapshotStatus(requestId);
}

function showSnapshotResult(result, httpStatus) {
  const accepted =
    httpStatus === 202 || result.status === "Accepted";

  if (!accepted) {
    if (result.status === "RateLimited") {
      const retryText = result.retryAfterUtc
        ? ` Next request allowed after ${formatSnapshotExpiryForDisplay(
            result.retryAfterUtc
          )}.`
        : "";

      renderSnapshotStatus({
        ...result,
        status: "RateLimited",
        message: `${result.message || "Snapshot request limit reached."}${retryText}`
      });
    } else {
      renderSnapshotStatus({
        ...result,
        status: "Failed"
      });
    }

    return;
  }

  renderSnapshotStatus({
    ...result,
    status: "Submitted",
    successCount: 0,
    failureCount: 0,
    results: []
  });

  startSnapshotStatusPolling(result.requestId);
}


function formatBackupDateTime(value) {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: IANA_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
      hourCycle: "h23"
    }
  ).format(date);
}

function updateBackupHostnameCount() {
  const count =
    parseHostnames(
      backupHostnamesInput.value
    ).length;

  backupHostnameCount.textContent =
    `${count} / ${BACKUP_MAX_HOSTNAMES}`;

  backupHostnameCount.classList.toggle(
    "over-limit",
    count > BACKUP_MAX_HOSTNAMES
  );
}


function getBackupHostnamesFingerprint() {
  return parseHostnames(
    backupHostnamesInput.value
  )
    .slice()
    .sort()
    .join("|");
}

function resetBackupPrecheck(
  clearDisplay = true
) {
  backupPrecheckFingerprint = "";
  backupPrecheckPassed = false;

  backupActionFields.disabled = true;
  backupSubmitButton.disabled = true;
  backupSubmitButton.textContent =
    "Check backup status first";

  if (clearDisplay) {
    backupPrecheckArea.hidden = true;
    backupPrecheckArea.innerHTML = "";
  }
}

function getJobDurationMinutes(job) {
  const properties =
    job?.properties || job || {};

  const start = Date.parse(
    properties.startTime || ""
  );
  const end = Date.parse(
    properties.endTime || ""
  );

  if (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end >= start
  ) {
    return (end - start) / 60000;
  }

  return null;
}

function getEstimatedBackupMinutes(item) {
  const durations =
    (Array.isArray(item.recentCompletedJobs)
      ? item.recentCompletedJobs
      : [])
      .map(getJobDurationMinutes)
      .filter(
        (value) =>
          Number.isFinite(value) &&
          value > 0
      )
      .slice(0, 5)
      .sort((a, b) => a - b);

  if (durations.length === 0) {
    return null;
  }

  const middle =
    Math.floor(durations.length / 2);

  return durations.length % 2 === 0
    ? (
        durations[middle - 1] +
        durations[middle]
      ) / 2
    : durations[middle];
}

function formatApproxDuration(item) {
  const minutes =
    getEstimatedBackupMinutes(item);

  if (!Number.isFinite(minutes)) {
    return `
      <span>Not enough recent history</span>
      <span class="estimate-note">
        Actual backup duration depends on changed data,
        disk count and Azure Backup processing.
      </span>`;
  }

  const rounded =
    Math.max(1, Math.round(minutes));

  const historyCount =
    Math.min(
      5,
      Array.isArray(item.recentCompletedJobs)
        ? item.recentCompletedJobs.length
        : 0
    );

  return `
    <strong>~${escapeHtml(rounded)} min</strong>
    <span class="estimate-note">
      Median of ${escapeHtml(historyCount)} recent successful backup job${historyCount === 1 ? "" : "s"}.
      Actual duration may vary.
    </span>`;
}

function renderBackupPrecheck(result) {
  const items =
    Array.isArray(result.items)
      ? result.items
      : [];

  const allEligible =
    Boolean(result.allEligible) &&
    items.length > 0;

  let bannerClass =
    allEligible
      ? "success"
      : "warning";

  let bannerTitle =
    allEligible
      ? "Backup Now is available"
      : "Backup Now is not available for all entered VMs";

  if (items.length === 0) {
    bannerClass = "error";
    bannerTitle =
      "Backup status could not be determined";
  }

  const rows =
    items.map((item) => {
      const activeJob =
        String(
          item.currentJobStatus || ""
        ).trim();

      const currentJobText =
        activeJob
          ? `
            <span class="current-job-inprogress">
              ${escapeHtml(activeJob)}
            </span>
            ${
              item.currentJobStartUtc
                ? `<span class="estimate-note">Started ${escapeHtml(
                    formatBackupDateTime(
                      item.currentJobStartUtc
                    )
                  )}</span>`
                : ""
            }`
          : "None";

      const eligibleText =
        item.backupNowAllowed
          ? '<span class="badge badge-success">Ready</span>'
          : '<span class="badge badge-warning">Blocked</span>';

      return `
        <tr>
          <td>${escapeHtml(
            item.hostname || ""
          )}</td>
          <td>${escapeHtml(
            item.subscriptionName ||
            "Not available"
          )}</td>
          <td>${escapeHtml(
            item.resourceGroup ||
            "Not available"
          )}</td>
          <td>${escapeHtml(
            item.protectionStatus ||
            "Unknown"
          )}</td>
          <td>${escapeHtml(
            item.vaultName ||
            "Not available"
          )}</td>
          <td>${escapeHtml(
            item.policyName ||
            "Not available"
          )}</td>
          <td>${escapeHtml(
            item.lastBackupStatus ||
            "Not available"
          )}</td>
          <td>${escapeHtml(
            formatBackupDateTime(
              item.lastBackupTimeUtc
            )
          )}</td>
          <td>${escapeHtml(
            formatBackupDateTime(
              item.lastSuccessfulBackupUtc
            )
          )}</td>
          <td>${currentJobText}</td>
          <td>${formatApproxDuration(
            item
          )}</td>
          <td>${eligibleText}</td>
        </tr>`;
    }).join("");

  backupPrecheckArea.hidden = false;
  backupPrecheckArea.innerHTML = `
    <div class="backup-precheck-banner ${bannerClass}">
      <h3>${escapeHtml(
        bannerTitle
      )}</h3>
      <p>${escapeHtml(
        result.message ||
        (
          allEligible
            ? "All entered VMs are protected and no active backup job was found."
            : "Review the VM backup information below before continuing."
        )
      )}</p>
    </div>

    ${
      items.length
        ? `
          <div class="table-wrap backup-precheck-table">
            <table>
              <thead>
                <tr>
                  <th>Hostname</th>
                  <th>Subscription</th>
                  <th>Resource Group</th>
                  <th>Protection</th>
                  <th>Vault</th>
                  <th>Policy</th>
                  <th>Last backup status</th>
                  <th>Last backup time</th>
                  <th>Last successful backup</th>
                  <th>Current backup job</th>
                  <th>Approx. duration</th>
                  <th>Backup Now</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`
        : ""
    }
  `;

  backupPrecheckPassed =
    allEligible;

  backupPrecheckFingerprint =
    allEligible
      ? getBackupHostnamesFingerprint()
      : "";

  backupActionFields.disabled =
    !allEligible;

  backupSubmitButton.disabled =
    !allEligible;

  backupSubmitButton.textContent =
    allEligible
      ? "Trigger Backup Now"
      : "Backup Now unavailable";
}

async function checkBackupStatusBeforeSubmit() {
  backupValidationMessage.textContent = "";
  resetBackupPrecheck(true);

  const hostnames =
    parseHostnames(
      backupHostnamesInput.value
    );

  if (hostnames.length < 1) {
    backupValidationMessage.textContent =
      "Enter at least one VM hostname.";
    return;
  }

  if (
    hostnames.length >
    BACKUP_MAX_HOSTNAMES
  ) {
    backupValidationMessage.textContent =
      `A maximum of ${BACKUP_MAX_HOSTNAMES} unique hostnames is allowed.`;
    return;
  }

  backupCheckButton.disabled = true;
  backupCheckButton.textContent =
    "Checking Azure Backup…";

  try {
    const response =
      await fetch(
        "/api/checkBackupStatus",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Accept:
              "application/json"
          },
          body: JSON.stringify({
            hostnames
          })
        }
      );

    const text =
      await response.text();

    let result;

    try {
      result =
        text
          ? JSON.parse(text)
          : {};
    } catch {
      result = {
        success: false,
        message:
          text ||
          "The status API returned an invalid response."
      };
    }

    if (response.status === 401) {
      window.location.assign(
        "/.auth/login/aad?post_login_redirect_uri=/"
      );
      return;
    }

    if (!response.ok) {
      backupPrecheckArea.hidden = false;
      backupPrecheckArea.innerHTML = `
        <div class="backup-precheck-banner error">
          <h3>Backup status check failed</h3>
          <p>${escapeHtml(
            result.message ||
            "Unable to check Azure Backup status."
          )}</p>
        </div>`;
      return;
    }

    renderBackupPrecheck(result);
  } catch (error) {
    backupPrecheckArea.hidden = false;
    backupPrecheckArea.innerHTML = `
      <div class="backup-precheck-banner error">
        <h3>Backup status check failed</h3>
        <p>${escapeHtml(
          `Unable to check Azure Backup status: ${error.message}`
        )}</p>
      </div>`;
  } finally {
    backupCheckButton.disabled =
      !authenticatedPrincipal;

    backupCheckButton.textContent =
      authenticatedPrincipal
        ? "Check Backup Status"
        : "Authentication required";
  }
}

function validateBackupForm(payload) {
  if (!authenticatedPrincipal) {
    return "Your authenticated identity is not available. Refresh the page.";
  }

  if (
    !backupPrecheckPassed ||
    backupPrecheckFingerprint !==
      getBackupHostnamesFingerprint()
  ) {
    return "Check the current Azure Backup status before triggering Backup Now.";
  }

  if (payload.hostnames.length < 1) {
    return "Enter at least one hostname.";
  }

  if (
    payload.hostnames.length >
    BACKUP_MAX_HOSTNAMES
  ) {
    return `A maximum of ${BACKUP_MAX_HOSTNAMES} unique hostnames is allowed per backup request.`;
  }

  const hostnamePattern =
    /^[A-Z0-9._-]{1,253}$/;

  const invalidHostname =
    payload.hostnames.find(
      (hostname) =>
        !hostnamePattern.test(
          hostname
        )
    );

  if (invalidHostname) {
    return `Invalid hostname: ${invalidHostname}.`;
  }

  const changeNumberPattern =
    /^[A-Za-z0-9._-]{1,40}$/;

  if (
    !changeNumberPattern.test(
      payload.changeNumber
    )
  ) {
    return (
      "Change / incident number may contain only letters, numbers, " +
      "full stops, underscores and hyphens."
    );
  }

  if (!payload.reason) {
    return "Enter the reason for the backup request.";
  }

  return "";
}

function stopBackupStatusPolling(
  clearStoredRequest = false
) {
  if (backupStatusPollTimer) {
    clearTimeout(
      backupStatusPollTimer
    );
    backupStatusPollTimer = null;
  }

  backupStatusPollCount = 0;

  if (clearStoredRequest) {
    currentBackupRequestId = null;

    try {
      localStorage.removeItem(
        "activeBackupRequestId"
      );
    } catch {
      // Continue without browser storage.
    }
  }
}

function backupStatusIsTerminal(
  status
) {
  return [
    "Completed",
    "PartiallyCompleted",
    "Failed"
  ].includes(status);
}

function buildBackupStatusTable(items) {
  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return "";
  }

  const rows = items
    .map((item) => {
      const successfulDate =
        item.lastSuccessfulBackupUtc ||
        item.previousLastSuccessfulBackupUtc;

      const backupStatus =
        item.lastBackupStatus ||
        item.backupStatus ||
        item.status ||
        "Unknown";

      const rowClass =
        item.status === "Completed"
          ? "badge-success"
          : ["NotProtected", "CompletedWithWarnings"].includes(item.status)
            ? "badge-warning"
            : "badge-error";

      return `
        <tr>
          <td>${escapeHtml(
            item.hostname || ""
          )}</td>
          <td>${escapeHtml(
            item.protectionStatus ||
            "Unknown"
          )}</td>
          <td>${escapeHtml(
            item.vaultName ||
            "Not available"
          )}</td>
          <td>${escapeHtml(
            item.policyName ||
            "Not available"
          )}</td>
          <td>${escapeHtml(
            backupStatus
          )}</td>
          <td>${escapeHtml(
            formatBackupDateTime(
              successfulDate
            )
          )}</td>
          <td>
            <span class="badge ${rowClass}">
              ${escapeHtml(
                item.status ||
                "Unknown"
              )}
            </span>
          </td>
          <td>${escapeHtml(
            item.message ||
            formatStatusDetails(
              item.details
            ) ||
            ""
          )}</td>
        </tr>`;
    })
    .join("");

  return `
    <h3>VM backup results</h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Hostname</th>
            <th>Protection</th>
            <th>Vault</th>
            <th>Policy</th>
            <th>Last backup status</th>
            <th>Last successful backup</th>
            <th>Request status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderBackupStatus(result) {
  const status =
    result.status || "Submitted";

  let bannerClass =
    "status-warning";
  let heading =
    "VM backup is in progress";

  if (status === "Completed") {
    bannerClass =
      "status-success";
    heading =
      "VM backup completed successfully";
  } else if (
    status ===
    "PartiallyCompleted"
  ) {
    heading =
      "VM backup request partially completed";
  } else if (
    status === "Failed"
  ) {
    bannerClass =
      "status-error";
    heading =
      "VM backup request failed";
  } else if (
    status === "RateLimited"
  ) {
    bannerClass =
      "status-error";
    heading =
      "VM backup request limit reached";
  } else if (
    status === "Submitted"
  ) {
    heading =
      "VM backup request submitted";
  }

  backupResultArea.hidden = false;

  backupResultArea.innerHTML = `
    <div class="status-banner ${bannerClass}">
      <h2>${escapeHtml(
        heading
      )}</h2>
      <div class="copy-row">
        <strong>Request ID:</strong>
        <code>${escapeHtml(
          result.requestId ||
          "Not available"
        )}</code>
        ${
          result.requestId
            ? `
              <button
                id="copyBackupRequestId"
                type="button"
                class="secondary">
                Copy Request ID
              </button>`
            : ""
        }
      </div>
      <p>${escapeHtml(
        result.message ||
        "The backup request is being processed."
      )}</p>
    </div>

    ${
      status !== "RateLimited"
        ? `
          <div class="summary backup-summary">
            <div class="summary-item">
              <strong>${escapeHtml(
                result.submittedCount ??
                0
              )}</strong>
              <span>VMs submitted</span>
            </div>

            <div class="summary-item">
              <strong>${escapeHtml(
                result.successCount ??
                result.backupCount ??
                0
              )}</strong>
              <span>Backups completed</span>
            </div>

            <div class="summary-item">
              <strong>${escapeHtml(
                result.failureCount ??
                0
              )}</strong>
              <span>Failures</span>
            </div>
          </div>`
        : ""
    }

    ${
      !backupStatusIsTerminal(
        status
      ) &&
      status !== "RateLimited"
        ? `
          <div class="information-note">
            Azure Backup is processing this request asynchronously.
            The portal checks the result automatically.
            You can keep this tab open for live confirmation.
          </div>`
        : ""
    }

    ${buildBackupStatusTable(
      result.results
    )}
  `;

  document
    .getElementById(
      "copyBackupRequestId"
    )
    ?.addEventListener(
      "click",
      async () => {
        if (!result.requestId) {
          return;
        }

        await navigator.clipboard
          .writeText(
            result.requestId
          );

        document
          .getElementById(
            "copyBackupRequestId"
          )
          .textContent =
            "Copied";
      }
    );
}


function getBackupHistoryBadgeClass(
  status
) {
  if (status === "Completed") {
    return "badge-success";
  }

  if (
    status ===
      "PartiallyCompleted" ||
    status ===
      "CompletedWithWarnings" ||
    status ===
      "Submitted" ||
    status ===
      "Processing" ||
    status ===
      "Accepted"
  ) {
    return "badge-warning";
  }

  return "badge-error";
}

function renderMyBackupRequests(
  requests
) {
  if (
    !Array.isArray(requests) ||
    requests.length === 0
  ) {
    backupHistoryTableArea.innerHTML = `
      <div class="backup-history-empty">
        No server-side VM Backup request history is available yet.
        New requests submitted after this update will appear here automatically.
      </div>`;

    return;
  }

  const rows =
    requests.map((item) => {
      const hostnames =
        Array.isArray(
          item.hostnames
        )
          ? item.hostnames
              .filter(Boolean)
          : [];

      const status =
        item.status ||
        "Unknown";

      const completionText =
        item.completedUtc
          ? formatBackupDateTime(
              item.completedUtc
            )
          : "-";

      const completedCount =
        `${item.successCount ?? 0}/${item.submittedCount ?? hostnames.length ?? 0}`;

      return `
        <tr>
          <td>
            <code>${escapeHtml(
              item.requestId || ""
            )}</code>
          </td>
          <td class="backup-history-vms">
            ${escapeHtml(
              hostnames.length
                ? hostnames.join(", ")
                : "Not available"
            )}
          </td>
          <td>${escapeHtml(
            item.changeNumber ||
            "Not available"
          )}</td>
          <td>${escapeHtml(
            formatBackupDateTime(
              item.submittedUtc
            )
          )}</td>
          <td>
            <span class="badge ${getBackupHistoryBadgeClass(
              status
            )}">
              ${escapeHtml(
                status
              )}
            </span>
          </td>
          <td>${escapeHtml(
            completedCount
          )}</td>
          <td>${escapeHtml(
            completionText
          )}</td>
          <td class="backup-history-actions">
            <button
              type="button"
              class="secondary backup-history-view-button"
              data-request-id="${escapeHtml(
                item.requestId || ""
              )}">
              ${
                backupStatusIsTerminal(
                  status
                )
                  ? "View"
                  : "View / Resume"
              }
            </button>
          </td>
        </tr>`;
    }).join("");

  backupHistoryTableArea.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Request ID</th>
            <th>VMs</th>
            <th>Change / Incident</th>
            <th>Submitted</th>
            <th>Status</th>
            <th>Completed VMs</th>
            <th>Completed</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  backupHistoryTableArea
    .querySelectorAll(
      ".backup-history-view-button"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const requestId =
            button.dataset
              .requestId;

          if (requestId) {
            openBackupRequestFromHistory(
              requestId
            );
          }
        }
      );
    });
}

async function loadMyBackupRequests(
  showLoading = true
) {
  if (!authenticatedPrincipal) {
    return;
  }

  if (showLoading) {
    backupHistoryMessage.textContent =
      "Loading your recent VM Backup requests…";
  }

  backupHistoryRefreshButton.disabled =
    true;

  try {
    const response =
      await fetch(
        "/api/getMyBackupRequests?limit=25",
        {
          method: "GET",
          headers: {
            Accept:
              "application/json"
          },
          cache: "no-store"
        }
      );

    if (response.status === 401) {
      window.location.assign(
        "/.auth/login/aad?post_login_redirect_uri=/"
      );
      return;
    }

    const result =
      await response.json();

    if (!response.ok) {
      backupHistoryMessage.innerHTML = `
        <span class="backup-history-error">
          ${escapeHtml(
            result.message ||
            "My Backup Requests could not be loaded."
          )}
        </span>`;

      return;
    }

    backupHistoryMessage.textContent =
      `Showing ${result.count ?? 0} recent request${result.count === 1 ? "" : "s"}.`;

    renderMyBackupRequests(
      result.requests
    );
  } catch (error) {
    backupHistoryMessage.innerHTML = `
      <span class="backup-history-error">
        ${escapeHtml(
          `My Backup Requests could not be loaded: ${error.message}`
        )}
      </span>`;
  } finally {
    backupHistoryRefreshButton.disabled =
      false;
  }
}

async function openBackupRequestFromHistory(
  requestId
) {
  backupHistoryMessage.textContent =
    "Loading selected VM Backup request…";

  try {
    const response =
      await fetch(
        `/api/getBackupStatus?requestId=${encodeURIComponent(
          requestId
        )}`,
        {
          method: "GET",
          headers: {
            Accept:
              "application/json"
          },
          cache: "no-store"
        }
      );

    if (response.status === 401) {
      window.location.assign(
        "/.auth/login/aad?post_login_redirect_uri=/"
      );
      return;
    }

    const result =
      await response.json();

    if (!response.ok) {
      backupHistoryMessage.innerHTML = `
        <span class="backup-history-error">
          ${escapeHtml(
            result.message ||
            "The selected backup request could not be loaded."
          )}
        </span>`;
      return;
    }

    renderBackupStatus(
      result
    );

    backupResultArea.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    if (
      !backupStatusIsTerminal(
        result.status
      )
    ) {
      startBackupStatusPolling(
        requestId
      );
    }

    backupHistoryMessage.textContent =
      "Selected request loaded.";
  } catch (error) {
    backupHistoryMessage.innerHTML = `
      <span class="backup-history-error">
        ${escapeHtml(
          `The selected backup request could not be loaded: ${error.message}`
        )}
      </span>`;
  }
}

async function pollBackupStatus(
  requestId
) {
  if (
    !requestId ||
    requestId !==
      currentBackupRequestId
  ) {
    return;
  }

  backupStatusPollCount += 1;

  try {
    const response =
      await fetch(
        `/api/getBackupStatus?requestId=${encodeURIComponent(
          requestId
        )}`,
        {
          method: "GET",
          headers: {
            Accept:
              "application/json"
          },
          cache: "no-store"
        }
      );

    if (
      response.status === 401
    ) {
      window.location.assign(
        "/.auth/login/aad?post_login_redirect_uri=/"
      );
      return;
    }

    const result =
      await response.json();

    if (response.ok) {
      renderBackupStatus(
        result
      );

      if (
        backupStatusIsTerminal(
          result.status
        )
      ) {
        stopBackupStatusPolling(
          true
        );

        loadMyBackupRequests(
          false
        );

        return;
      }
    } else if (
      response.status !== 404
    ) {
      console.error(
        "VM backup status polling failed.",
        result
      );
    }
  } catch (error) {
    console.error(
      "VM backup status polling error.",
      error
    );
  }

  if (
    backupStatusPollCount >=
    BACKUP_STATUS_MAX_POLLS
  ) {
    backupValidationMessage
      .textContent =
      "Automatic backup status monitoring stopped after 6 hours. " +
      "Azure Backup is not cancelled. Use the Request ID and Backup Logic App run history to check the operation.";

    stopBackupStatusPolling(
      false
    );
    return;
  }

  backupStatusPollTimer =
    window.setTimeout(
      () =>
        pollBackupStatus(
          requestId
        ),
      BACKUP_STATUS_POLL_INTERVAL_MS
    );
}

function startBackupStatusPolling(
  requestId
) {
  stopBackupStatusPolling(
    false
  );

  currentBackupRequestId =
    requestId;

  backupStatusPollCount = 0;

  try {
    localStorage.setItem(
      "activeBackupRequestId",
      requestId
    );
  } catch {
    // Continue without browser storage.
  }

  pollBackupStatus(
    requestId
  );
}

function showBackupResult(
  result,
  httpStatus
) {
  const accepted =
    httpStatus === 202 ||
    result.status === "Accepted";

  if (!accepted) {
    if (
      result.status ===
      "RateLimited"
    ) {
      const retryText =
        result.retryAfterUtc
          ? ` Next request allowed after ${formatBackupDateTime(
              result.retryAfterUtc
            )}.`
          : "";

      renderBackupStatus({
        ...result,
        status:
          "RateLimited",
        message:
          `${result.message || "VM backup request limit reached."}${retryText}`
      });
    } else {
      renderBackupStatus({
        ...result,
        status: "Failed"
      });
    }

    return;
  }

  renderBackupStatus({
    ...result,
    status: "Submitted",
    successCount: 0,
    failureCount: 0,
    results: []
  });

  startBackupStatusPolling(
    result.requestId
  );

  window.setTimeout(
    () =>
      loadMyBackupRequests(
        false
      ),
    750
  );
}

function buildSuccessTable(items) {
  if (!Array.isArray(items) || items.length === 0) return "";

  const rows = items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.hostname)}</td>
          <td>${escapeHtml(item.vmName)}</td>
          <td>${escapeHtml(item.subscriptionName)}</td>
          <td>${escapeHtml(item.resourceGroup)}</td>
          <td>
            <span class="badge badge-success">
              ${escapeHtml(item.status || "Created")}
            </span>
          </td>
          <td>${escapeHtml(item.ruleName)}</td>
        </tr>`
    )
    .join("");

  return `
    <h3>Successful VMs</h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Hostname</th>
            <th>Azure VM</th>
            <th>Subscription</th>
            <th>Resource group</th>
            <th>Status</th>
            <th>Suppression rule</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildFailureTable(items) {
  if (!Array.isArray(items) || items.length === 0) return "";

  const rows = items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.hostname || item.hostnameSubmitted)}</td>
          <td>
            <span class="badge badge-error">
              ${escapeHtml(item.status || "Failed")}
            </span>
          </td>
          <td>${escapeHtml(item.failureStage)}</td>
          <td>
            ${escapeHtml(
              item.message ||
              item.details?.message ||
              "Automation failed"
            )}
          </td>
        </tr>`
    )
    .join("");

  return `
    <h3>Failed VMs</h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Hostname</th>
            <th>Status</th>
            <th>Failure stage</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function showResult(result, httpStatus) {
  let bannerClass = "status-error";
  let heading = "Request failed";

  if (result.status === "Created") {
    bannerClass = "status-success";
    heading = "All suppression rules were created";
  } else if (result.status === "PartiallyCreated") {
    bannerClass = "status-warning";
    heading = "Request partially completed";
  }

  resultArea.hidden = false;
  resultArea.innerHTML = `
    <div class="status-banner ${bannerClass}">
      <h2>${escapeHtml(heading)}</h2>
      <div class="copy-row">
        <strong>Request ID:</strong>
        <code>${escapeHtml(result.requestId || "Not available")}</code>
        <button id="copyRequestId" type="button" class="secondary">
          Copy Request ID
        </button>
      </div>
      <p>
        ${escapeHtml(
          result.message || `The API returned HTTP ${httpStatus}.`
        )}
      </p>
    </div>

    <div class="summary">
      <div class="summary-item">
        <strong>${escapeHtml(result.submittedCount ?? 0)}</strong>
        <span>Submitted</span>
      </div>
      <div class="summary-item">
        <strong>${escapeHtml(result.uniqueCount ?? 0)}</strong>
        <span>Unique</span>
      </div>
      <div class="summary-item">
        <strong>${escapeHtml(result.successCount ?? 0)}</strong>
        <span>Successful</span>
      </div>
      <div class="summary-item">
        <strong>${escapeHtml(result.failureCount ?? 0)}</strong>
        <span>Failed</span>
      </div>
    </div>

    ${buildSuccessTable(result.successfulResults)}
    ${buildFailureTable(result.failedResults)}
  `;

  document
    .getElementById("copyRequestId")
    ?.addEventListener("click", async () => {
      if (!result.requestId) return;

      await navigator.clipboard.writeText(result.requestId);
      document.getElementById("copyRequestId").textContent = "Copied";
    });

  resultArea.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}


suppressionTabButton.addEventListener("click", () => {
  activateOperationTab("suppression");
});

backupTabButton.addEventListener("click", () => {
  activateOperationTab("backup");

  loadMyBackupRequests(
    false
  );
});

backupHostnamesInput.addEventListener(
  "input",
  () => {
    updateBackupHostnameCount();
    resetBackupPrecheck(true);
  }
);

backupCheckButton.addEventListener(
  "click",
  checkBackupStatusBeforeSubmit
);

backupHistoryRefreshButton.addEventListener(
  "click",
  () =>
    loadMyBackupRequests(
      true
    )
);

backupClearButton.addEventListener("click", () => {
  stopBackupStatusPolling(true);
  backupForm.reset();
  backupValidationMessage.textContent = "";
  backupResultArea.hidden = true;
  backupResultArea.innerHTML = "";
  resetBackupPrecheck(true);
  updateBackupHostnameCount();
});

backupForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  backupValidationMessage.textContent = "";
  backupResultArea.hidden = true;

  const payload = {
    hostnames:
      parseHostnames(
        backupHostnamesInput.value
      ),
    changeNumber:
      document
        .getElementById(
          "backupChangeNumber"
        )
        .value.trim(),
    reason:
      document
        .getElementById(
          "backupReason"
        )
        .value.trim()
  };

  const validationError =
    validateBackupForm(payload);

  if (validationError) {
    backupValidationMessage
      .textContent =
      validationError;
    return;
  }

  backupSubmitButton.disabled =
    true;

  backupSubmitButton.textContent =
    "Submitting backup request…";

  try {
    const response =
      await fetch(
        "/api/submitBackup",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Accept:
              "application/json"
          },
          body:
            JSON.stringify(
              payload
            )
        }
      );

    const text =
      await response.text();

    let result;

    try {
      result =
        text
          ? JSON.parse(text)
          : {};
    } catch {
      result = {
        success: false,
        status: "Failed",
        message:
          text ||
          "The API returned an invalid response."
      };
    }

    if (
      response.status === 401
    ) {
      window.location.assign(
        "/.auth/login/aad?post_login_redirect_uri=/"
      );
      return;
    }

    showBackupResult(
      result,
      response.status
    );
  } catch (error) {
    showBackupResult(
      {
        success: false,
        status: "Failed",
        message:
          `The VM backup request could not be submitted: ${error.message}`
      },
      0
    );
  } finally {
    resetBackupPrecheck(false);

    backupSubmitButton.disabled = true;
    backupSubmitButton.textContent =
      "Check backup status again";
  }
});


snapshotTabButton.addEventListener("click", () => {
  activateOperationTab("snapshot");
});

snapshotHostnamesInput.addEventListener(
  "input",
  updateSnapshotHostnameCount
);

snapshotRetentionDays.addEventListener(
  "change",
  updateSnapshotExpiryPreview
);

snapshotClearButton.addEventListener("click", () => {
  stopSnapshotStatusPolling(true);
  snapshotForm.reset();
  snapshotValidationMessage.textContent = "";
  snapshotResultArea.hidden = true;
  snapshotResultArea.innerHTML = "";
  updateSnapshotHostnameCount();
  updateSnapshotExpiryPreview();
});

snapshotForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  snapshotValidationMessage.textContent = "";
  snapshotResultArea.hidden = true;

  const payload = {
    hostnames: parseHostnames(snapshotHostnamesInput.value),
    snapshotScope:
      document.getElementById("snapshotScope").value,
    retentionDays:
      Number(snapshotRetentionDays.value),
    changeNumber:
      document
        .getElementById("snapshotChangeNumber")
        .value.trim(),
    reason:
      document
        .getElementById("snapshotReason")
        .value.trim()
  };

  const validationError =
    validateSnapshotForm(payload);

  if (validationError) {
    snapshotValidationMessage.textContent =
      validationError;
    return;
  }

  snapshotSubmitButton.disabled = true;
  snapshotSubmitButton.textContent =
    "Submitting snapshot request…";

  try {
    const response = await fetch(
      "/api/submitSnapshot",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const text = await response.text();
    let result;

    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      result = {
        success: false,
        status: "Failed",
        message:
          text ||
          "The API returned an invalid response."
      };
    }

    if (response.status === 401) {
      window.location.assign(
        "/.auth/login/aad?post_login_redirect_uri=/"
      );
      return;
    }

    showSnapshotResult(result, response.status);
  } catch (error) {
    showSnapshotResult(
      {
        success: false,
        status: "Failed",
        message:
          `The snapshot request could not be submitted: ${error.message}`
      },
      0
    );
  } finally {
    snapshotSubmitButton.disabled = false;
    snapshotSubmitButton.textContent =
      "Create VM snapshots";
  }
});

hostnamesInput.addEventListener("input", updateHostnameCount);

clearButton.addEventListener("click", () => {
  form.reset();
  document.getElementById("timeZone").value = FIXED_TIME_ZONE;
  validationMessage.textContent = "";
  resultArea.hidden = true;
  resultArea.innerHTML = "";
  updateHostnameCount();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  validationMessage.textContent = "";
  resultArea.hidden = true;

  const payload = {
    hostnames: parseHostnames(hostnamesInput.value),
    startDateTime: document.getElementById("startDateTime").value,
    endDateTime: document.getElementById("endDateTime").value,
    timeZone: document.getElementById("timeZone").value,
    changeNumber: document.getElementById("changeNumber").value.trim(),
    reason: document.getElementById("reason").value.trim()
  };

  const validationError = validateForm(payload);

  if (validationError) {
    validationMessage.textContent = validationError;
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Processing VMs…";

  try {
    const response = await fetch("/api/submitSuppression", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let result;

    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      result = {
        success: false,
        status: "Failed",
        message: text || "The API returned an invalid response."
      };
    }

    if (response.status === 401) {
      window.location.assign(
        "/.auth/login/aad?post_login_redirect_uri=/"
      );
      return;
    }

    showResult(result, response.status);
  } catch (error) {
    showResult(
      {
        success: false,
        status: "Failed",
        message: `The request could not be submitted: ${error.message}`
      },
      0
    );
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit suppression request";
  }
});

loadAuthenticatedUser()
  .then(() => {
    startIdleLogoutMonitoring();

    loadMyBackupRequests(
      false
    );
  })
  .catch((error) => {
  console.error(error);

  authenticatedUserName.textContent =
    "Unable to load authenticated identity";
  authenticatedProvider.textContent = error.message;

  identityStatus.textContent = "Identity error";
  identityStatus.classList.remove("verified");
  identityStatus.classList.add("error");

  validationMessage.textContent =
    "Authentication could not be verified. Sign out and sign in again.";

    submitButton.disabled = true;
    submitButton.textContent = "Authentication required";

    snapshotSubmitButton.disabled = true;
    snapshotSubmitButton.textContent =
      "Authentication required";

    backupCheckButton.disabled = true;
    backupCheckButton.textContent =
      "Authentication required";

    backupSubmitButton.disabled = true;
    backupSubmitButton.textContent =
      "Authentication required";
  });

updateHostnameCount();
updateSnapshotHostnameCount();
updateSnapshotExpiryPreview();
updateBackupHostnameCount();

try {
  const storedSnapshotRequestId =
    sessionStorage.getItem(
      "activeSnapshotRequestId"
    );

  if (storedSnapshotRequestId) {
    startSnapshotStatusPolling(
      storedSnapshotRequestId
    );
  }
} catch {
  // Continue without browser session storage.
}

try {
  const storedBackupRequestId =
    localStorage.getItem(
      "activeBackupRequestId"
    );

  if (storedBackupRequestId) {
    startBackupStatusPolling(
      storedBackupRequestId
    );
  }
} catch {
  // Continue without browser local storage.
}

const initialOperationTab =
  window.location.hash === "#snapshot"
    ? "snapshot"
    : window.location.hash === "#backup"
      ? "backup"
      : "suppression";

activateOperationTab(
  initialOperationTab
);
