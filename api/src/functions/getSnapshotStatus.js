const { app } = require("@azure/functions");
const {
  readSnapshotStatus,
  validateRequestId
} = require("../shared/snapshotStatusStore");

function jsonResponse(status, body) {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    jsonBody: body
  };
}

function getClientPrincipal(request) {
  const encodedPrincipal =
    request.headers.get("x-ms-client-principal");

  if (!encodedPrincipal) {
    return null;
  }

  try {
    return JSON.parse(
      Buffer.from(encodedPrincipal, "base64")
        .toString("utf8")
    );
  } catch {
    return null;
  }
}

function isAuthenticatedEntraPrincipal(principal) {
  return Boolean(
    principal &&
    principal.identityProvider === "aad" &&
    Array.isArray(principal.userRoles) &&
    principal.userRoles.includes("authenticated") &&
    String(principal.userId || "").trim()
  );
}

app.http("getSnapshotStatus", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "getSnapshotStatus",
  handler: async (request, context) => {
    const principal = getClientPrincipal(request);

    if (!isAuthenticatedEntraPrincipal(principal)) {
      return jsonResponse(401, {
        success: false,
        status: "Unauthorized",
        message: "Microsoft Entra authentication is required."
      });
    }

    const requestId =
      String(request.query.get("requestId") || "")
        .trim()
        .toLowerCase();

    if (!validateRequestId(requestId)) {
      return jsonResponse(400, {
        success: false,
        status: "InvalidRequestId",
        message: "A valid snapshot Request ID is required."
      });
    }

    let statusDocument;

    try {
      statusDocument =
        await readSnapshotStatus(requestId);
    } catch (error) {
      context.error(
        `Unable to read snapshot status ${requestId}.`,
        error
      );

      return jsonResponse(503, {
        success: false,
        status: "StatusStoreUnavailable",
        message:
          "Snapshot status is temporarily unavailable."
      });
    }

    if (!statusDocument) {
      return jsonResponse(404, {
        success: false,
        status: "NotFound",
        message: "Snapshot request status was not found."
      });
    }

    const requesterUserId =
      String(statusDocument.requesterUserId || "");

    if (
      requesterUserId !== String(principal.userId)
    ) {
      // Do not reveal whether another user's request exists.
      return jsonResponse(404, {
        success: false,
        status: "NotFound",
        message: "Snapshot request status was not found."
      });
    }

    const {
      requesterUserId: _requesterUserId,
      ...safeStatus
    } = statusDocument;

    return jsonResponse(200, {
      success: true,
      ...safeStatus
    });
  }
});
