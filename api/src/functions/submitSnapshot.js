const { app } = require("@azure/functions");
const { randomUUID } = require("node:crypto");
const {
  buildStatusBlobUrls,
  writeSnapshotStatus
} = require("../shared/snapshotStatusStore");
const {
  reserveSnapshotRequest
} = require("../shared/snapshotRequestLimiter");
const {
  appendSnapshotRequestHistory
} = require("../shared/snapshotRequestHistoryStore");

const MAX_HOSTNAMES = 5;
const ALLOWED_HOSTNAME = /^[A-Za-z0-9._-]{1,253}$/;
const ALLOWED_CHANGE_NUMBER = /^[A-Za-z0-9._-]{1,40}$/;
const ALLOWED_SCOPES = new Set(["OSOnly", "AllDisks"]);
const ALLOWED_RETENTION_DAYS = new Set([1, 3, 7, 14]);

function jsonResponse(status, body, extraHeaders = {}) {
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
        .filter((value) => typeof value === "string")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
    )
  ];
}

function getClientPrincipal(request) {
  const encodedPrincipal =
    request.headers.get("x-ms-client-principal");

  if (!encodedPrincipal) {
    return null;
  }

  try {
    const decodedPrincipal = Buffer
      .from(encodedPrincipal, "base64")
      .toString("utf8");

    return JSON.parse(decodedPrincipal);
  } catch {
    return null;
  }
}

function validateAuthenticatedPrincipal(principal) {
  if (!principal || typeof principal !== "object") {
    return "Microsoft Entra authentication is required.";
  }

  if (
    principal.identityProvider !== "aad" ||
    !Array.isArray(principal.userRoles) ||
    !principal.userRoles.includes("authenticated")
  ) {
    return "A valid Microsoft Entra authenticated session is required.";
  }

  if (
    !String(principal.userDetails || "").trim() ||
    !String(principal.userId || "").trim()
  ) {
    return "The authenticated requester identity could not be resolved.";
  }

  return "";
}

function validatePayload(body) {
  if (!body || typeof body !== "object") {
    return "Request body must be a JSON object.";
  }

  if (!Array.isArray(body.hostnames)) {
    return "hostnames must be an array.";
  }

  const hostnames = normalizeHostnames(body.hostnames);

  if (
    hostnames.length < 1 ||
    hostnames.length > MAX_HOSTNAMES
  ) {
    return `Provide between 1 and ${MAX_HOSTNAMES} unique hostnames per snapshot request.`;
  }

  const invalidHostname = hostnames.find(
    (hostname) => !ALLOWED_HOSTNAME.test(hostname)
  );

  if (invalidHostname) {
    return `Invalid hostname: ${invalidHostname}.`;
  }

  if (!ALLOWED_SCOPES.has(body.snapshotScope)) {
    return "snapshotScope must be OSOnly or AllDisks.";
  }

  const retentionDays = Number(body.retentionDays);

  if (!ALLOWED_RETENTION_DAYS.has(retentionDays)) {
    return "retentionDays must be one of 1, 3, 7 or 14.";
  }

  const changeNumber =
    String(body.changeNumber || "").trim();

  if (!ALLOWED_CHANGE_NUMBER.test(changeNumber)) {
    return (
      "changeNumber may contain only letters, numbers, " +
      "full stops, underscores and hyphens."
    );
  }

  const reason = String(body.reason || "").trim();

  if (!reason || reason.length > 500) {
    return "reason is required and cannot exceed 500 characters.";
  }

  return "";
}

app.http("submitSnapshot", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "submitSnapshot",
  handler: async (request, context) => {
    const principal = getClientPrincipal(request);
    const principalError =
      validateAuthenticatedPrincipal(principal);

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
        message: "The request body is not valid JSON."
      });
    }

    const validationError = validatePayload(body);

    if (validationError) {
      return jsonResponse(400, {
        success: false,
        status: "InvalidRequest",
        message: validationError
      });
    }

    const callbackUrl =
      process.env.SNAPSHOT_LOGIC_APP_CALLBACK_URL;

    if (!callbackUrl) {
      context.error(
        "SNAPSHOT_LOGIC_APP_CALLBACK_URL is not configured."
      );

      return jsonResponse(500, {
        success: false,
        status: "ConfigurationError",
        message:
          "The portal API is not connected to the Snapshot Logic App."
      });
    }

    const hostnames =
      normalizeHostnames(body.hostnames);

    const requestId = randomUUID();
    const submittedAt = new Date();
    const retentionDays = Number(body.retentionDays);
    const expiresUtc = new Date(
      submittedAt.getTime() +
      retentionDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const snapshotScopeLabel =
      body.snapshotScope === "AllDisks"
        ? "OS disk and all data disks"
        : "OS disk only";

    const authenticatedRequesterName =
      String(principal.userDetails).trim();

    const authenticatedRequesterId =
      String(principal.userId).trim();

    let requestQuota;

    try {
      requestQuota = await reserveSnapshotRequest(
        authenticatedRequesterId
      );
    } catch (error) {
      context.error(
        "Unable to evaluate the snapshot request quota.",
        error
      );

      return jsonResponse(503, {
        success: false,
        status: "RequestLimitUnavailable",
        message:
          "The snapshot request limit service could not be reached. Please try again later."
      });
    }

    if (!requestQuota.allowed) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(
          (
            Date.parse(requestQuota.retryAfterUtc) -
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
            "You have reached the limit of 3 snapshot requests in a rolling 24-hour period.",
          requestsUsed:
            requestQuota.requestsUsed,
          requestsRemaining: 0,
          retryAfterUtc:
            requestQuota.retryAfterUtc
        },
        {
          "Retry-After":
            String(retryAfterSeconds)
        }
      );
    }

    const initialStatus = {
      requestId,
      requesterUserId: authenticatedRequesterId,
      requesterUserName: authenticatedRequesterName,
      status: "Submitted",
      message: "The snapshot request was submitted and is waiting for processing.",
      submittedUtc: submittedAt.toISOString(),
      completedUtc: null,
      submittedCount: hostnames.length,
      snapshotScope: body.snapshotScope,
      snapshotScopeLabel,
      retentionDays,
      expiresUtc,
      successCount: 0,
      failureCount: 0,
      snapshotCount: 0,
      requestsUsedInLast24Hours:
        requestQuota.requestsUsed,
      requestsRemainingInLast24Hours:
        requestQuota.requestsRemaining,
      results: []
    };

    let statusBlobUrl;

    try {
      statusBlobUrl = await writeSnapshotStatus(
        requestId,
        initialStatus
      );
    } catch (error) {
      context.error(
        "Unable to create the snapshot request status record.",
        error
      );

      return jsonResponse(500, {
        success: false,
        status: "StatusStoreUnavailable",
        message:
          "The snapshot status store is not configured or could not be reached."
      });
    }

    let historyTracked = true;

    try {
      await appendSnapshotRequestHistory(
        authenticatedRequesterId,
        {
          requestId,
          submittedUtc: submittedAt.toISOString(),
          hostnames,
          changeNumber:
            String(body.changeNumber)
              .trim()
              .toUpperCase(),
          snapshotScope: body.snapshotScope,
          snapshotScopeLabel,
          retentionDays
        }
      );
    } catch (error) {
      historyTracked = false;

      context.warn(
        `Unable to add snapshot request ${requestId} to My Snapshot Requests.`,
        error
      );
    }

    const logicAppPayload = {
      requestId,
      submittedUtc: submittedAt.toISOString(),
      hostnames,
      snapshotScope: body.snapshotScope,
      retentionDays,
      expiresUtc,
      statusBlobUrl,
      changeNumber:
        String(body.changeNumber).trim().toUpperCase(),
      reason: String(body.reason).trim(),
      requesterName: authenticatedRequesterName,
      requesterUserName: authenticatedRequesterName,
      requesterUserId: authenticatedRequesterId
    };

    context.log(
      `Submitting snapshot request ${requestId} for ` +
      `${hostnames.length} VM(s).`
    );

    let logicAppResponse;

    try {
      logicAppResponse = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(logicAppPayload),
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      context.error(
        "Snapshot Logic App request failed.",
        error
      );

      try {
        await writeSnapshotStatus(requestId, {
          ...initialStatus,
          status: "Failed",
          completedUtc: new Date().toISOString(),
          failureCount: hostnames.length,
          message:
            "The Snapshot Logic App could not be reached."
        });
      } catch (statusError) {
        context.error(
          "Unable to update failed snapshot request status.",
          statusError
        );
      }

      return jsonResponse(502, {
        success: false,
        status: "LogicAppUnavailable",
        requestId,
        message:
          "The Snapshot Logic App could not be reached.",
        details: error.message
      });
    }

    if (!logicAppResponse.ok) {
      const responseText =
        await logicAppResponse.text();

      context.error(
        `Snapshot Logic App returned HTTP ` +
        `${logicAppResponse.status}: ${responseText}`
      );

      try {
        await writeSnapshotStatus(requestId, {
          ...initialStatus,
          status: "Failed",
          completedUtc: new Date().toISOString(),
          failureCount: hostnames.length,
          message:
            "The Snapshot Logic App rejected the request.",
          details: responseText
        });
      } catch (statusError) {
        context.error(
          "Unable to update rejected snapshot request status.",
          statusError
        );
      }

      return jsonResponse(502, {
        success: false,
        status: "LogicAppRejected",
        requestId,
        message:
          "The Snapshot Logic App rejected the request.",
        logicAppStatus: logicAppResponse.status,
        details: responseText
      });
    }

    return jsonResponse(202, {
      success: true,
      status: "Accepted",
      requestId,
      submittedCount: body.hostnames.length,
      uniqueCount: hostnames.length,
      snapshotScope: body.snapshotScope,
      snapshotScopeLabel,
      retentionDays,
      expiresUtc,
      requestsUsedInLast24Hours:
        requestQuota.requestsUsed,
      requestsRemainingInLast24Hours:
        requestQuota.requestsRemaining,
      historyTracked,
      message:
        historyTracked
          ? "The snapshot request was accepted. The portal will monitor it until snapshot creation completes or fails."
          : "The snapshot request was accepted, but it could not be added to My Snapshot Requests. Keep the Request ID for status tracking."
    });
  }
});
