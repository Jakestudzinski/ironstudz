import { describe, expect, it } from "vitest";

import { loginSchema, registerSchema } from "@/lib/validation";

describe("validation schemas", () => {
  it("accepts a valid registration payload", () => {
    const result = registerSchema.safeParse({
      name: "  Jane Doe ",
      email: "JANE@example.com",
      password: "hunter22!",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Jane Doe");
      expect(result.data.email).toBe("jane@example.com");
    }
  });

  it("rejects short passwords", () => {
    const result = registerSchema.safeParse({
      name: "Jane",
      email: "jane@example.com",
      password: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid emails on login", () => {
    const result = loginSchema.safeParse({
      email: "not-an-email",
      password: "whatever",
    });
    expect(result.success).toBe(false);
  });
});
