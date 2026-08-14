import { z } from "zod";
import { LogicalLocatorSchema } from "../locator/schema";
import { ConditionSchema } from "./condition";

export const KnownInterstitialSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "code must be UPPER_SNAKE_CASE"),
  detector: ConditionSchema,
  dismissTarget: LogicalLocatorSchema,
});
export type KnownInterstitial = z.infer<typeof KnownInterstitialSchema>;

/**
 * App-level shared behavior, reused across every capability recorded against
 * this app (and, later, across tenants running the same vendor product).
 * `sessionExpiredDetector` and `knownInterstitials` are optional: an app with
 * no session concept or no dismissible interstitials genuinely has none —
 * see the mock-bank profile, which omits both rather than stubbing them.
 */
export const TargetProfileSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "id must be kebab-case"),
  schemaVersion: z.literal(1),
  allowedOrigin: z.string().url(),
  entryUrl: z.string().url(),
  defaultTimeouts: z.object({
    actionMs: z.number().int().positive(),
    navigationMs: z.number().int().positive(),
  }),
  sessionExpiredDetector: ConditionSchema.optional(),
  knownInterstitials: z.array(KnownInterstitialSchema).optional(),
});
export type TargetProfile = z.infer<typeof TargetProfileSchema>;
