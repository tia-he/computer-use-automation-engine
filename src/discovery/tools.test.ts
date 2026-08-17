import { describe, expect, it } from "vitest";
import { validateToolInput } from "./tools";

describe("validateToolInput", () => {
  it("accepts a valid click input", () => {
    const result = validateToolInput("click", {
      target: { kind: "role", role: "button", name: "Search" },
      irreversible: false,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts each target hint kind", () => {
    expect(validateToolInput("extract", { target: { kind: "label", text: "x" }, outputName: "y" }).ok).toBe(true);
    expect(validateToolInput("extract", { target: { kind: "text", text: "x" }, outputName: "y" }).ok).toBe(true);
    expect(
      validateToolInput("extract", { target: { kind: "attribute", attribute: "name", value: "x" }, outputName: "y" }).ok
    ).toBe(true);
  });

  it("rejects a click with a missing irreversible flag", () => {
    const result = validateToolInput("click", { target: { kind: "role", role: "button", name: "Search" } });
    expect(result.ok).toBe(false);
  });

  it("rejects a role target missing its name", () => {
    const result = validateToolInput("click", { target: { kind: "role", role: "button" }, irreversible: false });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown target kind", () => {
    const result = validateToolInput("click", { target: { kind: "css", selector: "div" }, irreversible: false });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown tool name", () => {
    const result = validateToolInput("eval_javascript", { code: "alert(1)" });
    expect(result.ok).toBe(false);
  });

  it("accepts a valid done input and a valid escalate input", () => {
    expect(
      validateToolInput("done", { successTarget: { kind: "role", role: "heading", name: "Done" }, summary: "ok" }).ok
    ).toBe(true);
    expect(validateToolInput("escalate", { reason: "not sure how to proceed" }).ok).toBe(true);
  });
});
