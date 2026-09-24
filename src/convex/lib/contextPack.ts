export type ContextTrust = "workspace_entry" | "untrusted_source_text";

export type ContextEvidence = {
  ref: string;
  version: string;
  source: string;
  title: string;
  trust: ContextTrust;
  text: string;
  truncated?: boolean;
};

export type ContextPersona = {
  id: string;
  name: string;
  role?: string;
  goals?: string[];
  pains?: string[];
  objections?: string[];
  channels?: string[];
  country?: string;
  demographics?: string;
  culturalContext?: string;
  bigFive?: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  };
  evidence?: string;
};

export type ContextJourney = {
  id: string;
  name: string;
  goal?: string;
  personaId?: string;
  stages: Array<{
    stage: string;
    cells: string[];
    score?: number;
  }>;
};

export type ContextBuild = {
  id: string;
  name: string;
  kind: "website" | "app";
  idea?: string;
  positioning?: string;
  differentiators?: string[];
  personaIds: string[];
  journeyMapIds: string[];
};

export type ContextPage = {
  id: string;
  name: string;
  path: string;
  goal?: string;
  personaId?: string;
  journeyStage?: string;
};

export type ContextPack = {
  projectId: string;
  builtAt: number;
  /** Plain-text business brief (lib/businessProfile.ts), first in every prompt. */
  businessBrief: string[];
  products: Array<{ id: string; title: string; price?: string; description?: string }>;
  personas: ContextPersona[];
  journeys: ContextJourney[];
  build?: ContextBuild;
  page?: ContextPage;
  evidence: ContextEvidence[];
  gaps: string[];
  assumptions: string[];
};

/** Deterministic provenance label for visible evidence; not cryptographic integrity. */
export function contextVersion(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function contextEvidence(input: Omit<ContextEvidence, "version">): ContextEvidence {
  return {
    ...input,
    version: contextVersion(JSON.stringify({
      source: input.source,
      title: input.title,
      trust: input.trust,
      text: input.text,
    })),
  };
}

/**
 * Keep evidence in one explicitly typed data block. This is a prompt boundary,
 * not a security claim about model behavior: feature actions expose no model
 * tool definitions, and source text is never parsed into tool arguments.
 */
export function serializeContextEvidence(evidence: ContextEvidence[]): string {
  return JSON.stringify(evidence.map((item) => ({
    ref: item.ref,
    version: item.version,
    source: item.source,
    title: item.title,
    trust: item.trust,
    text: item.text,
    truncated: item.truncated ?? false,
  })));
}
