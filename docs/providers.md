# AI Provider Support

ThinClaw calls AI APIs directly from the browser. This means CORS support is required.

---

## Currently Supported

### OpenAI

| Field | Value |
|---|---|
| Package | `@ai-sdk/openai` |
| Browser CORS | ✅ Supported |
| Config | API key only |
| Models | GPT-4o, GPT-4o Mini, GPT-4 Turbo, GPT-3.5 Turbo |

OpenAI allows cross-origin requests from browsers. No proxy needed.

Get your API key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).

---

## Planned / Not Yet Implemented

### Anthropic (Claude)

| Field | Value |
|---|---|
| Package | `@ai-sdk/anthropic` |
| Browser CORS | ❌ Blocked (requires `anthropic-dangerous-direct-browser-access: true` header) |
| Workaround | CORS proxy (see below) |

Anthropic blocks browser-origin requests by default.
To use Claude in ThinClaw, you need a proxy that adds the required header.

**Cloudflare Worker proxy example:**

```js
// worker.js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'api.anthropic.com';

    const headers = new Headers(request.headers);
    headers.set('anthropic-dangerous-direct-browser-access', 'true');

    return fetch(url.toString(), {
      method: request.method,
      headers,
      body: request.body,
    });
  },
};
```

Then set the Anthropic base URL in ThinClaw settings to your Worker URL.

### Gemini (Google)

| Field | Value |
|---|---|
| Package | `@ai-sdk/google` |
| Browser CORS | ⚠️ Varies by endpoint |

### Ollama (local models)

| Field | Value |
|---|---|
| Package | `@ai-sdk/ollama` |
| Browser CORS | ✅ When Ollama is configured with `OLLAMA_ORIGINS=*` |
| Config | Base URL (e.g. `http://localhost:11434`) |

To run Ollama with browser access:

```bash
OLLAMA_ORIGINS=* ollama serve
```

---

## CORS Proxy Pattern

If a provider blocks browser requests, the recommended approach is a stateless edge proxy
(Cloudflare Worker, Vercel Edge Function, etc.) that forwards requests without storing
any data. The proxy should:

1. Forward all request headers and body verbatim
2. Add any provider-required browser-override headers
3. Return the response stream as-is
4. Not log or store request content

See `docs/cors-proxy.md` for a deployable template.
