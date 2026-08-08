const { app } = require("@azure/functions");
const { randomUUID } = require("node:crypto");
const {
  writeBackupStatus
} = require("../shared/backupStatusStore");
const {
  reserveBackupRequest
} = require("../shared/backupRequestLimiter");

const MAX_HOSTNAMES = 5;
const ALLOWED_HOSTNAME =
  /^[A-Za-z0-9._-]{1,253}$/;
const ALLOWED_CHANGE_NUMBER =
  /^[A-Za-z0-9._-]{1,40}$/;

function jsonResponse(
  status,
  body,
  extraHeaders = {}
) {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders
    },
    jsonBody: body
  };
}

function normalizeHostnames(values) {
  return [
    ...new Set(
      values
        .filter(
          (value) =>
            typeof value === "string"
        )
        .map(
          (value) =>
            value.trim().toUpperCase()
        )
        .filter(Boolean)
    )
  ];
}

function getClientPrincipal(request) {
  const encoded =
    request.headers.get(
      "x-ms-client-principal"
    );

  if (!encoded) return null;

  try {
    return JSON.parse(
      Buffer.from(encoded, "base64")
        .toString("utf8")
    );
  } catch {
    return null;
  }
}

function validateAuthenticatedPrincipal(
  principal
) {
  if (!principal) {
    return "Microsoft Entra authentication is required.";
  }

  if (
    principal.identityProvider !== "aad" ||
    !Array.isArray(principal.userRoles) ||
    !principal.userRoles.includes(
      "authenticated"
    )
  ) {
    return "A valid Microsoft Entra authenticated session is required.";
  }

  if (
    !String(
      principal.userDetails || ""
    ).trim() ||
    !String(
      principal.userId || ""
    ).trim()
  ) {
    return "The authenticated requester identity could not be resolved.";
  }

  return "";
}

function validatePayload(body) {
  if (
    !body ||
    typeof body !== "object"
  ) {
    return "Request body must be a JSON object.";
  }

  if (!Array.isArray(body.hostnames)) {
    return "hostnames must be an array.";
  }

  const hostnames =
    normalizeHostnames(body.hostnames);

  if (
    hostnames.length < 1 ||
    hostnames.length > MAX_HOSTNAMES
  ) {
    return `Provide between 1 and ${MAX_HOSTNAMES} unique hostnames per backup request.`;
  }

  const invalidHostname =
    hostnames.find(
      (hostname) =>
        !ALLOWED_HOSTNAME.test(hostname)
    );

  if (invalidHostname) {
    return `Invalid hostname: ${invalidHostname}.`;
  }

  const changeNumber =
    String(
      body.changeNumber || ""
    ).trim();

  if (
    !ALLOWED_CHANGE_NUMBER.test(
      changeNumber
    )
  ) {
    return (
      "Change / incident number may contain only letters, numbers, " +
      "full stops, underscores and hyphens."
    );
  }

  const reason =
    String(body.reason || "").trim();

  if (
    !reason ||
    reason.length > 500
  ) {
    return "reason is required and cannot exceed 500 characters.";
  }

  return "";
}

app.http("submitBackup", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "submitBackup",

  handler: async (
    request,
    context
  ) => {
    const principal =
      getClientPrincipal(request);

    const principalError =
      validateAuthenticatedPrincipal(
        principal
      );

    if (principalError) {
      return jsonResponse(401, {
        success: false,
        status: "Unauthorized",
        message: principalError
      });
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, {
        success: false,
        status: "InvalidJson",
        message:
          "The request body is not valid JSON."
      });
    }

    const validationError =
      validatePayload(body);

    if (validationError) {
      return jsonResponse(400, {
        success: false,
        status: "InvalidRequest",
        message: validationError
      });
    }

    const callbackUrl =
      process.env
        .BACKUP_LOGIC_APP_CALLBACK_URL;

    if (!callbackUrl) {
      return jsonResponse(500, {
        success: false,
        status: "ConfigurationError",
        message:
          "The portal API is not connected to the VM Backup Logic App."
      });
    }

    const hostnames =
      normalizeHostnames(
        body.hostnames
      );

    const requesterUserName =
      String(
        principal.userDetails
      ).trim();

    const requesterUserId =
      String(
        principal.userId
      ).trim();

    let requestQuota;

    try {
      requestQuota =
        await reserveBackupRequest(
          requesterUserId
        );
    } catch (error) {
      context.error(
        "Unable to evaluate the backup request quota.",
        error
      );

      return jsonResponse(503, {
        success: false,
        status:
          "RequestLimitUnavailable",
        message:
          "The backup request limit service could not be reached. Please try again later."
      });
    }

    if (!requestQuota.allowed) {
      const retryAfterSeconds =
        Math.max(
          1,
          Math.ceil(
            (
              Date.parse(
                requestQuota.retryAfterUtc
              ) -
              Date.now()
            ) / 1000
          )
        );

      return jsonResponse(
        429,
        {
          success: false,
          status: "RateLimited",
          message:
            "You have reached the limit of 3 backup requests in a rolling 24-hour period.",
          requestsUsed:
            requestQuota.requestsUsed,
          requestsRemaining: 0,
          retryAfterUtc:
            requestQuota.retryAfterUtc
        },
        {
          "Retry-After":
            String(
              retryAfterSeconds
            )
        }
      );
    }

    const requestId =
      randomUUID();

    const submittedUtc =
      new Date().toISOString();

    const initialStatus = {
      requestId,
      requesterUserId,
      requesterUserName,
      status: "Submitted",
      message:
        "The VM backup request was submitted and is waiting for processing.",
      submittedUtc,
      completedUtc: null,
      submittedCount:
        hostnames.length,
      successCount: 0,
      failureCount: 0,
      backupCount: 0,
      requestsUsedInLast24Hours:
        requestQuota.requestsUsed,
      requestsRemainingInLast24Hours:
        requestQuota.requestsRemaining,
      results: []
    };

    let statusBlobUrl;

    try {
      statusBlobUrl =
        await writeBackupStatus(
          requestId,
          initialStatus
        );
    } catch (error) {
      context.error(
        "Unable to create the backup status record.",
        error
      );

      return jsonResponse(500, {
        success: false,
        status:
          "StatusStoreUnavailable",
        message:
          "The backup status store is not configured or could not be reached."
      });
    }

    const logicPayload = {
      requestId,
      submittedUtc,
      hostnames,
      changeNumber:
        String(
          body.changeNumber
        )
          .trim()
          .toUpperCase(),
      reason:
        String(
          body.reason
        ).trim(),
      statusBlobUrl,
      requesterName:
        requesterUserName,
      requesterUserName,
      requesterUserId
    };

    let logicResponse;

    try {
      logicResponse =
        await fetch(
          callbackUrl,
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
                logicPayload
              ),
            signal:
              AbortSignal.timeout(
                20000
              )
          }
        );
    } catch (error) {
      context.error(
        "VM Backup Logic App request failed.",
        error
      );

      try {
        await writeBackupStatus(
          requestId,
          {
            ...initialStatus,
            status: "Failed",
            completedUtc:
              new Date()
                .toISOString(),
            failureCount:
              hostnames.length,
            message:
              "The VM Backup Logic App could not be reached."
          }
        );
      } catch (statusError) {
        context.error(
          "Unable to update failed backup status.",
          statusError
        );
      }

      return jsonResponse(502, {
        success: false,
        status:
          "LogicAppUnavailable",
        requestId,
        message:
          "The VM Backup Logic App could not be reached."
      });
    }

    if (!logicResponse.ok) {
      const responseText =
        await logicResponse.text();

      context.error(
        `VM Backup Logic App returned HTTP ${logicResponse.status}: ${responseText}`
      );

      try {
        await writeBackupStatus(
          requestId,
          {
            ...initialStatus,
            status: "Failed",
            completedUtc:
              new Date()
                .toISOString(),
            failureCount:
              hostnames.length,
            message:
              "The VM Backup Logic App rejected the request.",
            details:
              responseText
          }
        );
      } catch (statusError) {
        context.error(
          "Unable to update rejected backup request status.",
          statusError
        );
      }

      return jsonResponse(502, {
        success: false,
        status:
          "LogicAppRejected",
        requestId,
        message:
          "The VM Backup Logic App rejected the request."
      });
    }

    return jsonResponse(202, {
      success: true,
      status: "Accepted",
      requestId,
      submittedUtc,
      submittedCount:
        hostnames.length,
      requestsUsedInLast24Hours:
        requestQuota.requestsUsed,
      requestsRemainingInLast24Hours:
        requestQuota.requestsRemaining,
      message:
        "The VM backup request was accepted. The portal will monitor it until Azure Backup completes or fails."
    });
  }
});
