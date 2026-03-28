// Phase 60, Plan 02 (API-03): Tests that openapi.yaml is valid and contains required fields.
// DO NOT REMOVE — verifies the OpenAPI spec is well-formed and all 6 endpoints are documented.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const specPath = join(__dirname, "../src/openapi.yaml");

describe("openapi.yaml", () => {
  let raw: string;
  let doc: Record<string, unknown>;

  it("parses as valid YAML without errors", () => {
    raw = readFileSync(specPath, "utf-8");
    expect(() => {
      doc = parseYaml(raw) as Record<string, unknown>;
    }).not.toThrow();
    expect(doc).toBeTruthy();
  });

  it('has openapi: "3.1.0"', () => {
    raw = raw ?? readFileSync(specPath, "utf-8");
    doc = doc ?? (parseYaml(raw) as Record<string, unknown>);
    expect(doc.openapi).toBe("3.1.0");
  });

  it("has all 6 /api/v1/ paths defined", () => {
    raw = raw ?? readFileSync(specPath, "utf-8");
    doc = doc ?? (parseYaml(raw) as Record<string, unknown>);
    const paths = doc.paths as Record<string, unknown>;
    expect(paths).toBeTruthy();
    expect(paths["/api/v1/send"]).toBeTruthy();
    expect(paths["/api/v1/messages"]).toBeTruthy();
    expect(paths["/api/v1/search"]).toBeTruthy();
    expect(paths["/api/v1/directory"]).toBeTruthy();
    expect(paths["/api/v1/sessions"]).toBeTruthy();
    expect(paths["/api/v1/mimicry"]).toBeTruthy();
  });

  it("all paths have operationId", () => {
    raw = raw ?? readFileSync(specPath, "utf-8");
    doc = doc ?? (parseYaml(raw) as Record<string, unknown>);
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
    const requiredPaths = [
      "/api/v1/send",
      "/api/v1/messages",
      "/api/v1/search",
      "/api/v1/directory",
      "/api/v1/sessions",
      "/api/v1/mimicry",
    ];
    for (const path of requiredPaths) {
      const methods = paths[path];
      for (const [_method, operation] of Object.entries(methods)) {
        expect(
          operation.operationId,
          `Path ${path} is missing operationId`,
        ).toBeTruthy();
      }
    }
  });

  it("has BearerAuth security scheme", () => {
    raw = raw ?? readFileSync(specPath, "utf-8");
    doc = doc ?? (parseYaml(raw) as Record<string, unknown>);
    const components = doc.components as Record<string, unknown>;
    expect(components).toBeTruthy();
    const securitySchemes = components.securitySchemes as Record<string, unknown>;
    expect(securitySchemes).toBeTruthy();
    expect(securitySchemes.BearerAuth).toBeTruthy();
    const bearerAuth = securitySchemes.BearerAuth as Record<string, unknown>;
    expect(bearerAuth.type).toBe("http");
    expect(bearerAuth.scheme).toBe("bearer");
  });

  it("passes Spectral lint with zero errors (exit code 0)", () => {
    // Run Spectral lint inline and assert exit code 0.
    // Warnings are acceptable; only errors cause non-zero exit.
    // Uses shell: true so the .cmd wrapper on Windows and the shebang script on Linux both resolve correctly.
    let exitCode = 0;
    try {
      const spectralBin = join(__dirname, "../node_modules/.bin/spectral");
      execFileSync(spectralBin, ["lint", specPath], {
        encoding: "utf-8",
        stdio: "pipe",
        shell: true,
      });
    } catch (err: unknown) {
      const execErr = err as { status?: number; stderr?: string; stdout?: string };
      exitCode = execErr.status ?? 1;
      if (exitCode !== 0) {
        console.error("Spectral output:", execErr.stdout ?? "", execErr.stderr ?? "");
      }
    }
    expect(exitCode, "Spectral lint exited with non-zero code — fix errors in src/openapi.yaml").toBe(0);
  });
});
