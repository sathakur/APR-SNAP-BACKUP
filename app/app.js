const MAX_HOSTNAMES = 20;
const SNAPSHOT_MAX_HOSTNAMES = 5;
const HEALTH_MAX_HOSTNAMES = 1;
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
const snapshotHistoryRefreshButton =
  document.getElementById("snapshotHistoryRefreshButton");
const snapshotHistoryMessage =
  document.getElementById("snapshotHistoryMessage");
const snapshotHistoryTableArea =
  document.getElementById("snapshotHistoryTableArea");

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

const healthTabButton =
  document.getElementById("healthTabButton");
const healthPanel =
  document.getElementById("healthPanel");
const healthForm =
  document.getElementById("healthForm");
const healthHostnamesInput =
  document.getElementById("healthHostnames");
const healthHostnameCount =
  document.getElementById("healthHostnameCount");
const healthPeriodMinutes =
  document.getElementById("healthPeriodMinutes");
const healthValidationMessage =
  document.getElementById("healthValidationMessage");
const healthSubmitButton =
  document.getElementById("healthSubmitButton");
const healthClearButton =
  document.getElementById("healthClearButton");
const healthResultArea =
  document.getElementById("healthResultArea");


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

const HEALTH_STATUS_POLL_INTERVAL_MS = 5000;
const HEALTH_STATUS_MAX_POLLS = 120;

let healthStatusPollTimer = null;
let healthStatusPollCount = 0;
let currentHealthRequestId = null;

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
    },
    health: {
      button: healthTabButton,
      panel: healthPanel
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
      "/.auth/login/aad?post_login_redirect_uri=/portal.html"
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

  healthSubmitButton.disabled = false;
  healthSubmitButton.textContent = "Run VM health diagnostic";
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
        "/.auth/login/aad?post_login_redirect_uri=/portal.html"
      );
      return;
    }

    const result = await response.json();

    if (response.ok) {
      renderSnapshotStatus(result);

      if (snapshotStatusIsTerminal(result.status)) {
        stopSnapshotStatusPolling(true);

        loadMySnapshotRequests(
          false
        );

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

  window.setTimeout(
    () =>
      loadMySnapshotRequests(
        false
      ),
    750
  );
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

function getSnapshotHistoryBadgeClass(
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

function renderMySnapshotRequests(
  requests
) {
  if (
    !Array.isArray(requests) ||
    requests.length === 0
  ) {
    snapshotHistoryTableArea.innerHTML = `
      <div class="backup-history-empty">
        No server-side VM Snapshot request history is available yet.
        New snapshot requests submitted after this update will appear here automatically.
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

      const scopeLabel =
        item.snapshotScopeLabel ||
        (item.snapshotScope === "AllDisks"
          ? "OS + data disks"
          : item.snapshotScope === "OSOnly"
            ? "OS disk only"
            : "Not available");

      const retentionText =
        Number.isFinite(
          Number(item.retentionDays)
        ) &&
        Number(item.retentionDays) > 0
          ? `${Number(item.retentionDays)} day${Number(item.retentionDays) === 1 ? "" : "s"}`
          : "Not available";

      const completionText =
        item.completedUtc
          ? formatBackupDateTime(
              item.completedUtc
            )
          : "-";

      const snapshotCount =
        item.snapshotCount ??
        item.successCount ??
        0;

      const failureCount =
        item.failureCount ??
        0;

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
            scopeLabel
          )}</td>
          <td>${escapeHtml(
            retentionText
          )}</td>
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
            <span class="badge ${getSnapshotHistoryBadgeClass(
              status
            )}">
              ${escapeHtml(
                status
              )}
            </span>
          </td>
          <td>${escapeHtml(
            snapshotCount
          )}</td>
          <td>${escapeHtml(
            failureCount
          )}</td>
          <td>${escapeHtml(
            completionText
          )}</td>
          <td class="backup-history-actions">
            <button
              type="button"
              class="secondary snapshot-history-view-button"
              data-request-id="${escapeHtml(
                item.requestId || ""
              )}">
              ${
                snapshotStatusIsTerminal(
                  status
                )
                  ? "View"
                  : "View / Resume"
              }
            </button>
          </td>
        </tr>`;
    }).join("");

  snapshotHistoryTableArea.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Request ID</th>
            <th>VMs</th>
            <th>Scope</th>
            <th>Retention</th>
            <th>Change / Incident</th>
            <th>Submitted</th>
            <th>Status</th>
            <th>Snapshots</th>
            <th>Failures</th>
            <th>Completed</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  snapshotHistoryTableArea
    .querySelectorAll(
      ".snapshot-history-view-button"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const requestId =
            button.dataset
              .requestId;

          if (requestId) {
            openSnapshotRequestFromHistory(
              requestId
            );
          }
        }
      );
    });
}

async function loadMySnapshotRequests(
  showLoading = true
) {
  if (!authenticatedPrincipal) {
    return;
  }

  if (showLoading) {
    snapshotHistoryMessage.textContent =
      "Loading your recent VM Snapshot requests…";
  }

  snapshotHistoryRefreshButton.disabled =
    true;

  try {
    const response =
      await fetch(
        "/api/getMySnapshotRequests?limit=5",
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
        "/.auth/login/aad?post_login_redirect_uri=/portal.html"
      );
      return;
    }

    const result =
      await response.json();

    if (!response.ok) {
      snapshotHistoryMessage.innerHTML = `
        <span class="backup-history-error">
          ${escapeHtml(
            result.message ||
            "My Snapshot Requests could not be loaded."
          )}
        </span>`;

      return;
    }

    snapshotHistoryMessage.textContent =
      `Showing ${result.count ?? 0} recent request${result.count === 1 ? "" : "s"}.`;

    renderMySnapshotRequests(
      result.requests
    );
  } catch (error) {
    snapshotHistoryMessage.innerHTML = `
      <span class="backup-history-error">
        ${escapeHtml(
          `My Snapshot Requests could not be loaded: ${error.message}`
        )}
      </span>`;
  } finally {
    snapshotHistoryRefreshButton.disabled =
      false;
  }
}

async function openSnapshotRequestFromHistory(
  requestId
) {
  snapshotHistoryMessage.textContent =
    "Loading selected VM Snapshot request…";

  try {
    const response =
      await fetch(
        `/api/getSnapshotStatus?requestId=${encodeURIComponent(
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
        "/.auth/login/aad?post_login_redirect_uri=/portal.html"
      );
      return;
    }

    const result =
      await response.json();

    if (!response.ok) {
      snapshotHistoryMessage.innerHTML = `
        <span class="backup-history-error">
          ${escapeHtml(
            result.message ||
            "The selected snapshot request could not be loaded."
          )}
        </span>`;
      return;
    }

    renderSnapshotStatus(
      result
    );

    snapshotResultArea.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    if (
      !snapshotStatusIsTerminal(
        result.status
      )
    ) {
      startSnapshotStatusPolling(
        requestId
      );
    }

    snapshotHistoryMessage.textContent =
      "Selected request loaded.";
  } catch (error) {
    snapshotHistoryMessage.innerHTML = `
      <span class="backup-history-error">
        ${escapeHtml(
          `The selected snapshot request could not be loaded: ${error.message}`
        )}
      </span>`;
  }
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
        "/.auth/login/aad?post_login_redirect_uri=/portal.html"
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
        "/api/getMyBackupRequests?limit=5",
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
        "/.auth/login/aad?post_login_redirect_uri=/portal.html"
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
        "/.auth/login/aad?post_login_redirect_uri=/portal.html"
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
        "/.auth/login/aad?post_login_redirect_uri=/portal.html"
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




/* =========================================================
   VM Health Diagnostic V1
   ========================================================= */
function updateHealthHostnameCount() {
  const count = parseHostnames(healthHostnamesInput.value).length;
  healthHostnameCount.textContent = `${count} / ${HEALTH_MAX_HOSTNAMES}`;
  healthHostnameCount.classList.toggle("over-limit", count > HEALTH_MAX_HOSTNAMES);
}

function validateHealthForm(payload) {
  if (!authenticatedPrincipal) {
    return "Your authenticated identity is not available. Refresh the page.";
  }

  if (payload.hostnames.length < 1) {
    return "Enter a VM hostname.";
  }

  if (payload.hostnames.length > HEALTH_MAX_HOSTNAMES) {
    return "VM Health Diagnostic accepts exactly one VM hostname per request.";
  }

  const hostnamePattern = /^[A-Z0-9._-]{1,253}$/;
  const invalidHostname = payload.hostnames.find(
    (hostname) => !hostnamePattern.test(hostname)
  );

  if (invalidHostname) {
    return `Invalid hostname: ${invalidHostname}.`;
  }

  if (![60, 180, 360, 1440].includes(Number(payload.periodMinutes))) {
    return "Select a valid diagnostic period.";
  }

  return "";
}

function healthFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function healthFormatNumber(value, digits = 1) {
  const number = healthFiniteNumber(value);
  return number === null ? "Unknown" : number.toFixed(digits);
}

function healthFormatPercent(value, digits = 1) {
  const number = healthFiniteNumber(value);
  return number === null ? "Unknown" : `${number.toFixed(digits)}%`;
}

function healthBasename(resourceId) {
  const value = String(resourceId || "").replace(/\/$/, "");
  if (!value) return "Not available";
  const parts = value.split("/").filter(Boolean);
  return parts.at(-1) || value;
}

function healthResourceSegment(resourceId, segmentName) {
  const parts = String(resourceId || "")
    .split("/")
    .filter(Boolean);
  const index = parts.findIndex(
    (part) => part.toLowerCase() === String(segmentName || "").toLowerCase()
  );
  return index >= 0 && parts[index + 1]
    ? parts[index + 1]
    : "Unknown";
}

function healthParseJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function healthGetInstanceStatus(result, prefix) {
  const statuses = Array.isArray(result?.instanceView?.statuses)
    ? result.instanceView.statuses
    : [];

  const match = statuses.find((status) =>
    String(status?.code || "").toLowerCase().startsWith(prefix.toLowerCase())
  );

  return match
    ? String(match.displayStatus || match.code?.split("/").at(-1) || "Unknown")
    : "Unknown";
}

function healthGetAgentStatus(result) {
  const statuses = Array.isArray(result?.instanceView?.vmAgent?.statuses)
    ? result.instanceView.vmAgent.statuses
    : [];

  const status = statuses[0];
  return status
    ? String(status.displayStatus || status.code?.split("/").at(-1) || "Unknown")
    : "Unknown";
}

function healthReadCpu(result) {
  const metrics = Array.isArray(result?.platformMetrics?.value)
    ? result.platformMetrics.value
    : [];

  const metric = metrics.find((item) =>
    String(item?.name?.value || item?.name?.localizedValue || "")
      .toLowerCase()
      .includes("percentage cpu")
  );

  const points = (metric?.timeseries || [])
    .flatMap((series) => Array.isArray(series?.data) ? series.data : []);

  const averages = points
    .map((point) => healthFiniteNumber(point?.average))
    .filter((value) => value !== null);

  const maximums = points
    .map((point) => healthFiniteNumber(point?.maximum))
    .filter((value) => value !== null);

  return {
    average:
      averages.length > 0
        ? averages.reduce((sum, value) => sum + value, 0) / averages.length
        : null,
    maximum:
      maximums.length > 0
        ? Math.max(...maximums)
        : null
  };
}

function healthReadGuestRows(result) {
  const table = Array.isArray(result?.guestMetrics?.tables)
    ? result.guestMetrics.tables[0]
    : null;

  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
    return [];
  }

  const columns = table.columns.map((column) => String(column?.name || ""));

  return table.rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index]]))
  );
}

function healthReadGuest(result) {
  const rows = healthReadGuestRows(result);
  const memoryRow = rows.find(
    (row) => row.Namespace === "Memory" && row.Name === "AvailableMB"
  );
  const heartbeatRow = rows.find(
    (row) => row.Namespace === "Computer" && row.Name === "Heartbeat"
  );

  let availableMemoryMb = healthFiniteNumber(memoryRow?.Value);
  let availableMemoryPercent = null;

  if (memoryRow) {
    const tags = healthParseJson(memoryRow.Tags);
    const totalMemoryMb = healthFiniteNumber(tags["vm.azm.ms/memorySizeMB"]);

    if (availableMemoryMb !== null && totalMemoryMb && totalMemoryMb > 0) {
      availableMemoryPercent = (availableMemoryMb / totalMemoryMb) * 100;
    }
  }

  const disksByInstance = new Map();

  for (const row of rows) {
    if (row.Namespace !== "LogicalDisk") continue;

    const instance = String(row.Instance || "Unknown");
    const current = disksByInstance.get(instance) || {
      instance,
      freePercent: null,
      freeMb: null,
      timeGenerated: row.TimeGenerated || null
    };

    if (row.Name === "FreeSpacePercentage") {
      current.freePercent = healthFiniteNumber(row.Value);
    }

    if (row.Name === "FreeSpaceMB") {
      current.freeMb = healthFiniteNumber(row.Value);
    }

    if (row.TimeGenerated) current.timeGenerated = row.TimeGenerated;
    disksByInstance.set(instance, current);
  }

  const disks = [...disksByInstance.values()];
  const freePercents = disks
    .map((disk) => disk.freePercent)
    .filter((value) => value !== null);

  return {
    availableMemoryMb,
    availableMemoryPercent,
    lowestDiskFreePercent:
      freePercents.length > 0 ? Math.min(...freePercents) : null,
    disks,
    heartbeatUtc: heartbeatRow?.TimeGenerated || null,
    dataAvailable: rows.length > 0
  };
}

function healthReadPatch(result) {
  const records = Array.isArray(result?.patchAssessment?.data)
    ? result.patchAssessment.data
    : [];
  const properties = records[0]?.Properties || {};
  const counts = properties.availablePatchCountByClassification || {};

  const criticalSecurityCount = Object.entries(counts)
    .filter(([name]) => /critical|security/i.test(name))
    .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);

  const totalPending = Object.values(counts)
    .reduce((sum, value) => sum + (Number(value) || 0), 0);

  return {
    available: records.length > 0,
    properties,
    criticalSecurityCount,
    totalPending,
    rebootPending: properties.rebootPending ?? null,
    lastAssessmentUtc:
      properties.lastModifiedDateTime || properties.startDateTime || null
  };
}

function healthReadExtensions(result) {
  return Array.isArray(result?.extensions?.value)
    ? result.extensions.value
    : [];
}

function healthReadMonitoring(result, guest) {
  const extensions = healthReadExtensions(result);
  const amaExtension = extensions.find((extension) => {
    const text = `${extension?.name || ""} ${extension?.properties?.type || ""}`.toLowerCase();
    return text.includes("azuremonitorwindowsagent") ||
      text.includes("azuremonitorlinuxagent");
  });

  const dcrs = Array.isArray(result?.dcrAssociations?.value)
    ? result.dcrAssociations.value
    : [];

  return {
    amaInstalled: Boolean(amaExtension),
    amaProvisioningState:
      amaExtension?.properties?.provisioningState || "Unknown",
    dcrCount: dcrs.length,
    dcrs,
    vmInsightsDataAvailable: guest.dataAvailable,
    heartbeatUtc: guest.heartbeatUtc
  };
}

function healthAddFinding(findings, severity, code, message) {
  findings.push({ severity, code, message });
}

function deriveVmHealth(result) {
  if (!result || result.status === "Failed") {
    return {
      overall: "Critical",
      findings: [
        {
          severity: "Critical",
          code: "DIAGNOSTIC_FAILED",
          message: result?.message || "The VM health diagnostic failed."
        }
      ],
      powerState: "Unknown",
      provisioningState: "Unknown",
      agentStatus: "Unknown",
      resourceHealth: "Unknown",
      cpu: { average: null, maximum: null },
      guest: { availableMemoryMb: null, availableMemoryPercent: null, lowestDiskFreePercent: null, disks: [], heartbeatUtc: null, dataAvailable: false },
      patch: { available: false, properties: {}, criticalSecurityCount: 0, totalPending: 0, rebootPending: null, lastAssessmentUtc: null },
      monitoring: { amaInstalled: false, amaProvisioningState: "Unknown", dcrCount: 0, dcrs: [], vmInsightsDataAvailable: false, heartbeatUtc: null }
    };
  }

  const findings = [];
  const powerState = healthGetInstanceStatus(result, "PowerState/");
  const provisioningState = healthGetInstanceStatus(result, "ProvisioningState/");
  const agentStatus = healthGetAgentStatus(result);
  const resourceHealth =
    String(result?.resourceHealth?.properties?.availabilityState || "Unknown");
  const cpu = healthReadCpu(result);
  const guest = healthReadGuest(result);
  const patch = healthReadPatch(result);
  const monitoring = healthReadMonitoring(result, guest);
  const backupStatus = String(result?.backup?.protectionStatus || "Unknown");
  const extensions = healthReadExtensions(result);

  if (powerState !== "Unknown" && !/running/i.test(powerState)) {
    healthAddFinding(
      findings,
      "Critical",
      "VM_NOT_RUNNING",
      `VM power state is ${powerState}.`
    );
  }

  if (provisioningState !== "Unknown" && !/succeeded/i.test(provisioningState)) {
    healthAddFinding(
      findings,
      "Critical",
      "PROVISIONING_STATE",
      `VM provisioning state is ${provisioningState}.`
    );
  }

  if (/unavailable/i.test(resourceHealth)) {
    healthAddFinding(findings, "Critical", "RESOURCE_HEALTH", "Azure Resource Health reports the VM as Unavailable.");
  } else if (/degraded|unknown/i.test(resourceHealth)) {
    healthAddFinding(findings, "Warning", "RESOURCE_HEALTH", `Azure Resource Health is ${resourceHealth}.`);
  }

  if (agentStatus !== "Unknown" && !/ready/i.test(agentStatus)) {
    healthAddFinding(findings, "Warning", "VM_AGENT", `Azure VM Agent status is ${agentStatus}.`);
  }

  if (cpu.average !== null && cpu.average >= 90) {
    healthAddFinding(findings, "Critical", "CPU_HIGH", `Average CPU is ${cpu.average.toFixed(1)}%.`);
  } else if (
    (cpu.average !== null && cpu.average >= 80) ||
    (cpu.maximum !== null && cpu.maximum >= 90)
  ) {
    healthAddFinding(findings, "Warning", "CPU_HIGH", `CPU reached ${healthFormatPercent(cpu.maximum)} with ${healthFormatPercent(cpu.average)} average.`);
  }

  if (guest.availableMemoryPercent !== null) {
    if (guest.availableMemoryPercent < 10) {
      healthAddFinding(findings, "Critical", "MEMORY_LOW", `Available memory is ${guest.availableMemoryPercent.toFixed(1)}%.`);
    } else if (guest.availableMemoryPercent < 20) {
      healthAddFinding(findings, "Warning", "MEMORY_LOW", `Available memory is ${guest.availableMemoryPercent.toFixed(1)}%.`);
    }
  }

  for (const disk of guest.disks) {
    if (disk.freePercent === null) continue;
    if (disk.freePercent < 10) {
      healthAddFinding(findings, "Critical", "DISK_SPACE_LOW", `${disk.instance} has only ${disk.freePercent.toFixed(1)}% free space.`);
    } else if (disk.freePercent < 20) {
      healthAddFinding(findings, "Warning", "DISK_SPACE_LOW", `${disk.instance} has ${disk.freePercent.toFixed(1)}% free space.`);
    }
  }

  const failedExtensions = extensions.filter((extension) => {
    const state = String(extension?.properties?.provisioningState || "Unknown");
    return state !== "Unknown" && !/succeeded/i.test(state);
  });

  if (failedExtensions.length > 0) {
    healthAddFinding(
      findings,
      "Warning",
      "EXTENSION_HEALTH",
      `${failedExtensions.length} VM extension(s) are not in Succeeded provisioning state.`
    );
  }

  if (backupStatus.toLowerCase() !== "protected") {
    healthAddFinding(findings, "Warning", "BACKUP_PROTECTION", `Azure Backup protection status is ${backupStatus}.`);
  }

  if (patch.criticalSecurityCount > 0) {
    healthAddFinding(
      findings,
      "Warning",
      "PATCHES_PENDING",
      `${patch.criticalSecurityCount} Critical/Security patch(es) are pending in the latest available assessment.`
    );
  }

  if (patch.rebootPending === true) {
    healthAddFinding(findings, "Warning", "PATCH_REBOOT", "The latest patch assessment indicates a reboot is pending.");
  }

  if (!monitoring.amaInstalled) {
    healthAddFinding(findings, "Warning", "AMA_MISSING", "Azure Monitor Agent was not detected in the VM extension list.");
  }

  if (monitoring.dcrCount < 1) {
    healthAddFinding(findings, "Warning", "DCR_MISSING", "No Data Collection Rule association was returned for this VM.");
  }

  if (!monitoring.vmInsightsDataAvailable) {
    healthAddFinding(
      findings,
      "Warning",
      "GUEST_TELEMETRY_UNKNOWN",
      "VM Insights guest telemetry was not returned from the configured Log Analytics workspace; memory and logical-disk health remain Unknown."
    );
  }

  const failedSources = Object.entries(result?.actionStatus || {})
    .filter(([, status]) => status !== "Succeeded")
    .map(([name]) => name);

  if (failedSources.length > 0) {
    healthAddFinding(
      findings,
      "Warning",
      "DATA_SOURCE_UNAVAILABLE",
      `${failedSources.length} diagnostic data source(s) were unavailable: ${failedSources.join(", ")}.`
    );
  }

  let overall = "Healthy";
  if (findings.some((finding) => finding.severity === "Critical")) {
    overall = "Critical";
  } else if (findings.some((finding) => finding.severity === "Warning")) {
    overall = "Warning";
  }

  return {
    overall,
    findings,
    powerState,
    provisioningState,
    agentStatus,
    resourceHealth,
    cpu,
    guest,
    patch,
    monitoring
  };
}

function healthBadgeClass(status) {
  const value = String(status || "Unknown").toLowerCase();
  if (value === "healthy") return "health-status-healthy";
  if (value === "warning") return "health-status-warning";
  if (value === "critical") return "health-status-critical";
  if (value === "processing" || value === "submitted") return "health-status-processing";
  return "health-status-unknown";
}

function healthStatusBannerClass(status) {
  if (status === "Completed") return "status-success";
  if (status === "Failed") return "status-error";
  return "status-warning";
}

function healthBuildMiniTable(headers, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '<div class="health-empty">No data returned for this section.</div>';
  }

  return `
    <div class="table-wrap">
      <table class="health-mini-table">
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>${headers.map((header) => `<td>${escapeHtml(header.value(row))}</td>`).join("")}</tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function healthBuildConfiguration(result, view) {
  const vm = result?.vm || {};
  const rows = [
    ["Azure VM name", vm.VMName || "Unknown"],
    ["OS hostname", vm.ComputerName || vm.Hostname || result?.hostname || "Unknown"],
    ["Subscription", vm.SubscriptionName || vm.SubscriptionId || "Unknown"],
    ["Resource group", vm.ResourceGroup || "Unknown"],
    ["Region", vm.Location || "Unknown"],
    ["VM size", vm.VMSize || "Unknown"],
    ["OS type", vm.OSType || "Unknown"],
    ["Security type", vm.SecurityType || "Standard / not reported"],
    ["Managed identity", vm.IdentityType || "None / not reported"],
    ["Boot diagnostics", vm.BootDiagnosticsEnabled === true ? "Enabled" : vm.BootDiagnosticsEnabled === false ? "Disabled" : "Unknown"],
    ["Power state", view.powerState],
    ["Provisioning state", view.provisioningState],
    ["VM Agent", view.agentStatus]
  ];

  return `
    <div class="table-wrap">
      <table class="health-mini-table">
        <tbody>${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function healthBuildVmCard(result) {
  const view = deriveVmHealth(result);
  const vm = result?.vm || {};
  const guest = view.guest;
  const patch = view.patch;
  const monitoring = view.monitoring;
  const backup = result?.backup || {};
  const disks = Array.isArray(result?.managedDisks?.data) ? result.managedDisks.data : [];
  const nics = Array.isArray(result?.network?.data) ? result.network.data : [];
  const extensions = healthReadExtensions(result);

  const lowestDisk = guest.lowestDiskFreePercent;
  const patchDisplay = patch.available
    ? `${patch.totalPending} pending`
    : "Unknown";
  const monitorDisplay =
    monitoring.amaInstalled && monitoring.dcrCount > 0 && monitoring.vmInsightsDataAvailable
      ? "Reporting"
      : monitoring.vmInsightsDataAvailable
        ? "Partial"
        : "Unknown";

  const findingsHtml = view.findings.length > 0
    ? `<ul>${view.findings.map((finding) => `<li class="health-finding-${escapeHtml(finding.severity.toLowerCase())}"><strong>${escapeHtml(finding.severity)}:</strong> ${escapeHtml(finding.message)}</li>`).join("")}</ul>`
    : "<div class=\"health-empty\">No warning or critical findings were identified by the configured V1 rules.</div>";

  const guestDiskTable = healthBuildMiniTable(
    [
      { label: "Drive / mount", value: (row) => row.instance },
      { label: "Free %", value: (row) => row.freePercent === null ? "Unknown" : `${row.freePercent.toFixed(1)}%` },
      { label: "Free MB", value: (row) => row.freeMb === null ? "Unknown" : row.freeMb.toFixed(0) },
      { label: "Last sample", value: (row) => row.timeGenerated || "Unknown" }
    ],
    guest.disks
  );

  const managedDiskTable = healthBuildMiniTable(
    [
      { label: "Disk", value: (row) => row.Name || "Unknown" },
      { label: "Size GB", value: (row) => row.SizeGB ?? "Unknown" },
      { label: "SKU", value: (row) => row.Sku || "Unknown" },
      { label: "State", value: (row) => row.DiskState || "Unknown" },
      { label: "Encryption", value: (row) => row.EncryptionType || "Platform managed / not reported" }
    ],
    disks
  );

  const networkTable = healthBuildMiniTable(
    [
      { label: "NIC", value: (row) => row.Name || "Unknown" },
      { label: "Private IP", value: (row) => row.PrivateIp || "Unknown" },
      { label: "VNet", value: (row) => healthResourceSegment(row.SubnetId, "virtualNetworks") },
      { label: "Subnet", value: (row) => healthBasename(row.SubnetId) },
      { label: "NSG", value: (row) => healthBasename(row.NSGId) },
      { label: "Accelerated", value: (row) => row.AcceleratedNetworking === true ? "Enabled" : row.AcceleratedNetworking === false ? "Disabled" : "Unknown" },
      { label: "IP forwarding", value: (row) => row.IPForwarding === true ? "Enabled" : row.IPForwarding === false ? "Disabled" : "Unknown" }
    ],
    nics
  );

  const extensionTable = healthBuildMiniTable(
    [
      { label: "Extension", value: (row) => row.name || "Unknown" },
      { label: "Publisher", value: (row) => row.properties?.publisher || "Unknown" },
      { label: "Type", value: (row) => row.properties?.type || "Unknown" },
      { label: "Version", value: (row) => row.properties?.typeHandlerVersion || "Unknown" },
      { label: "Provisioning", value: (row) => row.properties?.provisioningState || "Unknown" }
    ],
    extensions
  );

  const dcrTable = healthBuildMiniTable(
    [
      { label: "Association", value: (row) => row.name || "Unknown" },
      { label: "DCR", value: (row) => healthBasename(row.properties?.dataCollectionRuleId) },
      { label: "DCR Resource ID", value: (row) => row.properties?.dataCollectionRuleId || "Unknown" }
    ],
    monitoring.dcrs
  );

  const patchCounts = patch.properties?.availablePatchCountByClassification || {};
  const patchRows = Object.entries(patchCounts).map(([classification, count]) => ({ classification, count }));
  const patchTable = healthBuildMiniTable(
    [
      { label: "Classification", value: (row) => row.classification },
      { label: "Pending", value: (row) => row.count }
    ],
    patchRows
  );

  return `
    <article class="health-vm-card">
      <div class="health-vm-header">
        <div>
          <h3>${escapeHtml(result?.hostname || vm.VMName || "VM")}</h3>
          <div class="health-vm-subtitle">${escapeHtml(vm.SubscriptionName || "Unknown subscription")} • ${escapeHtml(vm.ResourceGroup || "Unknown resource group")} • ${escapeHtml(vm.Location || "Unknown region")}</div>
        </div>
        <span class="health-status-pill ${healthBadgeClass(view.overall)}">${escapeHtml(view.overall)}</span>
      </div>

      <div class="health-chip-grid">
        <div class="health-chip"><span class="health-chip-label">Power</span><span class="health-chip-value">${escapeHtml(view.powerState)}</span></div>
        <div class="health-chip"><span class="health-chip-label">Resource Health</span><span class="health-chip-value">${escapeHtml(view.resourceHealth)}</span></div>
        <div class="health-chip"><span class="health-chip-label">CPU avg / max</span><span class="health-chip-value">${escapeHtml(healthFormatPercent(view.cpu.average))} / ${escapeHtml(healthFormatPercent(view.cpu.maximum))}</span></div>
        <div class="health-chip"><span class="health-chip-label">Memory available</span><span class="health-chip-value">${escapeHtml(healthFormatPercent(guest.availableMemoryPercent))}</span></div>
        <div class="health-chip"><span class="health-chip-label">Lowest disk free</span><span class="health-chip-value">${escapeHtml(healthFormatPercent(lowestDisk))}</span></div>
        <div class="health-chip"><span class="health-chip-label">Azure Backup</span><span class="health-chip-value">${escapeHtml(backup.protectionStatus || "Unknown")}</span></div>
        <div class="health-chip"><span class="health-chip-label">Patch assessment</span><span class="health-chip-value">${escapeHtml(patchDisplay)}</span></div>
        <div class="health-chip"><span class="health-chip-label">Monitoring</span><span class="health-chip-value">${escapeHtml(monitorDisplay)}</span></div>
      </div>

      <div class="health-findings"><h4>Findings</h4>${findingsHtml}</div>

      ${!guest.dataAvailable ? '<div class="health-note">Guest memory and logical-disk values are Unknown because VM Insights / InsightsMetrics data was not returned from the configured Log Analytics workspace.</div>' : ""}

      <div class="health-details">
        <details><summary>VM configuration &amp; runtime</summary><div class="health-details-body">${healthBuildConfiguration(result, view)}</div></details>
        <details><summary>Storage</summary><div class="health-details-body"><h4>Azure managed disks</h4>${managedDiskTable}<h4>Guest logical disks</h4>${guestDiskTable}</div></details>
        <details><summary>Network</summary><div class="health-details-body">${networkTable}</div></details>
        <details><summary>VM extensions</summary><div class="health-details-body">${extensionTable}</div></details>
        <details><summary>Monitoring / DCR / Log Analytics</summary><div class="health-details-body"><p class="field-help">AMA: <strong>${escapeHtml(monitoring.amaInstalled ? monitoring.amaProvisioningState : "Not detected")}</strong> • VM Insights data: <strong>${escapeHtml(monitoring.vmInsightsDataAvailable ? "Available" : "Unknown")}</strong> • Last heartbeat: <strong>${escapeHtml(monitoring.heartbeatUtc || "Unknown")}</strong></p>${dcrTable}</div></details>
        <details><summary>Backup &amp; patching</summary><div class="health-details-body"><p class="field-help">Backup protection: <strong>${escapeHtml(backup.protectionStatus || "Unknown")}</strong> • Vault: <strong>${escapeHtml(healthBasename(backup.vaultId))}</strong> • Policy: <strong>${escapeHtml(backup.policyName || "Unknown")}</strong></p><p class="field-help">Patch assessment: <strong>${escapeHtml(patch.lastAssessmentUtc || "No recent assessment returned")}</strong> • Reboot pending: <strong>${escapeHtml(patch.rebootPending === null ? "Unknown" : String(patch.rebootPending))}</strong></p>${patchTable}</div></details>
      </div>
    </article>
  `;
}

function renderHealthStatus(result) {
  healthResultArea.hidden = false;

  const requestStatus = String(result?.status || "Unknown");
  const terminal = ["Completed", "PartiallyCompleted", "Failed"].includes(requestStatus);

  if (!terminal) {
    healthResultArea.innerHTML = `
      <div class="status-banner status-warning">
        <h2>VM health diagnostic ${escapeHtml(requestStatus.toLowerCase())}</h2>
        <p>${escapeHtml(result?.message || "The read-only diagnostic is still running.")}</p>
        <div class="health-request-meta"><span><strong>Request ID:</strong> ${escapeHtml(result?.requestId || currentHealthRequestId || "")}</span><span><strong>VMs:</strong> ${escapeHtml(result?.submittedCount ?? "")}</span><span><strong>Period:</strong> ${escapeHtml(result?.periodMinutes ?? "")} minutes</span></div>
      </div>
    `;
    return;
  }

  const results = Array.isArray(result?.results) ? result.results : [];
  const views = results.map((item) => deriveVmHealth(item));
  const collectionFailedCount = results.filter(
    (item) => String(item?.status || "") === "Failed"
  ).length;
  const healthyCount = views.filter(
    (view, index) => results[index]?.status !== "Failed" && view.overall === "Healthy"
  ).length;
  const warningCount = views.filter(
    (view, index) => results[index]?.status !== "Failed" && view.overall === "Warning"
  ).length;
  const criticalCount = views.filter(
    (view, index) => results[index]?.status !== "Failed" && view.overall === "Critical"
  ).length;

  healthResultArea.innerHTML = `
    <div class="status-banner ${healthStatusBannerClass(requestStatus)}">
      <h2>VM health diagnostic ${escapeHtml(requestStatus)}</h2>
      <p>${escapeHtml(result?.message || "The diagnostic completed.")}</p>
      <div class="health-request-meta"><span><strong>Request ID:</strong> ${escapeHtml(result?.requestId || "")}</span><span><strong>Submitted:</strong> ${escapeHtml(result?.submittedCount ?? results.length)}</span><span><strong>Period:</strong> ${escapeHtml(result?.periodMinutes ?? "")} minutes</span></div>
    </div>

    <div class="health-overview-grid">
      <div class="health-overview-item"><span>Healthy</span><strong>${healthyCount}</strong></div>
      <div class="health-overview-item"><span>Warning</span><strong>${warningCount}</strong></div>
      <div class="health-overview-item"><span>Critical</span><strong>${criticalCount}</strong></div>
      <div class="health-overview-item"><span>Collection failed</span><strong>${collectionFailedCount}</strong></div>
    </div>

    ${results.length > 0
      ? results.map((item) => healthBuildVmCard(item)).join("")
      : '<div class="health-empty">No VM result records were returned.</div>'}
  `;
}

function stopHealthStatusPolling(clearStoredRequest = false) {
  if (healthStatusPollTimer) {
    clearTimeout(healthStatusPollTimer);
    healthStatusPollTimer = null;
  }

  healthStatusPollCount = 0;

  if (clearStoredRequest) {
    currentHealthRequestId = null;
    try {
      sessionStorage.removeItem("activeHealthRequestId");
    } catch {
      // Continue when browser storage is unavailable.
    }
  }
}

async function pollHealthStatus(requestId) {
  try {
    const response = await fetch(
      `/api/getHealthDiagnosticStatus?requestId=${encodeURIComponent(requestId)}`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );

    const text = await response.text();
    let result;

    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      result = { success: false, status: "Failed", message: text || "The API returned an invalid response." };
    }

    if (response.status === 401) {
      window.location.assign(
        "/.auth/login/aad?post_login_redirect_uri=/portal.html%23health"
      );
      return;
    }

    if (!response.ok) {
      throw new Error(result?.message || `Status check failed with HTTP ${response.status}.`);
    }

    renderHealthStatus(result);

    if (["Completed", "PartiallyCompleted", "Failed"].includes(result.status)) {
      stopHealthStatusPolling(true);
      healthSubmitButton.disabled = false;
      healthSubmitButton.textContent = "Run VM health diagnostic";
      return;
    }
  } catch (error) {
    healthValidationMessage.textContent =
      `Health status refresh failed: ${error.message}`;
  }

  healthStatusPollCount += 1;

  if (healthStatusPollCount >= HEALTH_STATUS_MAX_POLLS) {
    stopHealthStatusPolling(false);
    healthValidationMessage.textContent =
      "Automatic health status refresh stopped after 10 minutes. Keep the Request ID and refresh the page to resume polling.";
    healthSubmitButton.disabled = false;
    healthSubmitButton.textContent = "Run VM health diagnostic";
    return;
  }

  healthStatusPollTimer = window.setTimeout(
    () => pollHealthStatus(requestId),
    HEALTH_STATUS_POLL_INTERVAL_MS
  );
}

function startHealthStatusPolling(requestId) {
  stopHealthStatusPolling(false);
  currentHealthRequestId = requestId;

  try {
    sessionStorage.setItem("activeHealthRequestId", requestId);
  } catch {
    // Continue when browser storage is unavailable.
  }

  healthStatusPollCount = 0;
  pollHealthStatus(requestId);
}

healthTabButton.addEventListener("click", () => {
  activateOperationTab("health");
});

healthHostnamesInput.addEventListener(
  "input",
  updateHealthHostnameCount
);

healthClearButton.addEventListener("click", () => {
  stopHealthStatusPolling(true);
  healthForm.reset();
  healthValidationMessage.textContent = "";
  healthResultArea.hidden = true;
  healthResultArea.innerHTML = "";
  updateHealthHostnameCount();

  if (authenticatedPrincipal) {
    healthSubmitButton.disabled = false;
    healthSubmitButton.textContent = "Run VM health diagnostic";
  }
});

healthForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  healthValidationMessage.textContent = "";

  const payload = {
    hostnames: parseHostnames(healthHostnamesInput.value),
    periodMinutes: Number(healthPeriodMinutes.value)
  };

  const validationError = validateHealthForm(payload);

  if (validationError) {
    healthValidationMessage.textContent = validationError;
    return;
  }

  stopHealthStatusPolling(true);
  healthSubmitButton.disabled = true;
  healthSubmitButton.textContent = "Starting diagnostic…";
  healthResultArea.hidden = false;
  healthResultArea.innerHTML = `
    <div class="status-banner status-warning">
      <strong>Starting VM Health Diagnostic</strong>
      <span>Azure read-only checks are being submitted for ${escapeHtml(payload.hostnames.length)} VM(s).</span>
    </div>
  `;

  try {
    const response = await fetch("/api/submitHealthDiagnostic", {
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
        "/.auth/login/aad?post_login_redirect_uri=/portal.html%23health"
      );
      return;
    }

    if (!response.ok) {
      throw new Error(
        result?.message ||
        `Health diagnostic submission failed with HTTP ${response.status}.`
      );
    }

    renderHealthStatus(result);
    startHealthStatusPolling(result.requestId);
  } catch (error) {
    healthResultArea.hidden = false;
    healthResultArea.innerHTML = `
      <div class="status-banner status-error">
        <strong>VM Health Diagnostic could not be started</strong>
        <span>${escapeHtml(error.message)}</span>
      </div>
    `;
    healthSubmitButton.disabled = false;
    healthSubmitButton.textContent = "Run VM health diagnostic";
  }
});

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
        "/.auth/login/aad?post_login_redirect_uri=/portal.html"
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


snapshotHistoryRefreshButton.addEventListener(
  "click",
  () => {
    loadMySnapshotRequests(
      true
    );
  }
);

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
        "/.auth/login/aad?post_login_redirect_uri=/portal.html"
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
        "/.auth/login/aad?post_login_redirect_uri=/portal.html"
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

    loadMySnapshotRequests(
      false
    );

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

    healthSubmitButton.disabled = true;
    healthSubmitButton.textContent =
      "Authentication required";
  });

updateHostnameCount();
updateSnapshotHostnameCount();
updateSnapshotExpiryPreview();
updateBackupHostnameCount();
updateHealthHostnameCount();

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

try {
  const storedHealthRequestId =
    sessionStorage.getItem(
      "activeHealthRequestId"
    );

  if (storedHealthRequestId) {
    startHealthStatusPolling(
      storedHealthRequestId
    );
  }
} catch {
  // Continue without browser session storage.
}

const initialOperationTab =
  window.location.hash === "#snapshot"
    ? "snapshot"
    : window.location.hash === "#backup"
      ? "backup"
      : window.location.hash === "#health"
        ? "health"
        : "suppression";

activateOperationTab(
  initialOperationTab
);

