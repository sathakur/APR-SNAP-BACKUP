const { createHash } = require("node:crypto");

const STORAGE_API_VERSION = "2023-11-03";
const MAX_REQUESTS_PER_WINDOW = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_CONCURRENCY_RETRIES = 6;

function getContainerSasUrl() {
  const value =
    process.env.BACKUP_STATUS_CONTAINER_SAS_URL;

  if (!value) {
    throw new Error(
      "BACKUP_STATUS_CONTAINER_SAS_URL is not configured."
    );
  }

  return value;
}

function buildRateLimitBlobUrl(userId) {
  const normalizedUserId =
    String(userId || "").trim().toLowerCase();

  if (!normalizedUserId) {
    throw new Error(
      "Authenticated user ID is required for backup request limiting."
    );
  }

  const userHash = createHash("sha256")
    .update(normalizedUserId, "utf8")
    .digest("hex");

  const sasUrl = new URL(getContainerSasUrl());

  sasUrl.pathname =
    `${sasUrl.pathname.replace(/\/$/, "")}/request-limits/${userHash}.json`;

  return sasUrl.toString();
}

function cleanRequestTimestamps(
  timestamps,
  nowMs
) {
  const cutoff = nowMs - WINDOW_MS;

  return (Array.isArray(timestamps) ? timestamps : [])
    .map((value) => Date.parse(value))
    .filter((value) =>
      Number.isFinite(value) &&
      value > cutoff &&
      value <= nowMs + 60_000
    )
    .sort((a, b) => a - b)
    .map((value) =>
      new Date(value).toISOString()
    );
}

async function readLimitState(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-ms-version": STORAGE_API_VERSION,
      Accept: "application/json"
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });

  if (response.status === 404) {
    return {
      exists: false,
      etag: null,
      state: {
        requestTimestampsUtc: []
      }
    };
  }

  if (!response.ok) {
    throw new Error(
      `Backup request-limit store returned HTTP ${response.status}: ${await response.text()}`
    );
  }

  let state;

  try {
    state = await response.json();
  } catch {
    state = {
      requestTimestampsUtc: []
    };
  }

  return {
    exists: true,
    etag: response.headers.get("etag"),
    state
  };
}

async function conditionalWriteLimitState(
  url,
  state,
  exists,
  etag
) {
  const headers = {
    "x-ms-blob-type": "BlockBlob",
    "x-ms-version": STORAGE_API_VERSION,
    "Content-Type":
      "application/json; charset=utf-8"
  };

  if (exists && etag) {
    headers["If-Match"] = etag;
  } else {
    headers["If-None-Match"] = "*";
  }

  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(state),
    signal: AbortSignal.timeout(15000)
  });

  if (
    response.status === 409 ||
    response.status === 412
  ) {
    return false;
  }

  if (!response.ok) {
    throw new Error(
      `Backup request-limit store returned HTTP ${response.status}: ${await response.text()}`
    );
  }

  return true;
}

async function reserveBackupRequest(userId) {
  const url = buildRateLimitBlobUrl(userId);

  for (
    let attempt = 0;
    attempt < MAX_CONCURRENCY_RETRIES;
    attempt += 1
  ) {
    const now = new Date();
    const nowMs = now.getTime();

    const current =
      await readLimitState(url);

    const active =
      cleanRequestTimestamps(
        current.state?.requestTimestampsUtc,
        nowMs
      );

    if (
      active.length >=
      MAX_REQUESTS_PER_WINDOW
    ) {
      return {
        allowed: false,
        requestsUsed: active.length,
        requestsRemaining: 0,
        retryAfterUtc: new Date(
          Date.parse(active[0]) + WINDOW_MS
        ).toISOString()
      };
    }

    const reservationUtc =
      now.toISOString();

    const updatedState = {
      version: 1,
      windowHours: 24,
      maximumRequests:
        MAX_REQUESTS_PER_WINDOW,
      requestTimestampsUtc: [
        ...active,
        reservationUtc
      ],
      updatedUtc: reservationUtc
    };

    const written =
      await conditionalWriteLimitState(
        url,
        updatedState,
        current.exists,
        current.etag
      );

    if (written) {
      return {
        allowed: true,
        requestsUsed:
          updatedState
            .requestTimestampsUtc.length,
        requestsRemaining:
          MAX_REQUESTS_PER_WINDOW -
          updatedState
            .requestTimestampsUtc.length,
        retryAfterUtc: null
      };
    }
  }

  throw new Error(
    "Unable to reserve the backup request quota because the rate-limit record changed repeatedly."
  );
}

module.exports = {
  MAX_REQUESTS_PER_WINDOW,
  reserveBackupRequest
};
