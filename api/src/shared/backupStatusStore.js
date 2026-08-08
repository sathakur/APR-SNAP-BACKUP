const STORAGE_API_VERSION = "2023-11-03";

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

function validateBackupRequestId(requestId) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(requestId || ""));
}

function buildBackupStatusBlobUrls(requestId) {
  if (!validateBackupRequestId(requestId)) {
    throw new Error("Invalid backup request ID.");
  }

  const sasUrl = new URL(getContainerSasUrl());

  sasUrl.pathname =
    `${sasUrl.pathname.replace(/\/$/, "")}/${encodeURIComponent(requestId)}.json`;

  const authenticatedUrl = sasUrl.toString();

  sasUrl.search = "";

  return {
    authenticatedUrl,
    plainUrl: sasUrl.toString()
  };
}

async function writeBackupStatus(
  requestId,
  statusDocument
) {
  const {
    authenticatedUrl,
    plainUrl
  } = buildBackupStatusBlobUrls(requestId);

  const response = await fetch(
    authenticatedUrl,
    {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "x-ms-version": STORAGE_API_VERSION,
        "Content-Type":
          "application/json; charset=utf-8"
      },
      body: JSON.stringify(statusDocument),
      signal: AbortSignal.timeout(15000)
    }
  );

  if (!response.ok) {
    const details = await response.text();

    throw new Error(
      `Backup status store returned HTTP ${response.status}: ${details}`
    );
  }

  return plainUrl;
}

async function readBackupStatus(requestId) {
  const {
    authenticatedUrl
  } = buildBackupStatusBlobUrls(requestId);

  const response = await fetch(
    authenticatedUrl,
    {
      method: "GET",
      headers: {
        "x-ms-version": STORAGE_API_VERSION,
        Accept: "application/json"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const details = await response.text();

    throw new Error(
      `Backup status store returned HTTP ${response.status}: ${details}`
    );
  }

  return response.json();
}

module.exports = {
  buildBackupStatusBlobUrls,
  readBackupStatus,
  validateBackupRequestId,
  writeBackupStatus
};
