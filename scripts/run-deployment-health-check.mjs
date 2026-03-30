#!/usr/bin/env node
function parseArgs(argv) {
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
    if (!condition) {
        throw new Error(message);
    }
}
function buildHeaders(bypassToken) {
    const headers = {};
    if (bypassToken.trim().length > 0) {
        headers["x-vercel-protection-bypass"] = bypassToken.trim();
    }
    return headers;
}
async function requestEndpoint(baseUrl, endpointPath, timeoutMs, bypassToken) {
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
            strictTransportSecurity: response.headers.get("strict-transport-security") ?? ""
        },
        finalUrl: response.url
    };
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const baseUrlRaw = args["base-url"] ?? process.env.HEALTH_BASE_URL ?? process.env.SMOKE_BASE_URL ?? "";
    const baseUrl = baseUrlRaw.replace(/\/+$/, "");
    const bypassToken = args["bypass-token"] ?? process.env.VERCEL_BYPASS_TOKEN ?? "";
    const timeoutMs = parsePositiveInt(args["timeout-ms"] ?? process.env.HEALTH_TIMEOUT_MS, 20000);
    assertCondition(baseUrl.length > 0, "Missing base URL. Set HEALTH_BASE_URL or --base-url.");
    console.log(`Health check start: base=${baseUrl}`);
    const home = await requestEndpoint(baseUrl, "/", timeoutMs, bypassToken);
    assertCondition(home.status === 200, `GET / expected 200, got ${home.status}.`);
    assertCondition(home.headers.contentType.toLowerCase().includes("text/html"), `GET / expected text/html content-type, got "${home.headers.contentType}".`);
    assertCondition(home.headers.strictTransportSecurity.length > 0, "GET / missing strict-transport-security header.");
    assertCondition(home.finalUrl.startsWith("https://"), `GET / final URL must be HTTPS, got "${home.finalUrl}".`);
    console.log("1) root route check: ok");
    const unauthenticatedApi = await requestEndpoint(baseUrl, "/api/panels", timeoutMs, bypassToken);
    assertCondition(unauthenticatedApi.status === 401, `GET /api/panels expected 401 (unauthenticated), got ${unauthenticatedApi.status}.`);
    console.log("2) auth gate check: ok");
    console.log("Health check passed.");
}
main().catch((error) => {
    console.error(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
