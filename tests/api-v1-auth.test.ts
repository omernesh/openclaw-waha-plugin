// Phase 60, Plan 01 (API-02, API-04): Tests for public API v1 auth guard and CORS helpers.
// DO NOT REMOVE — covers timing-safe token comparison and CORS preflight behavior.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

// We'll import the module after creation
let requirePublicApiAuth: (req: IncomingMessage, res: ServerResponse, coreCfg: unknown) => boolean;
let setCorsHeaders: (res: ServerResponse) => void;
let handleCorsPreflightIfNeeded: (req: IncomingMessage, res: ServerResponse) => boolean;

function makeMockRes() {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn((k: string, v: string) => { headers[k] = v; }),
    writeHead: vi.fn(),
    end: vi.fn(),
    _headers: headers,
  } as unknown as ServerResponse;
  return res;
}

function makeMockReq(opts: { method?: string; url?: string; authorization?: string } = {}): IncomingMessage {
  return {
    method: opts.method ?? "GET",
    url: opts.url ?? "/api/v1/send",
    headers: opts.authorization ? { authorization: opts.authorization } : {},
  } as unknown as IncomingMessage;
}

describe("api-v1-auth", () => {
  beforeEach(async () => {
    // Dynamic import after file creation
    const mod = await import("../src/api-v1-auth.js");
    requirePublicApiAuth = mod.requirePublicApiAuth;
    setCorsHeaders = mod.setCorsHeaders;
    handleCorsPreflightIfNeeded = mod.handleCorsPreflightIfNeeded;
  });

  describe("requirePublicApiAuth", () => {
    it("returns true when no publicApiKey configured and no env var (open access)", () => {
      delete process.env.CHATLYTICS_API_KEY;
      const req = makeMockReq({});
      const res = makeMockRes();
      const result = requirePublicApiAuth(req, res, { channels: { waha: {} } });
      expect(result).toBe(true);
      expect(res.writeHead).not.toHaveBeenCalled();
    });

    it("returns true when no publicApiKey and no CHATLYTICS_API_KEY (backward compat)", () => {
      delete process.env.CHATLYTICS_API_KEY;
      const req = makeMockReq({});
      const res = makeMockRes();
      const result = requirePublicApiAuth(req, res, {});
      expect(result).toBe(true);
    });

    it("returns 401 with 'Authorization required' when token configured but header missing", () => {
      delete process.env.CHATLYTICS_API_KEY;
      const req = makeMockReq({ authorization: undefined });
      const res = makeMockRes();
      const cfg = { channels: { waha: { publicApiKey: "ctl_secret123" } } };
      const result = requirePublicApiAuth(req, res, cfg);
      expect(result).toBe(false);
      expect(res.writeHead).toHaveBeenCalledWith(401, expect.objectContaining({ "Content-Type": "application/json" }));
      const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(body.error).toBe("Authorization required");
    });

    it("returns 401 with 'Authorization required' when header doesn't start with Bearer", () => {
      delete process.env.CHATLYTICS_API_KEY;
      const req = makeMockReq({ authorization: "Token ctl_secret123" });
      const res = makeMockRes();
      const cfg = { channels: { waha: { publicApiKey: "ctl_secret123" } } };
      const result = requirePublicApiAuth(req, res, cfg);
      expect(result).toBe(false);
      const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(body.error).toBe("Authorization required");
    });

    it("returns 401 with 'Invalid API key' when Bearer token is wrong", () => {
      delete process.env.CHATLYTICS_API_KEY;
      const req = makeMockReq({ authorization: "Bearer wrong_token" });
      const res = makeMockRes();
      const cfg = { channels: { waha: { publicApiKey: "ctl_secret123" } } };
      const result = requirePublicApiAuth(req, res, cfg);
      expect(result).toBe(false);
      const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(body.error).toBe("Invalid API key");
    });

    it("returns true when Bearer token is correct", () => {
      delete process.env.CHATLYTICS_API_KEY;
      const req = makeMockReq({ authorization: "Bearer ctl_secret123" });
      const res = makeMockRes();
      const cfg = { channels: { waha: { publicApiKey: "ctl_secret123" } } };
      const result = requirePublicApiAuth(req, res, cfg);
      expect(result).toBe(true);
      expect(res.writeHead).not.toHaveBeenCalled();
    });

    it("uses CHATLYTICS_API_KEY env var as fallback when no publicApiKey in config", () => {
      process.env.CHATLYTICS_API_KEY = "ctl_from_env";
      const req = makeMockReq({ authorization: "Bearer ctl_from_env" });
      const res = makeMockRes();
      const cfg = { channels: { waha: {} } };
      const result = requirePublicApiAuth(req, res, cfg);
      expect(result).toBe(true);
      delete process.env.CHATLYTICS_API_KEY;
    });

    it("uses CHATLYTICS_API_KEY env var and rejects wrong token", () => {
      process.env.CHATLYTICS_API_KEY = "ctl_from_env";
      const req = makeMockReq({ authorization: "Bearer wrong_token" });
      const res = makeMockRes();
      const cfg = {};
      const result = requirePublicApiAuth(req, res, cfg);
      expect(result).toBe(false);
      delete process.env.CHATLYTICS_API_KEY;
    });

    it("uses timingSafeEqual — both buffers must be same length for comparison", () => {
      // timingSafeEqual throws if lengths differ — our code handles this case
      delete process.env.CHATLYTICS_API_KEY;
      const req = makeMockReq({ authorization: "Bearer short" });
      const res = makeMockRes();
      const cfg = { channels: { waha: { publicApiKey: "much_longer_token_value_here" } } };
      const result = requirePublicApiAuth(req, res, cfg);
      expect(result).toBe(false);
    });
  });

  describe("setCorsHeaders", () => {
    it("sets Access-Control-Allow-Origin: *", () => {
      const res = makeMockRes();
      setCorsHeaders(res);
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
    });

    it("sets Access-Control-Allow-Methods with GET, POST, PUT, DELETE, OPTIONS", () => {
      const res = makeMockRes();
      setCorsHeaders(res);
      expect(res.setHeader).toHaveBeenCalledWith(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
    });

    it("sets Access-Control-Allow-Headers with Authorization and Content-Type", () => {
      const res = makeMockRes();
      setCorsHeaders(res);
      expect(res.setHeader).toHaveBeenCalledWith(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type"
      );
    });

    it("sets Access-Control-Max-Age: 86400", () => {
      const res = makeMockRes();
      setCorsHeaders(res);
      expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Max-Age", "86400");
    });
  });

  describe("handleCorsPreflightIfNeeded", () => {
    it("handles OPTIONS /api/v1/* with 204 and CORS headers, returns true", () => {
      const req = makeMockReq({ method: "OPTIONS", url: "/api/v1/send" });
      const res = makeMockRes();
      const result = handleCorsPreflightIfNeeded(req, res);
      expect(result).toBe(true);
      expect(res.writeHead).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
    });

    it("returns false for OPTIONS on non-/api/v1/ path", () => {
      const req = makeMockReq({ method: "OPTIONS", url: "/api/admin/config" });
      const res = makeMockRes();
      const result = handleCorsPreflightIfNeeded(req, res);
      expect(result).toBe(false);
      expect(res.writeHead).not.toHaveBeenCalled();
    });

    it("returns false for GET on /api/v1/ path (not OPTIONS)", () => {
      const req = makeMockReq({ method: "GET", url: "/api/v1/sessions" });
      const res = makeMockRes();
      const result = handleCorsPreflightIfNeeded(req, res);
      expect(result).toBe(false);
    });
  });
});
