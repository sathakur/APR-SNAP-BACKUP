const { createHash } = require("node:crypto");

const STORAGE_API_VERSION = "2023-11-03";
const MAX_HISTORY_RECORDS = 100;
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

function normalizeUserId(userId) {
  const value =
    String(userId || "")
      .trim()
      .toLowerCase();

  if (!value) {
    throw new Error(
      "Authenticated user ID is required for backup request history."
    );
  }

  return value;
}

function getUserHash(userId) {
  return createHash("sha256")
    .update(
      normalizeUserId(userId),
      "utf8"
    )
    .digest("hex");
}

function buildHistoryBlobUrl(userId) {
  const sasUrl =
    new URL(
      getContainerSasUrl()
    );

  sasUrl.pathname =
    `${sasUrl.pathname.replace(/\/$/, "")}/request-history/${getUserHash(userId)}.json`;

  return sasUrl.toString();
}

async function readHistoryState(url) {
  const response =
    await fetch(
      url,
      {
        method: "GET",
        headers: {
          "x-ms-version":
            STORAGE_API_VERSION,
          Accept:
            "application/json"
        },
        cache: "no-store",
        signal:
          AbortSignal.timeout(
            15000
          )
      }
    );

  if (response.status === 404) {
    return {
      exists: false,
      etag: null,
      state: {
        version: 1,
        requests: []
      }
    };
  }

  if (!response.ok) {
    throw new Error(
      `Backup request history returned HTTP ${response.status}: ${await response.text()}`
    );
  }

  let state;

  try {
    state =
      await response.json();
  } catch {
    state = {
      version: 1,
      requests: []
    };
  }

  return {
    exists: true,
    etag:
      response.headers.get(
        "etag"
      ),
    state: {
      version: 1,
      requests:
        Array.isArray(
          state?.requests
        )
          ? state.requests
          : []
    }
  };
}

async function conditionalWriteHistory(
  url,
  state,
  exists,
  etag
) {
  const headers = {
    "x-ms-blob-type":
      "BlockBlob",
    "x-ms-version":
      STORAGE_API_VERSION,
    "Content-Type":
      "application/json; charset=utf-8"
  };

  if (exists && etag) {
    headers["If-Match"] =
      etag;
  } else {
    headers["If-None-Match"] =
      "*";
  }

  const response =
    await fetch(
      url,
      {
        method: "PUT",
        headers,
        body:
          JSON.stringify(
            state
          ),
        signal:
          AbortSignal.timeout(
            15000
          )
      }
    );

  if (
    response.status === 409 ||
    response.status === 412
  ) {
    return false;
  }

  if (!response.ok) {
    throw new Error(
      `Backup request history returned HTTP ${response.status}: ${await response.text()}`
    );
  }

  return true;
}

function sanitizeHistoryRecord(record) {
  return {
    requestId:
      String(
        record?.requestId || ""
      ).trim(),
    submittedUtc:
      String(
        record?.submittedUtc || ""
      ).trim(),
    hostnames:
      Array.isArray(
        record?.hostnames
      )
        ? record.hostnames
            .map(
              (value) =>
                String(value || "")
                  .trim()
                  .toUpperCase()
            )
            .filter(Boolean)
            .slice(0, 5)
        : [],
    changeNumber:
      String(
        record?.changeNumber || ""
      )
        .trim()
        .slice(0, 40)
  };
}

async function appendBackupRequestHistory(
  userId,
  record
) {
  const url =
    buildHistoryBlobUrl(
      userId
    );

  const sanitized =
    sanitizeHistoryRecord(
      record
    );

  if (
    !sanitized.requestId ||
    !sanitized.submittedUtc
  ) {
    throw new Error(
      "Backup request history record is incomplete."
    );
  }

  for (
    let attempt = 0;
    attempt <
      MAX_CONCURRENCY_RETRIES;
    attempt += 1
  ) {
    const current =
      await readHistoryState(
        url
      );

    const existing =
      current.state.requests
        .filter(
          (item) =>
            String(
              item?.requestId || ""
            ) !==
            sanitized.requestId
        );

    const requests = [
      sanitized,
      ...existing
    ]
      .sort(
        (a, b) =>
          Date.parse(
            b.submittedUtc || 0
          ) -
          Date.parse(
            a.submittedUtc || 0
          )
      )
      .slice(
        0,
        MAX_HISTORY_RECORDS
      );

    const nextState = {
      version: 1,
      updatedUtc:
        new Date()
          .toISOString(),
      requests
    };

    const written =
      await conditionalWriteHistory(
        url,
        nextState,
        current.exists,
        current.etag
      );

    if (written) {
      return;
    }
  }

  throw new Error(
    "Backup request history could not be updated because of concurrent changes."
  );
}

async function readBackupRequestHistory(
  userId
) {
  const current =
    await readHistoryState(
      buildHistoryBlobUrl(
        userId
      )
    );

  return current.state.requests
    .map(
      sanitizeHistoryRecord
    )
    .filter(
      (item) =>
        item.requestId
    )
    .sort(
      (a, b) =>
        Date.parse(
          b.submittedUtc || 0
        ) -
        Date.parse(
          a.submittedUtc || 0
        )
    );
}

module.exports = {
  appendBackupRequestHistory,
  readBackupRequestHistory
};
