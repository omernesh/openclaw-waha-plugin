import crypto from "node:crypto";

export function verifyWahaWebhookHmac(params: {
  body: string;
  secret: string;
  signatureHeader?: string;
  algorithmHeader?: string;
}): boolean {
  const raw = (params.signatureHeader ?? "").trim();
  if (!raw) return false;
  const algo = (params.algorithmHeader ?? "sha512").toLowerCase();
  if (algo !== "sha512") return false;

  // Accept common formats: "sha512=<sig>", plain hex, or base64
  const signature = raw.startsWith("sha512=") ? raw.slice("sha512=".length) : raw;

  const expectedHex = crypto.createHmac("sha512", params.secret).update(params.body).digest("hex");
  const expectedBase64 = crypto.createHmac("sha512", params.secret).update(params.body).digest("base64");

  const safeEq = (a: string, b: string): boolean => {
    if (a.length !== b.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch (err) {
      console.warn(`[waha] timingSafeEqual failed, rejecting: ${String(err)}`);
      return false;
    }
  };

  return safeEq(signature, expectedHex) || safeEq(signature, expectedBase64);
}
