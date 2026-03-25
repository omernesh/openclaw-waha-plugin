import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    vi.unstubAllEnvs();
    // Reset module cache so each test gets a fresh logger
    vi.resetModules();
  });

  it("logger.info() outputs valid JSON with level, ts, msg", async () => {
    const { createLogger } = await import("./logger.js");
    const log = createLogger({ level: "info" });
    log.info("hello");
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(output.level).toBe("info");
    expect(output.msg).toBe("hello");
    expect(output.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("child logger adds component field", async () => {
    const { createLogger } = await import("./logger.js");
    const log = createLogger({ level: "info" });
    const child = log.child({ component: "monitor" });
    child.warn("x");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(output.component).toBe("monitor");
    expect(output.level).toBe("warn");
    expect(output.msg).toBe("x");
  });

  it("child logger with sessionId includes sessionId field", async () => {
    const { createLogger } = await import("./logger.js");
    const log = createLogger({ level: "info" });
    const child = log.child({ component: "inbound", sessionId: "abc" });
    child.info("msg");
    const output = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(output.component).toBe("inbound");
    expect(output.sessionId).toBe("abc");
  });

  it("at level warn, info() produces no output; warn() does", async () => {
    const { createLogger } = await import("./logger.js");
    const log = createLogger({ level: "warn" });
    log.info("suppressed");
    expect(stdoutSpy).not.toHaveBeenCalled();
    log.warn("visible");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(output.msg).toBe("visible");
  });

  it("at level error, warn() produces no output; error() does", async () => {
    const { createLogger } = await import("./logger.js");
    const log = createLogger({ level: "error" });
    log.warn("suppressed");
    expect(stderrSpy).not.toHaveBeenCalled();
    log.error("visible");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(output.level).toBe("error");
  });

  it("at level debug, all levels produce output", async () => {
    const { createLogger } = await import("./logger.js");
    const log = createLogger({ level: "debug" });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(stdoutSpy).toHaveBeenCalledTimes(2); // debug + info → stdout
    expect(stderrSpy).toHaveBeenCalledTimes(2); // warn + error → stderr
  });

  it("default level is info when no config or env var", async () => {
    delete process.env.WAHA_LOG_LEVEL;
    const { createLogger } = await import("./logger.js");
    const log = createLogger();
    log.debug("suppressed");
    expect(stdoutSpy).not.toHaveBeenCalled();
    log.info("visible");
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
  });

  it("WAHA_LOG_LEVEL env var overrides default", async () => {
    vi.stubEnv("WAHA_LOG_LEVEL", "debug");
    const { createLogger } = await import("./logger.js");
    const log = createLogger();
    log.debug("visible");
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(output.level).toBe("debug");
  });

  it("setLogLevel changes level at runtime", async () => {
    const { createLogger, setLogLevel } = await import("./logger.js");
    const log = createLogger({ level: "info" });
    log.debug("suppressed");
    expect(stdoutSpy).not.toHaveBeenCalled();
    setLogLevel(log, "debug");
    log.debug("visible");
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
  });

  it("extra fields are included in output", async () => {
    const { createLogger } = await import("./logger.js");
    const log = createLogger({ level: "info" });
    log.info("test", { chatId: "123@g.us", duration: 42 });
    const output = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(output.chatId).toBe("123@g.us");
    expect(output.duration).toBe(42);
  });
});
