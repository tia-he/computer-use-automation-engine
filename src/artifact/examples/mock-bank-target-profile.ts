import { TargetProfile } from "../target-profile";

// The mock-bank app (Phase 1) has no authentication/session system and no
// dismissible interstitials, so sessionExpiredDetector and knownInterstitials
// are genuinely absent here rather than stubbed with a fake detector.
export const mockBankTargetProfile: TargetProfile = {
  id: "mock-bank",
  schemaVersion: 1,
  allowedOrigin: "http://localhost:4100",
  entryUrl: "http://localhost:4100/",
  defaultTimeouts: {
    actionMs: 5000,
    navigationMs: 10000,
  },
};
