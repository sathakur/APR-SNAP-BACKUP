const { app } = require("@azure/functions");

const MAX_HOSTNAMES = 20;
const FIXED_TIME_ZONE = "W. Europe Standard Time";
const IANA_TIME_ZONE = "Europe/Amsterdam";
const ALLOWED_HOSTNAME = /^[A-Za-z0-9._-]{1,253}$/;
const MINIMUM_LEAD_MINUTES = 45;
const MAXIMUM_DURATION_HOURS = 24;

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

function getCentralEuropeanParts(date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: IANA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function getCentralEuropeanOffsetMilliseconds(date) {
  const parts = getCentralEuropeanParts(date);

  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return representedAsUtc - date.getTime();
}

function parseCentralEuropeanDateTime(value) {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) return null;

  const [, year, month, day, hour, minute, second = "0"] = match;

  const expected = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second)
  };

  const localFieldsAsUtc = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
    expected.second
  );

  let utcMilliseconds = localFieldsAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offset = getCentralEuropeanOffsetMilliseconds(
      new Date(utcMilliseconds)
    );

    const adjusted = localFieldsAsUtc - offset;

    if (Math.abs(adjusted - utcMilliseconds) < 1000) {
      utcMilliseconds = adjusted;
      break;
    }

    utcMilliseconds = adjusted;
  }

  const actual = getCentralEuropeanParts(
    new Date(utcMilliseconds)
  );

  const isValid =
    actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hour === expected.hour &&
    actual.minute === expected.minute &&
    actual.second === expected.second;

  return isValid ? utcMilliseconds : null;
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

  for (const field of [
    "startDateTime",
    "endDateTime",
    "changeNumber",
    "reason"
  ]) {
    if (
      typeof body[field] !== "string" ||
      !body[field].trim()
    ) {
      return `${field} is required.`;
    }
  }

  if (!Array.isArray(body.hostnames)) {
    return "hostnames must be an array.";
  }

  const hostnames = normalizeHostnames(body.hostnames);

  if (
    hostnames.length < 1 ||
    hostnames.length > MAX_HOSTNAMES
  ) {
    return `Provide between 1 and ${MAX_HOSTNAMES} unique hostnames.`;
  }

  const invalidHostname = hostnames.find(
    (hostname) => !ALLOWED_HOSTNAME.test(hostname)
  );

  if (invalidHostname) {
    return `Invalid hostname: ${invalidHostname}.`;
  }

  if (body.timeZone !== FIXED_TIME_ZONE) {
    return "Only Central European Time is allowed.";
  }

  const startMilliseconds = parseCentralEuropeanDateTime(body.startDateTime);
  const endMilliseconds = parseCentralEuropeanDateTime(body.endDateTime);

  if (
    startMilliseconds === null ||
    endMilliseconds === null
  ) {
    return "Start or end date/time is invalid.";
  }

  if (endMilliseconds <= startMilliseconds) {
    return "End date/time must be later than start date/time.";
  }

  if (
    startMilliseconds <
    Date.now() + MINIMUM_LEAD_MINUTES * 60 * 1000
  ) {
    return `Start time must be at least ${MINIMUM_LEAD_MINUTES} minutes in the future.`;
  }

  if (
    endMilliseconds - startMilliseconds >
    MAXIMUM_DURATION_HOURS * 60 * 60 * 1000
  ) {
    return `The suppression window cannot exceed ${MAXIMUM_DURATION_HOURS} hours.`;
  }

  return "";
}

app.http("submitSuppression", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "submitSuppression",
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
      process.env.LOGIC_APP_CALLBACK_URL;

    if (!callbackUrl) {
      context.error(
        "LOGIC_APP_CALLBACK_URL is not configured."
      );

      return jsonResponse(500, {
        success: false,
        status: "ConfigurationError",
        message:
          "The portal API is not connected to the Logic App."
      });
    }

    const authenticatedRequesterName =
      String(principal.userDetails).trim();

    const authenticatedRequesterId =
      String(principal.userId).trim();

    const logicAppPayload = {
      hostnames: normalizeHostnames(body.hostnames),
      startDateTime: body.startDateTime.trim(),
      endDateTime: body.endDateTime.trim(),
      timeZone: FIXED_TIME_ZONE,
      changeNumber: body.changeNumber.trim(),
      reason: body.reason.trim(),
      requesterName: authenticatedRequesterName,
      requesterUserName: authenticatedRequesterName,
      requesterUserId: authenticatedRequesterId
    };

    context.log(
      `Submitting ${logicAppPayload.hostnames.length} VM(s) for authenticated requester ID ${authenticatedRequesterId}.`
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
        signal: AbortSignal.timeout(40000)
      });
    } catch (error) {
      context.error(
        "Logic App request failed.",
        error
      );

      return jsonResponse(502, {
        success: false,
        status: "LogicAppUnavailable",
        message: "The Logic App could not be reached.",
        details: error.message
      });
    }

    const responseText =
      await logicAppResponse.text();

    let responseBody;

    try {
      responseBody = responseText
        ? JSON.parse(responseText)
        : {};
    } catch {
      responseBody = {
        success: false,
        status: "InvalidLogicAppResponse",
        message:
          responseText ||
          "The Logic App returned no response body."
      };
    }

    return jsonResponse(
      logicAppResponse.status,
      responseBody
    );
  }
});
