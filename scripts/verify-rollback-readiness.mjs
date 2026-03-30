#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
function assertCondition(condition, message, errors) {
    if (!condition) {
        errors.push(message);
    }
}
function readJsonFile(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
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
function parseBoolean(raw, fallback) {
    if (raw === undefined) {
        return fallback;
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") {
        return true;
    }
    if (normalized === "false") {
        return false;
    }
    return fallback;
}
function parseEnvExampleKeys(rawEnvFile) {
    const keys = new Set();
    const lines = rawEnvFile.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) {
            continue;
        }
        const equalIndex = trimmed.indexOf("=");
        if (equalIndex <= 0) {
            continue;
        }
        keys.add(trimmed.slice(0, equalIndex));
    }
    return keys;
}
function collectMigrationSqlFiles(migrationsDir) {
    if (!fs.existsSync(migrationsDir)) {
        return [];
    }
    const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
    const migrationFiles = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const migrationSqlPath = path.join(migrationsDir, entry.name, "migration.sql");
        if (fs.existsSync(migrationSqlPath)) {
            migrationFiles.push(migrationSqlPath);
        }
    }
    return migrationFiles;
}
function runPrismaValidate(shouldSkip, requireDatabaseEnv, errors) {
    if (shouldSkip) {
        console.log("Prisma validate skipped.");
        return;
    }
    const hasDatabaseUrl = Boolean(process.env.DATABASE_URL?.trim());
    const hasDirectUrl = Boolean(process.env.DIRECT_URL?.trim());
    if (!hasDatabaseUrl || !hasDirectUrl) {
        if (requireDatabaseEnv) {
            errors.push("Prisma validate requires DATABASE_URL and DIRECT_URL when --require-prisma is enabled.");
            return;
        }
        console.log("Prisma validate skipped (DATABASE_URL or DIRECT_URL not set).");
        return;
    }
    const result = spawnSync("npx", ["prisma", "validate", "--schema", "prisma/schema.prisma"], {
        stdio: "pipe",
        encoding: "utf8"
    });
    if (result.status === 0) {
        console.log("Prisma validate: ok");
        return;
    }
    const stderr = result.stderr?.trim() ?? "";
    const stdout = result.stdout?.trim() ?? "";
    errors.push(`Prisma validate failed with exit code ${result.status}. ${stderr || stdout || "No output."}`);
}
async function runRemoteProbes(baseUrl, bypassToken, timeoutMs, errors) {
    if (!baseUrl) {
        console.log("Remote probe skipped (no rollback base URL provided).");
        return;
    }
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
    const headers = {};
    if (bypassToken.trim().length > 0) {
        headers["x-vercel-protection-bypass"] = bypassToken.trim();
    }
    try {
        const rootResponse = await fetch(`${normalizedBaseUrl}/`, {
            method: "GET",
            headers,
            redirect: "follow",
            signal: AbortSignal.timeout(timeoutMs)
        });
        assertCondition(rootResponse.status === 200, "Rollback probe GET / must return 200.", errors);
        const apiResponse = await fetch(`${normalizedBaseUrl}/api/panels`, {
            method: "GET",
            headers,
            redirect: "follow",
            signal: AbortSignal.timeout(timeoutMs)
        });
        assertCondition(apiResponse.status === 401, "Rollback probe GET /api/panels must return 401 when unauthenticated.", errors);
        if (errors.length === 0) {
            console.log("Remote rollback probes: ok");
        }
    }
    catch (error) {
        errors.push(`Rollback probe failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function main() {
    const errors = [];
    const args = parseArgs(process.argv.slice(2));
    const rootDir = process.cwd();
    const packageJsonPath = path.resolve(rootDir, "package.json");
    const envExamplePath = path.resolve(rootDir, ".env.example");
    const releaseWorkflowPath = path.resolve(rootDir, ".github/workflows/release-verify.yml");
    const migrateWorkflowPath = path.resolve(rootDir, ".github/workflows/prisma-migrate-deploy.yml");
    const migrationsDir = path.resolve(rootDir, "prisma/migrations");
    assertCondition(fs.existsSync(packageJsonPath), "Missing package.json.", errors);
    assertCondition(fs.existsSync(envExamplePath), "Missing .env.example.", errors);
    assertCondition(fs.existsSync(releaseWorkflowPath), "Missing release-verify workflow.", errors);
    assertCondition(fs.existsSync(migrateWorkflowPath), "Missing prisma-migrate-deploy workflow.", errors);
    if (errors.length === 0) {
        const packageJson = readJsonFile(packageJsonPath);
        const scripts = packageJson.scripts ?? {};
        const requiredScripts = [
            "release:verify",
            "db:migrate:deploy",
            "db:migrate:status",
            "safety:verify",
            "smoke:deploy",
            "health:deploy",
            "rollback:verify"
        ];
        for (const scriptName of requiredScripts) {
            assertCondition(Boolean(scripts[scriptName]), `Missing npm script "${scriptName}".`, errors);
        }
        const envKeys = parseEnvExampleKeys(fs.readFileSync(envExamplePath, "utf8"));
        const requiredEnvKeys = [
            "LLM_MODE",
            "LLM_ENABLED",
            "SMOKE_BASE_URL",
            "HEALTH_BASE_URL",
            "ROLLBACK_BASE_URL",
            "ROLLBACK_SKIP_PRISMA",
            "ROLLBACK_REQUIRE_PRISMA"
        ];
        for (const envKey of requiredEnvKeys) {
            assertCondition(envKeys.has(envKey), `Missing .env.example key "${envKey}".`, errors);
        }
        const migrationSqlFiles = collectMigrationSqlFiles(migrationsDir);
        assertCondition(migrationSqlFiles.length > 0, "No Prisma migration.sql files found under prisma/migrations.", errors);
    }
    const skipPrisma = parseBoolean(args["skip-prisma"], false) ||
        parseBoolean(process.env.ROLLBACK_SKIP_PRISMA, false);
    const requirePrisma = parseBoolean(args["require-prisma"], false) ||
        parseBoolean(process.env.ROLLBACK_REQUIRE_PRISMA, false);
    runPrismaValidate(skipPrisma, requirePrisma, errors);
    const rollbackBaseUrl = args["base-url"] ??
        process.env.ROLLBACK_BASE_URL ??
        process.env.HEALTH_BASE_URL ??
        process.env.SMOKE_BASE_URL ??
        "";
    const bypassToken = args["bypass-token"] ?? process.env.VERCEL_BYPASS_TOKEN ?? "";
    const timeoutMs = parsePositiveInt(args["timeout-ms"] ?? process.env.ROLLBACK_TIMEOUT_MS, 20000);
    await runRemoteProbes(rollbackBaseUrl, bypassToken, timeoutMs, errors);
    if (errors.length > 0) {
        console.error("Rollback readiness verification failed:");
        for (const message of errors) {
            console.error(`- ${message}`);
        }
        process.exit(1);
    }
    console.log("Rollback readiness verification passed.");
}
main().catch((error) => {
    console.error(`Rollback readiness verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
