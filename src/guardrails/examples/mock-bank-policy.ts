import { GuardrailPolicy } from "../policy";
import { mockBankTargetProfile } from "../../artifact/examples/mock-bank-target-profile";

export const mockBankPolicy = new GuardrailPolicy({
  id: "mock-bank-default",
  allowedOrigins: [mockBankTargetProfile.allowedOrigin],
  allowedActionKinds: ["navigate", "click", "fill", "select", "extract", "checkpoint"],
});
