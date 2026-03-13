/**
 * Image generation tool via laozhang.ai (Gemini image model).
 *
 * This tool is NOT in the default tool list. It must be explicitly enabled
 * per conversation via the image tool toggle in the chat UI.
 *
 * Model:    gemini-3-pro-image-preview
 * Endpoint: https://api.laozhang.ai/v1beta/models/gemini-3-pro-image-preview:generateContent
 * Auth:     Bearer laozhangApiKey (from Settings)
 *
 * The execute function stores the raw base64 in `details` for the UI to render.
 * The AI receives a short text summary (not the raw base64) to avoid bloating context.
 */
import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { get } from 'svelte/store'
import { settings } from '$lib/stores/settings'

// ── API ────────────────────────────────────────────────────────────────────────

const IMAGE_ENDPOINT =
  'https://api.laozhang.ai/v1beta/models/gemini-3-pro-image-preview:generateContent'

export interface GeneratedImage {
  imageData: string  // base64-encoded
  mimeType: string
  prompt: string
  aspectRatio: string
  imageSize: string
}

async function callImageApi(
  prompt: string,
  aspectRatio: string,
  imageSize: string,
  apiKey: string,
): Promise<GeneratedImage> {
  const res = await fetch(IMAGE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio, imageSize },
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Image API error ${res.status}: ${body}`)
  }

  const json = await res.json()
  const part = json?.candidates?.[0]?.content?.parts?.[0]?.inlineData
  if (!part?.data) {
    throw new Error('Image API returned no image data')
  }

  return {
    imageData: part.data as string,
    mimeType: (part.mimeType as string) ?? 'image/png',
    prompt,
    aspectRatio,
    imageSize,
  }
}

// ── Tool definition ────────────────────────────────────────────────────────────

const imageGenerateParams = Type.Object({
  prompt: Type.String({
    description:
      'Detailed image generation prompt in English. Be specific about style, lighting, composition, subject, and mood. High-quality prompts produce better results.',
  }),
  aspectRatio: Type.Optional(
    Type.Union(
      [
        Type.Literal('1:1'),
        Type.Literal('16:9'),
        Type.Literal('9:16'),
        Type.Literal('4:3'),
        Type.Literal('3:4'),
      ],
      {
        description: 'Image aspect ratio. Defaults to "16:9" if not specified.',
      },
    ),
  ),
  imageSize: Type.Optional(
    Type.Union([Type.Literal('1K'), Type.Literal('2K'), Type.Literal('4K')], {
      description: 'Image resolution. Defaults to "1K". Use "4K" only when the user explicitly requests high resolution.',
    }),
  ),
})

export const imageGenerateTool: AgentTool<typeof imageGenerateParams> = {
  name: 'generate_image',
  label: 'Generate Image',
  description:
    'Generate an image based on a detailed prompt. Use when the user asks to create, draw, or visualise something. Write a rich, descriptive English prompt — include subject, style, lighting, composition, and mood for best results. Defaults: aspectRatio="16:9", imageSize="1K".',
  parameters: imageGenerateParams,
  execute: async (_id, { prompt, aspectRatio = '16:9', imageSize = '1K' }) => {
    const apiKey = get(settings).laozhangApiKey
    if (!apiKey) {
      throw new Error('laozhang API key is not configured. Please add it in Settings.')
    }

    const image = await callImageApi(prompt, aspectRatio, imageSize, apiKey)
    return {
      content: [
        {
          type: 'text' as const,
          text: `Image generated successfully. Prompt: "${prompt}" | Size: ${imageSize} | Ratio: ${aspectRatio}`,
        },
      ],
      details: image satisfies GeneratedImage,
    }
  },
}
