/**
 * Safety / autonomy gate.
 *
 * Every action is evaluated against its tier, the user's current confidence
 * score, and policy rules before execution. Phase 2 will delegate to OPA.
 */

export type Tier = 0 | 1 | 2 | 3;

export interface Action {
  name: string;
  tier: Tier;
  reversible: boolean;
  payload: Record<string, unknown>;
}

export type Decision =
  | { mode: "act"; reason: string }
  | { mode: "ask"; reason: string }
  | { mode: "observe"; reason: string }
  | { mode: "deny"; reason: string };

export interface GateContext {
  confidence: number;
  userConsent: boolean;
  biometricVerified: boolean;
  blockedActions: string[];
}

export function evaluate(action: Action, ctx: GateContext): Decision {
  if (ctx.blockedActions.includes(action.name)) {
    return { mode: "deny", reason: "action is in blocked list" };
  }

  switch (action.tier) {
    case 0:
      return { mode: "act", reason: "read-only" };

    case 1:
      if (ctx.confidence >= 0.85) return { mode: "act", reason: "high-confidence write" };
      if (ctx.confidence >= 0.5)  return { mode: "ask", reason: "moderate confidence" };
      return { mode: "observe", reason: "insufficient confidence" };

    case 2:
      if (ctx.userConsent) return { mode: "act", reason: "consented external action" };
      return { mode: "ask", reason: "external communication requires consent" };

    case 3:
      if (!ctx.userConsent) return { mode: "ask", reason: "critical action requires consent" };
      if (!ctx.biometricVerified) return { mode: "ask", reason: "biometric verification required" };
      if (!action.reversible) return { mode: "ask", reason: "irreversible critical action — confirm twice" };
      return { mode: "act", reason: "fully authorized critical action" };
  }
}
