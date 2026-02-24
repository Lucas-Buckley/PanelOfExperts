#!/usr/bin/env node
/**
 * Purpose: Runs a deployed API smoke flow using environment-driven configuration.
 * Inputs: `SMOKE_BASE_URL`, optional `VERCEL_BYPASS_TOKEN`, and optional mode/expert settings.
 * Outputs: Process exit code 0 on pass, non-zero on failure, plus step-by-step logs.
 */

function parseArgs(argv) {
  /**
   * Purpose: Parses `--key value` CLI arguments into a map for script configuration.
   * Inputs: Raw process argv slice after script path.
   * Outputs: Plain object map of argument keys to string values.
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

function parsePositiveInt(value, fallback) {
  /**
   * Purpose: Parses positive integers from env/arg strings with fallback behavior.
   * Inputs: Raw string value and fallback number.
   * Outputs: Positive integer or fallback when value is invalid.
   */
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeExpectedMode(raw) {
  /**
   * Purpose: Restricts expected-mode configuration to supported smoke values.
   * Inputs: Raw mode string from args/env.
   * Outputs: `simulated` or `live`; defaults to `simulated` when invalid/missing.
   */
  if (raw === "live") {
    return "live";
  }
  if (raw === "simulated") {
    return "simulated";
  }

  return "simulated";
}

function assertCondition(condition, message) {
  /**
   * Purpose: Throws explicit assertion errors for smoke-step validation failures.
   * Inputs: Boolean condition and human-readable failure message.
   * Outputs: None; throws when condition is false.
   */
  if (!condition) {
    throw new Error(message);
  }
}

function buildExperts(expertCount) {
  /**
   * Purpose: Builds deterministic expert payloads for panel creation smoke requests.
   * Inputs: Number of experts to include in the smoke panel.
   * Outputs: Array of expert payload objects matching API contract.
   */
  const templates = [
    {
      name: "Ava",
      specialization: "Systems Design",
      soul: "pragmatic and concise"
    },
    {
      name: "Noah",
      specialization: "Product Strategy",
      soul: "clear and practical"
    },
    {
      name: "Mia",
      specialization: "Go-to-Market",
      soul: "direct and execution-focused"
    }
  ];

  return Array.from({ length: expertCount }, (_, index) => {
    const template = templates[index % templates.length];
    return {
      ...template,
      name: `${template.name}-${index + 1}`
    };
  });
}

async function runSmoke() {
  /**
   * Purpose: Executes full deployed smoke flow and validates response semantics.
   * Inputs: Configuration from process env and CLI args.
   * Outputs: Logs smoke outcomes and throws on failure.
   */
  const cliArgs = parseArgs(process.argv.slice(2));

  const baseUrlRaw = cliArgs["base-url"] ?? process.env.SMOKE_BASE_URL ?? "";
  const baseUrl = baseUrlRaw.replace(/\/+$/, "");
  assertCondition(baseUrl.length > 0, "Missing base URL. Set SMOKE_BASE_URL or --base-url.");

  const bypassToken =
    cliArgs["bypass-token"] ?? process.env.VERCEL_BYPASS_TOKEN ?? "";
  const timeoutMs = parsePositiveInt(
    cliArgs["timeout-ms"] ?? process.env.SMOKE_TIMEOUT_MS,
    60000
  );
  const expectedMode = normalizeExpectedMode(
    cliArgs["expect-mode"] ?? process.env.SMOKE_EXPECT_MODE
  );
  const expertCount = parsePositiveInt(
    cliArgs.experts ?? process.env.SMOKE_EXPERT_COUNT,
    expectedMode === "live" ? 1 : 2
  );

  const headersFor = (token, includeJson) => {
    /**
     * Purpose: Composes request headers including optional auth and bypass token.
     * Inputs: Optional bearer token and JSON-body boolean.
     * Outputs: Plain headers object for fetch requests.
     */
    const headers = {};

    if (bypassToken.trim().length > 0) {
      headers["x-vercel-protection-bypass"] = bypassToken.trim();
    }
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
    if (includeJson) {
      headers["content-type"] = "application/json";
    }

    return headers;
  };

  const request = async (path, options = {}) => {
    /**
     * Purpose: Sends one HTTP request to deployed API and parses JSON response body.
     * Inputs: Relative API path plus method/token/json payload options.
     * Outputs: Parsed `{ status, data, raw }` response object.
     */
    const method = options.method ?? "GET";
    const hasBody = options.json !== undefined;

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: headersFor(options.token, hasBody),
      body: hasBody ? JSON.stringify(options.json) : undefined,
      signal: AbortSignal.timeout(timeoutMs)
    });

    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = { raw };
    }

    return {
      status: response.status,
      data,
      raw
    };
  };

  const suffix = `${Date.now()}`;
  const email = `deploy-smoke+${suffix}@panelofexperts.dev`;
  const password = `DeploySmoke!${suffix.slice(-8)}`;

  console.log(`Smoke start: base=${baseUrl} mode=${expectedMode} experts=${expertCount}`);

  const register = await request("/api/auth/register", {
    method: "POST",
    json: { email, password }
  });
  assertCondition(
    register.status === 201,
    `register failed: status=${register.status} body=${JSON.stringify(register.data)}`
  );
  const accessToken = register.data?.accessToken;
  assertCondition(Boolean(accessToken), "register response missing accessToken");
  console.log("1) register: ok");

  const panel = await request("/api/panels", {
    method: "POST",
    token: accessToken,
    json: {
      name: `Deploy Smoke Panel ${suffix}`,
      description: "Deployed smoke panel",
      instructions: "Be concise and practical.",
      experts: buildExperts(expertCount)
    }
  });
  assertCondition(
    panel.status === 201,
    `create panel failed: status=${panel.status} body=${JSON.stringify(panel.data)}`
  );
  const panelId = panel.data?.id;
  assertCondition(Number.isInteger(panelId) && panelId > 0, "create panel missing valid id");
  console.log(`2) create panel: ok (panelId=${panelId})`);

  const conversation = await request("/api/conversations", {
    method: "POST",
    token: accessToken,
    json: {
      panelId,
      name: `Deploy Smoke Conversation ${suffix}`
    }
  });
  assertCondition(
    conversation.status === 201,
    `create conversation failed: status=${conversation.status} body=${JSON.stringify(conversation.data)}`
  );
  const conversationId = conversation.data?.id;
  assertCondition(
    Number.isInteger(conversationId) && conversationId > 0,
    "create conversation missing valid id"
  );
  console.log(`3) create conversation: ok (conversationId=${conversationId})`);

  const firstPrompt = await request(`/api/conversations/${conversationId}/prompts`, {
    method: "POST",
    token: accessToken,
    json: { content: "Give a concrete MVP launch plan in 3 bullets." }
  });
  assertCondition(
    firstPrompt.status === 201,
    `first prompt failed: status=${firstPrompt.status} body=${JSON.stringify(firstPrompt.data)}`
  );
  assertCondition(
    Array.isArray(firstPrompt.data?.responses) &&
      firstPrompt.data.responses.length === expertCount,
    `first prompt responses mismatch: expected=${expertCount} got=${firstPrompt.data?.responses?.length ?? 0}`
  );
  console.log("4) first prompt: ok");

  const secondPrompt = await request(`/api/conversations/${conversationId}/prompts`, {
    method: "POST",
    token: accessToken,
    json: { content: "Now list week-one tradeoffs and key risks." }
  });
  assertCondition(
    secondPrompt.status === 201,
    `second prompt failed: status=${secondPrompt.status} body=${JSON.stringify(secondPrompt.data)}`
  );
  assertCondition(
    Array.isArray(secondPrompt.data?.responses) &&
      secondPrompt.data.responses.length === expertCount,
    `second prompt responses mismatch: expected=${expertCount} got=${secondPrompt.data?.responses?.length ?? 0}`
  );
  console.log("5) second prompt: ok");

  const reopenedConversation = await request(`/api/conversations/${conversationId}`, {
    token: accessToken
  });
  assertCondition(
    reopenedConversation.status === 200,
    `open conversation failed: status=${reopenedConversation.status} body=${JSON.stringify(
      reopenedConversation.data
    )}`
  );
  assertCondition(
    Array.isArray(reopenedConversation.data?.prompts) &&
      reopenedConversation.data.prompts.length === 2,
    "conversation persistence check failed"
  );
  console.log("6) conversation persistence: ok");

  const allResponses = [
    ...firstPrompt.data.responses,
    ...secondPrompt.data.responses
  ].map((response) => String(response?.content ?? ""));
  const simulatedMarkers = allResponses.filter((content) =>
    content.includes("[SIMULATED:")
  ).length;
  const emptyResponses = allResponses.filter((content) => content.trim().length === 0).length;

  assertCondition(emptyResponses === 0, "one or more responses were empty");
  if (expectedMode === "live") {
    assertCondition(simulatedMarkers === 0, "simulated marker found while expecting live mode");
  } else {
    assertCondition(
      simulatedMarkers === allResponses.length,
      "expected simulated markers in all responses while expecting simulated mode"
    );
  }

  console.log(`7) mode check: ok (simulatedMarkers=${simulatedMarkers}/${allResponses.length})`);
  console.log("Smoke complete: PASS");
}

runSmoke().catch((error) => {
  /**
   * Purpose: Reports top-level smoke failures and exits non-zero for CI/operator visibility.
   * Inputs: Unknown thrown error.
   * Outputs: Logs error details to stderr and terminates with exit code 1.
   */
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke complete: FAIL - ${message}`);
  process.exitCode = 1;
});
