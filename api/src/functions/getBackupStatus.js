const { app } = require("@azure/functions");
const {
  readBackupStatus,
  validateBackupRequestId
} = require("../shared/backupStatusStore");

function jsonResponse(status, body) {
  return {
    status,
    headers: {
      "Content-Type":
        "application/json",
      "Cache-Control": "no-store"
    },
    jsonBody: body
  };
}

function getClientPrincipal(request) {
  const encoded =
    request.headers.get(
      "x-ms-client-principal"
    );

  if (!encoded) return null;

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

app.http("getBackupStatus", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "getBackupStatus",

  handler: async (
    request,
    context
  ) => {
    const principal =
      getClientPrincipal(request);

    if (!isAuthenticated(principal)) {
      return jsonResponse(401, {
        success: false,
        status: "Unauthorized",
        message:
          "Microsoft Entra authentication is required."
      });
    }

    const requestId =
      String(
        request.query.get(
          "requestId"
        ) || ""
      )
        .trim()
        .toLowerCase();

    if (
      !validateBackupRequestId(
        requestId
      )
    ) {
      return jsonResponse(400, {
        success: false,
        status:
          "InvalidRequestId",
        message:
          "A valid VM Backup Request ID is required."
      });
    }

    let statusDocument;

    try {
      statusDocument =
        await readBackupStatus(
          requestId
        );
    } catch (error) {
      context.error(
        `Unable to read backup status ${requestId}.`,
        error
      );

      return jsonResponse(503, {
        success: false,
        status:
          "StatusStoreUnavailable",
        message:
          "VM backup status is temporarily unavailable."
      });
    }

    if (!statusDocument) {
      return jsonResponse(404, {
        success: false,
        status: "NotFound",
        message:
          "VM backup request status was not found."
      });
    }

    if (
      String(
        statusDocument
          .requesterUserId || ""
      ) !==
      String(
        principal.userId
      )
    ) {
      return jsonResponse(404, {
        success: false,
        status: "NotFound",
        message:
          "VM backup request status was not found."
      });
    }

    const {
      requesterUserId:
        _requesterUserId,
      ...safeStatus
    } = statusDocument;

    return jsonResponse(200, {
      success: true,
      ...safeStatus
    });
  }
});
