const { app } = require("@azure/functions");

const MAX_HOSTNAMES = 5;
const ALLOWED_HOSTNAME = /^[A-Za-z0-9._-]{1,253}$/;

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
  const encoded =
    request.headers.get("x-ms-client-principal");

  if (!encoded) return null;

  try {
    return JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8")
    );
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

function normalizeHostnames(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .filter((value) => typeof value === "string")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
    )
  ];
}

app.http("checkBackupStatus", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "checkBackupStatus",

  handler: async (request, context) => {
    const principal = getClientPrincipal(request);

    if (!isAuthenticated(principal)) {
      return jsonResponse(401, {
        success: false,
        status: "Unauthorized",
        message: "Microsoft Entra authentication is required."
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

    const hostnames = normalizeHostnames(body?.hostnames);

    if (hostnames.length < 1 || hostnames.length > MAX_HOSTNAMES) {
      return jsonResponse(400, {
        success: false,
        status: "InvalidRequest",
        message: `Provide between 1 and ${MAX_HOSTNAMES} unique hostnames.`
      });
    }

    const invalidHostname =
      hostnames.find((hostname) => !ALLOWED_HOSTNAME.test(hostname));

    if (invalidHostname) {
      return jsonResponse(400, {
        success: false,
        status: "InvalidRequest",
        message: `Invalid hostname: ${invalidHostname}.`
      });
    }

    const callbackUrl =
      process.env.BACKUP_CHECK_LOGIC_APP_CALLBACK_URL;

    if (!callbackUrl) {
      return jsonResponse(500, {
        success: false,
        status: "ConfigurationError",
        message:
          "The portal API is not connected to the VM Backup Status Logic App."
      });
    }

    try {
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          hostnames,
          requesterUserId: String(principal.userId || "").trim(),
          requesterUserName: String(principal.userDetails || "").trim()
        }),
        signal: AbortSignal.timeout(40000)
      });

      const text = await response.text();

      let result;

      try {
        result = text ? JSON.parse(text) : {};
      } catch {
        result = {
          success: false,
          status: "InvalidResponse",
          message: text || "The VM Backup Status Logic App returned an invalid response."
        };
      }

      if (!response.ok) {
        context.error(
          `VM Backup Status Logic App returned HTTP ${response.status}: ${text}`
        );

        return jsonResponse(response.status >= 400 && response.status < 600
          ? response.status
          : 502, {
          success: false,
          status: result.status || "StatusCheckFailed",
          message:
            result.message ||
            "The VM Backup Status Logic App could not complete the status check.",
          details: result.details
        });
      }

      return jsonResponse(200, {
        success: true,
        ...result
      });
    } catch (error) {
      context.error("VM Backup status check failed.", error);

      return jsonResponse(502, {
        success: false,
        status: "StatusCheckUnavailable",
        message:
          "The VM Backup status service could not be reached. Please try again."
      });
    }
  }
});
