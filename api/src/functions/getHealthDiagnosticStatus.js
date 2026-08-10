const { app } = require("@azure/functions");
const {
  readHealthStatus,
  validateHealthRequestId
} = require("../shared/healthStatusStore");

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
  const encoded = request.headers.get("x-ms-client-principal");
  if (!encoded) return null;

  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function isAuthenticated(principal) {
  return Boolean(
    principal &&
      principal.identityProvider === "aad" &&
      Array.isArray(principal.userRoles) &&
      principal.userRoles.includes("authenticated") &&
      String(principal.userId || "").trim()
  );
}

app.http("getHealthDiagnosticStatus", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "getHealthDiagnosticStatus",

  handler: async (request, context) => {
    const principal = getClientPrincipal(request);

    if (!isAuthenticated(principal)) {
      return jsonResponse(401, {
        success: false,
        status: "Unauthorized",
        message: "Microsoft Entra authentication is required."
      });
    }

    const requestId = String(request.query.get("requestId") || "")
      .trim()
      .toLowerCase();

    if (!validateHealthRequestId(requestId)) {
      return jsonResponse(400, {
        success: false,
        status: "InvalidRequestId",
        message: "A valid VM Health Diagnostic Request ID is required."
      });
    }

    let statusDocument;
    try {
      statusDocument = await readHealthStatus(requestId);
    } catch (error) {
      context.error(`Unable to read health status ${requestId}.`, error);
      return jsonResponse(503, {
        success: false,
        status: "StatusStoreUnavailable",
        message: "VM health diagnostic status is temporarily unavailable."
      });
    }

    if (!statusDocument) {
      return jsonResponse(404, {
        success: false,
        status: "NotFound",
        message: "VM health diagnostic request status was not found."
      });
    }

    if (
      String(statusDocument.requesterUserId || "") !==
      String(principal.userId)
    ) {
      return jsonResponse(404, {
        success: false,
        status: "NotFound",
        message: "VM health diagnostic request status was not found."
      });
    }

    const { requesterUserId: _requesterUserId, ...safeStatus } =
      statusDocument;

    return jsonResponse(200, {
      success: true,
      ...safeStatus
    });
  }
});
