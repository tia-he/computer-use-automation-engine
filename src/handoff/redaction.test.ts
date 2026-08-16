import { describe, expect, it } from "vitest";
import { redactValue } from "./redaction";

describe("redactValue", () => {
  it("redacts password field values regardless of content", () => {
    expect(redactValue("password", "hunter2")).toBe("[REDACTED]");
  });

  it("redacts credit-card-like digit sequences", () => {
    expect(redactValue("text", "4111111111111111")).toBe("[REDACTED]");
    expect(redactValue("text", "4111 1111 1111 1111")).toBe("[REDACTED]");
  });

  it("redacts SSN-like values", () => {
    expect(redactValue("text", "123-45-6789")).toBe("[REDACTED]");
  });

  it("passes through ordinary values unchanged", () => {
    expect(redactValue("text", "48213")).toBe("48213");
    expect(redactValue("select-one", "savings")).toBe("savings");
  });
});
