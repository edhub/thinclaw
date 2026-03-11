/**
 * Browser-safe tools for the AI agent.
 * These run entirely in the browser — no network calls, no file system.
 */
import { Type } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';

// Define params schemas first to avoid "used before declaration" errors
const calculateParams = Type.Object({
  expression: Type.String({
    description: 'JS math expression to evaluate, e.g. "2 + 2 * 3" or "Math.sqrt(144)"',
  }),
});

const datetimeParams = Type.Object({});

/** Evaluate a mathematical expression using the JS engine */
export const calculateTool: AgentTool<typeof calculateParams> = {
  name: 'calculate',
  label: 'Calculator',
  description:
    'Evaluate a mathematical expression. Supports arithmetic, exponentiation, and JS Math functions (Math.sqrt, Math.PI, etc.). Use for calculations, unit conversions, and percentages.',
  parameters: calculateParams,
  execute: async (_id, { expression }) => {
    try {
      // eslint-disable-next-line no-new-func
      const result = new Function(`"use strict"; return (${expression})`)();
      const text =
        typeof result === 'number' && !isFinite(result)
          ? `Error: result is ${result}`
          : `${expression} = ${result}`;
      return {
        content: [{ type: 'text' as const, text }],
        details: { expression, result },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: 'text' as const, text: `Error evaluating "${expression}": ${msg}` }],
        details: { expression, error: msg },
      };
    }
  },
};

/** Return the current date and time in the user's local timezone */
export const datetimeTool: AgentTool<typeof datetimeParams> = {
  name: 'get_datetime',
  label: 'Date & Time',
  description: "Get the current date and time in the user's local timezone.",
  parameters: datetimeParams,
  execute: async () => {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const local = now.toLocaleString(undefined, {
      timeZone: tz,
      dateStyle: 'full',
      timeStyle: 'long',
    });
    const iso = now.toISOString();
    return {
      content: [{ type: 'text' as const, text: `${local} (${tz})` }],
      details: { iso, local, timezone: tz },
    };
  },
};

// Use double cast to widen the typed array safely
export const browserTools: AgentTool[] = [
  calculateTool as unknown as AgentTool,
  datetimeTool as unknown as AgentTool,
];
