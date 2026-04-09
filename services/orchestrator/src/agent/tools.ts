/**
 * ARIA Phase 1 tool definitions — Claude-compatible tool schemas.
 * Phase 2 will load these from tools/mcp/registry.yaml and bind to MCP servers.
 */

import type Anthropic from "@anthropic-ai/sdk";

export const ARIA_TOOLS: Anthropic.Tool[] = [
  {
    name: "remember",
    description:
      "Store a durable memory about the user (preference, fact, goal, relationship, event). " +
      "Use when the user shares something worth recalling later.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["semantic", "episodic", "profile", "emotional"] },
        content: { type: "string", description: "The memory to store." },
        tags: { type: "array", items: { type: "string" } },
        salience: { type: "number", description: "0..1 importance score." },
      },
      required: ["kind", "content"],
    },
  },
  {
    name: "recall",
    description: "Search long-term memory for context about a topic, person, project, or event.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        top_k: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "set_timer",
    description: "Set a timer or reminder for the user.",
    input_schema: {
      type: "object",
      properties: {
        seconds: { type: "number" },
        label: { type: "string" },
      },
      required: ["seconds"],
    },
  },
  {
    name: "web_search",
    description: "Search the web for current information.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "append_note",
    description: "Append a note to the user's personal journal.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["text"],
    },
  },
];
