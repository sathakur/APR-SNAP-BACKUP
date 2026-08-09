const { app } = require("@azure/functions");
const {
  readBackupRequestHistory
} = require("../shared/backupRequestHistoryStore");
const {
  readBackupStatus
} = require("../shared/backupStatusStore");

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 5;

function jsonResponse(
  status,
  body
) {
  return {
    status,
    headers: {
      "Content-Type":
        "application/json",
      "Cache-Control":
        "no-store"
    },
    jsonBody: body
  };
}

function getClientPrincipal(
  request
) {
  const encoded =
    request.headers.get(
      "x-ms-client-principal"
    );

  if (!encoded) {
    return null;
  }

  try {
    return JSON.parse(
      Buffer.from(
        encoded,
        "base64"
      ).toString("utf8")
    );
  } catch {
    return null;
  }
}

function isAuthenticated(
  principal
) {
  return Boolean(
    principal &&
    principal.identityProvider ===
      "aad" &&
    Array.isArray(
      principal.userRoles
    ) &&
    principal.userRoles.includes(
      "authenticated"
    ) &&
    String(
      principal.userId || ""
    ).trim()
  );
}

function clampLimit(value) {
  const parsed =
    Number.parseInt(
      String(value || ""),
      10
    );

  if (
    !Number.isFinite(parsed)
  ) {
    return DEFAULT_LIMIT;
  }

  return Math.min(
    MAX_LIMIT,
    Math.max(
      1,
      parsed
    )
  );
}

function getHostnamesFromStatus(
  statusDocument
) {
  const values =
    Array.isArray(
      statusDocument?.results
    )
      ? statusDocument.results
          .map(
            (item) =>
              String(
                item?.hostname || ""
              )
                .trim()
                .toUpperCase()
          )
          .filter(Boolean)
      : [];

  return [
    ...new Set(values)
  ].slice(0, 5);
}

app.http("getMyBackupRequests", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "getMyBackupRequests",

  handler: async (
    request,
    context
  ) => {
    const principal =
      getClientPrincipal(
        request
      );

    if (
      !isAuthenticated(
        principal
      )
    ) {
      return jsonResponse(
        401,
        {
          success: false,
          status:
            "Unauthorized",
          message:
            "Microsoft Entra authentication is required."
        }
      );
    }

    const requesterUserId =
      String(
        principal.userId
      ).trim();

    const limit =
      clampLimit(
        request.query.get(
          "limit"
        )
      );

    let history;

    try {
      history =
        await readBackupRequestHistory(
          requesterUserId
        );
    } catch (error) {
      context.error(
        "Unable to read My Backup Requests index.",
        error
      );

      return jsonResponse(
        503,
        {
          success: false,
          status:
            "HistoryUnavailable",
          message:
            "My Backup Requests is temporarily unavailable."
        }
      );
    }

    const selected =
      history.slice(
        0,
        limit
      );

    const requests =
      await Promise.all(
        selected.map(
          async (record) => {
            let statusDocument =
              null;

            try {
              statusDocument =
                await readBackupStatus(
                  record.requestId
                );
            } catch (error) {
              context.warn(
                `Unable to read backup status ${record.requestId} while loading My Backup Requests.`,
                error
              );
            }

            const owned =
              statusDocument &&
              String(
                statusDocument
                  .requesterUserId || ""
              ) ===
                requesterUserId;

            if (
              statusDocument &&
              !owned
            ) {
              return null;
            }

            const status =
              owned
                ? statusDocument
                    .status ||
                  "Unknown"
                : "Unknown";

            const hostnames =
              record.hostnames
                .length
                ? record.hostnames
                : getHostnamesFromStatus(
                    statusDocument
                  );

            return {
              requestId:
                record.requestId,
              hostnames,
              changeNumber:
                record.changeNumber,
              submittedUtc:
                owned
                  ? statusDocument
                      .submittedUtc ||
                    record.submittedUtc
                  : record.submittedUtc,
              completedUtc:
                owned
                  ? statusDocument
                      .completedUtc ||
                    null
                  : null,
              status,
              submittedCount:
                owned
                  ? statusDocument
                      .submittedCount ??
                    hostnames.length
                  : hostnames.length,
              successCount:
                owned
                  ? statusDocument
                      .successCount ??
                    statusDocument
                      .backupCount ??
                    0
                  : 0,
              failureCount:
                owned
                  ? statusDocument
                      .failureCount ??
                    0
                  : 0,
              message:
                owned
                  ? statusDocument
                      .message || ""
                  : "Backup status is temporarily unavailable."
            };
          }
        )
      );

    const safeRequests =
      requests
        .filter(Boolean)
        .sort(
          (a, b) =>
            Date.parse(
              b.submittedUtc || 0
            ) -
            Date.parse(
              a.submittedUtc || 0
            )
        );

    return jsonResponse(
      200,
      {
        success: true,
        count:
          safeRequests.length,
        requests:
          safeRequests
      }
    );
  }
});
