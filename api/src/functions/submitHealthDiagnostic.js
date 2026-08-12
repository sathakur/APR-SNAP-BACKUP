const { app } = require("@azure/functions");
const { randomUUID } = require("node:crypto");
const { writeHealthStatus } = require("../shared/healthStatusStore");

const MAX_HOSTNAMES = 1;
const ALLOWED_HOSTNAME = /^[A-Za-z0-9._-]{1,253}$/;
const ALLOWED_PERIODS = new Set([60, 180, 360, 1440]);

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
  const encoded = request.headers.get("x-ms-client-principal");
  if (!encoded) return null;

  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function validateAuthenticatedPrincipal(principal) {
  if (!principal) return "Microsoft Entra authentication is required.";

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

  if (hostnames.length < 1 || hostnames.length > MAX_HOSTNAMES) {
    return "Provide exactly 1 unique hostname per health diagnostic request.";
  }

  const invalidHostname = hostnames.find(
    (hostname) => !ALLOWED_HOSTNAME.test(hostname)
  );

  if (invalidHostname) {
    return `Invalid hostname: ${invalidHostname}.`;
  }

  const periodMinutes = Number(body.periodMinutes);
  if (!ALLOWED_PERIODS.has(periodMinutes)) {
    return "periodMinutes must be one of 60, 180, 360 or 1440.";
  }

  return "";
}

app.http("submitHealthDiagnostic", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "submitHealthDiagnostic",

  handler: async (request, context) => {
    const principal = getClientPrincipal(request);
    const principalError = validateAuthenticatedPrincipal(principal);

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

    const callbackUrl = process.env.HEALTH_LOGIC_APP_CALLBACK_URL;
    if (!callbackUrl) {
      return jsonResponse(500, {
        success: false,
        status: "ConfigurationError",
        message:
          "The portal API is not connected to the VM Health Diagnostic Logic App."
      });
    }

    const hostnames = normalizeHostnames(body.hostnames);
    const periodMinutes = Number(body.periodMinutes);
    const requesterUserName = String(principal.userDetails).trim();
    const requesterUserId = String(principal.userId).trim();
    const requestId = randomUUID();
    const submittedUtc = new Date().toISOString();

    const initialStatus = {
      requestId,
      requesterUserId,
      requesterUserName,
      status: "Submitted",
      message:
        "The VM health diagnostic request was submitted and is waiting for processing.",
      submittedUtc,
      completedUtc: null,
      periodMinutes,
      submittedCount: hostnames.length,
      successCount: 0,
      warningCount: 0,
      failureCount: 0,
      results: []
    };

    let statusBlobUrl;
    try {
      statusBlobUrl = await writeHealthStatus(requestId, initialStatus);
    } catch (error) {
      context.error("Unable to create the health status record.", error);
      return jsonResponse(500, {
        success: false,
        status: "StatusStoreUnavailable",
        message:
          "The VM health status store is not configured or could not be reached."
      });
    }

    const logicPayload = {
      requestId,
      submittedUtc,
      hostnames,
      periodMinutes,
      statusBlobUrl,
      requesterUserName,
      requesterUserId
    };

    let logicResponse;
    try {
      logicResponse = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(logicPayload),
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      context.error("VM Health Diagnostic Logic App request failed.", error);

      try {
        await writeHealthStatus(requestId, {
          ...initialStatus,
          status: "Failed",
          completedUtc: new Date().toISOString(),
          failureCount: hostnames.length,
          message: "The VM Health Diagnostic Logic App could not be reached."
        });
      } catch (statusError) {
        context.error("Unable to update failed health status.", statusError);
      }

      return jsonResponse(502, {
        success: false,
        status: "LogicAppUnavailable",
        requestId,
        message: "The VM Health Diagnostic Logic App could not be reached."
      });
    }

    if (!logicResponse.ok) {
      const responseText = await logicResponse.text();
      context.error(
        `VM Health Diagnostic Logic App returned HTTP ${logicResponse.status}: ${responseText}`
      );

      try {
        await writeHealthStatus(requestId, {
          ...initialStatus,
          status: "Failed",
          completedUtc: new Date().toISOString(),
          failureCount: hostnames.length,
          message: "The VM Health Diagnostic Logic App rejected the request.",
          details: responseText
        });
      } catch (statusError) {
        context.error("Unable to update rejected health status.", statusError);
      }

      return jsonResponse(502, {
        success: false,
        status: "LogicAppRejected",
        requestId,
        message: "The VM Health Diagnostic Logic App rejected the request."
      });
    }

    return jsonResponse(202, {
      success: true,
      status: "Accepted",
      requestId,
      submittedUtc,
      periodMinutes,
      submittedCount: hostnames.length,
      message:
        "The VM health diagnostic request was accepted. The portal will monitor it until the read-only checks complete."
    });
  }
});
