#!/usr/bin/env node
/**
 * Purpose: Executes lightweight production/staging health checks against a deployed URL.
 * Inputs: `HEALTH_BASE_URL` (or `SMOKE_BASE_URL`) and optional bypass/timeout args/env values.
 * Outputs: Exit code 0 on success, non-zero on failed health assertions.
 */

function parseArgs(argv) {
  /**
   * Purpose: Parses `--key value` style CLI arguments into a map.
   * Inputs: Raw argv slice after script path.
   * Outputs: Plain object keyed by argument name.
   */
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }

    const key = current.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      args[key] = "true";
      continue;
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function parsePositiveInt(raw, fallback) {
  /**
   * Purpose: Parses a positive integer with fallback behavior.
   * Inputs: Raw string-like value and fallback integer.
   * Outputs: Positive integer or fallback when invalid.
   */
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function assertCondition(condition, message) {
  /**
   * Purpose: Throws explicit assertion errors for failed health conditions.
   * Inputs: Boolean condition and failure message.
   * Outputs: None; throws on false condition.
   */
  if (!condition) {
    throw new Error(message);
  }
}

function buildHeaders(bypassToken) {
  /**
   * Purpose: Builds request headers with optional Vercel preview bypass token.
   * Inputs: Optional bypass token string.
   * Outputs: Headers object for fetch calls.
   */
  const headers = {};

  if (bypassToken.trim().length > 0) {
    headers["x-vercel-protection-bypass"] = bypassToken.trim();
  }

  return headers;
}

async function requestEndpoint(baseUrl, endpointPath, timeoutMs, bypassToken) {
  /**
   * Purpose: Sends one health probe request and captures status/body/headers.
   * Inputs: Base URL, endpoint path, timeout milliseconds, and optional bypass token.
   * Outputs: Probe result object with status/body/header fields.
   */
  const response = await fetch(`${baseUrl}${endpointPath}`, {
    method: "GET",
    headers: buildHeaders(bypassToken),
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });

  const body = await response.text();

  return {
    status: response.status,
    body,
    headers: {
      contentType: response.headers.get("content-type") ?? "",
      strictTransportSecurity:
        response.headers.get("strict-transport-security") ?? ""
    },
    finalUrl: response.url
  };
}

async function main() {
  /**
   * Purpose: Runs deployment health probes and enforces expected baseline behavior.
   * Inputs: Process args/env values.
   * Outputs: Console summary and process exit code.
   */
  const args = parseArgs(process.argv.slice(2));

  const baseUrlRaw =
    args["base-url"] ?? process.env.HEALTH_BASE_URL ?? process.env.SMOKE_BASE_URL ?? "";
  const baseUrl = baseUrlRaw.replace(/\/+$/, "");
  const bypassToken = args["bypass-token"] ?? process.env.VERCEL_BYPASS_TOKEN ?? "";
  const timeoutMs = parsePositiveInt(
    args["timeout-ms"] ?? process.env.HEALTH_TIMEOUT_MS,
    20000
  );

  assertCondition(baseUrl.length > 0, "Missing base URL. Set HEALTH_BASE_URL or --base-url.");

  console.log(`Health check start: base=${baseUrl}`);

  const home = await requestEndpoint(baseUrl, "/", timeoutMs, bypassToken);
  assertCondition(home.status === 200, `GET / expected 200, got ${home.status}.`);
  assertCondition(
    home.headers.contentType.toLowerCase().includes("text/html"),
    `GET / expected text/html content-type, got "${home.headers.contentType}".`
  );
  assertCondition(
    home.headers.strictTransportSecurity.length > 0,
    "GET / missing strict-transport-security header."
  );
  assertCondition(
    home.finalUrl.startsWith("https://"),
    `GET / final URL must be HTTPS, got "${home.finalUrl}".`
  );
  console.log("1) root route check: ok");

  const unauthenticatedApi = await requestEndpoint(
    baseUrl,
    "/api/panels",
    timeoutMs,
    bypassToken
  );
  assertCondition(
    unauthenticatedApi.status === 401,
    `GET /api/panels expected 401 (unauthenticated), got ${unauthenticatedApi.status}.`
  );
  console.log("2) auth gate check: ok");

  console.log("Health check passed.");
}

main().catch((error) => {
  console.error(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
