import "server-only";
import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { e2eStubs } from "./e2e-switch";
import { stubModel, type ClaudeJob } from "./e2e-stubs";

// The model behind each Claude job: Claude Opus 5.5 (or ANTHROPIC_MODEL), and only while the judges'-path test's
// stubs are on (GOOD_FAITH_E2E_STUBS=1 off Render, src/lib/e2e-switch.ts) the job's scripted stand-in, so that test
// spends no Claude call. A test script that passes its own stubbed model to a job never comes here.

/** Opus 5.5: telling wear and tear from damage is the core judgment, and the extra cost over Sonnet is a few dollars. */
export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

export type { ClaudeJob };

export function claude(job: ClaudeJob): LanguageModel {
  return e2eStubs() ? stubModel(job) : anthropic(MODEL);
}

/** The model a job's record names: the stub's name while the stubs are on, never Claude's. */
export const modelName = () => (e2eStubs() ? "e2e stub" : MODEL);
