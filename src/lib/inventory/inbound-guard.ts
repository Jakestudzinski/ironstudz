import { authenticateBusiness } from "./auth";
import { errorResponse } from "./errors";
import { logInbound } from "./log";
import { LIMITS, clientIp, hit, peek, type LimitResult } from "./rate-limit";

const tooMany = (r: LimitResult, message: string) => {
  const res = errorResponse(429, message);
  res.headers.set("Retry-After", String(r.retryAfter));
  return res;
};

/**
 * Checks a business website's request: rate limits by IP, refuses an IP that keeps sending wrong keys,
 * checks the API key, then rate limits per business. Returns the business, or the response to send back.
 */
export async function authorizeInbound(
  req: Request, endpoint: string, reference?: string
): Promise<{ businessId: string } | Response> {
  const ip = clientIp(req);

  const byIp = await hit(`ip:${ip}`, LIMITS.perIp);
  if (!byIp.allowed) {
    await logInbound({ endpoint, statusCode: 429, reference, error: `rate limit: ip ${ip}` });
    return tooMany(byIp, "Too many requests. Wait a moment and try again.");
  }
  const bad = await peek(`badkey:${ip}`, LIMITS.badKeys);
  if (!bad.allowed) {
    await logInbound({ endpoint, statusCode: 429, reference, error: `too many bad keys from ${ip}` });
    return tooMany(bad, "Too many requests with an invalid API key. Wait and try again.");
  }

  const auth = await authenticateBusiness(req);
  if (!auth) {
    await hit(`badkey:${ip}`, LIMITS.badKeys);
    await logInbound({ endpoint, statusCode: 401, reference, error: "invalid or missing API key" });
    return errorResponse(401, "Invalid or missing API key");
  }

  const byBusiness = await hit(`biz:${auth.businessId}`, LIMITS.perBusiness);
  if (!byBusiness.allowed) {
    await logInbound({ endpoint, statusCode: 429, businessId: auth.businessId, reference, error: "rate limit: business" });
    return tooMany(byBusiness, "Too many requests for this business. Wait a moment and try again.");
  }
  return auth;
}
