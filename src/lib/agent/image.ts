/**
 * Image generation & editing tools via Gemini image models.
 *
 * Two tools are exported:
 *   imageGenerateTool  — generate_image: creates a new image from a prompt
 *   imageEditTool      — edit_image: edits the most-recently-uploaded or generated image
 *
 * Both tools are NOT in the default tool list. They must be explicitly enabled
 * per conversation via the image tool toggle in the chat UI.
 *
 * Supported models (configured via Settings.imageGenerationModel):
 *   laozhang:gemini-3-pro-image-preview          — laozhang.ai  (generate + edit)
 *   lingyaai:gemini-3.1-flash-image-preview      — lingyaai.cn  (generate + edit)
 *
 * Last-image context:
 *   Whenever the user uploads an image or generate_image succeeds, call
 *   setLastImageContext() so that edit_image can automatically pick it up.
 *   The AI only needs to supply the edit prompt — no base64 round-trip required.
 */
import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { get } from 'svelte/store'
import { settings } from '$lib/stores/settings'

// ── Image model registry ───────────────────────────────────────────────────────

export interface ImageModelConfig {
  /** Unique key: `${provider}:${modelId}` */
  key: string
  /** Display name shown in Settings */
  name: string
  provider: 'laozhang' | 'lingyaai'
  modelId: string
  baseUrl: string
}

export const IMAGE_MODELS: ImageModelConfig[] = [
  {
    key: 'laozhang:gemini-3-pro-image-preview',
    name: 'Gemini 3 Pro Image · 老张',
    provider: 'laozhang',
    modelId: 'gemini-3-pro-image-preview',
    baseUrl: 'https://api.laozhang.ai',
  },
  {
    key: 'lingyaai:gemini-3.1-flash-image-preview',
    name: 'Gemini 3.1 Flash Image · 灵芽',
    provider: 'lingyaai',
    modelId: 'gemini-3.1-flash-image-preview',
    baseUrl: 'https://api.lingyaai.cn',
  },
]

export const DEFAULT_IMAGE_MODEL_KEY = 'laozhang:gemini-3-pro-image-preview'

export function getImageModelByKey(key: string): ImageModelConfig {
  return IMAGE_MODELS.find((m) => m.key === key) ?? IMAGE_MODELS[0]
}

/** Build the Gemini generateContent endpoint URL for a given model config. */
function modelEndpoint(model: ImageModelConfig): string {
  return `${model.baseUrl}/v1beta/models/${model.modelId}:generateContent`
}

// ── Supported aspect ratios ────────────────────────────────────────────────────

const SUPPORTED_RATIOS: { ratio: number; str: string }[] = [
  { ratio: 1 / 1, str: '1:1' },
  { ratio: 16 / 9, str: '16:9' },
  { ratio: 9 / 16, str: '9:16' },
  { ratio: 4 / 3, str: '4:3' },
  { ratio: 3 / 4, str: '3:4' },
]

/** Map a width/height pair to the closest supported aspect ratio string. */
function closestAspectRatio(w: number, h: number): string {
  if (h === 0) return '1:1'
  const r = w / h
  return SUPPORTED_RATIOS.reduce((best, c) =>
    Math.abs(c.ratio - r) < Math.abs(best.ratio - r) ? c : best,
  ).str
}

/**
 * Detect the aspect ratio of a base64-encoded image by decoding it in the
 * browser via an HTMLImageElement, then snapping to the closest supported ratio.
 */
function detectAspectRatio(base64: string, mimeType: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      resolve(closestAspectRatio(img.naturalWidth, img.naturalHeight))
    }
    img.onerror = () => resolve('1:1')
    img.src = `data:${mimeType};base64,${base64}`
  })
}

// ── Last-image context (shared between generate & edit) ────────────────────────

export interface ImageContext {
  imageData: string // base64
  mimeType: string
  /** Closest supported aspect ratio, e.g. "16:9". Detected or copied from generation. */
  aspectRatio: string
}

let _lastImageContext: ImageContext | null = null

/** Set context with a known aspect ratio (e.g. right after generate_image). */
export function setLastImageContext(ctx: ImageContext | null): void {
  _lastImageContext = ctx
}

/**
 * Set context from a user-uploaded image.
 * Detects the aspect ratio asynchronously via HTMLImageElement.
 */
export async function setLastImageContextFromUpload(
  imageData: string,
  mimeType: string,
): Promise<void> {
  const aspectRatio = await detectAspectRatio(imageData, mimeType)
  _lastImageContext = { imageData, mimeType, aspectRatio }
}

// ── Shared result type ─────────────────────────────────────────────────────────

export interface GeneratedImage {
  imageData: string // base64-encoded
  mimeType: string
  prompt: string
  aspectRatio: string
  imageSize: string
  /** 'generate' | 'edit' */
  operation: 'generate' | 'edit'
}

// ── Internal API helpers ───────────────────────────────────────────────────────

/** Resolve API key for the given provider from current settings. */
function resolveApiKey(provider: string): string {
  const s = get(settings)
  switch (provider) {
    case 'laozhang':
      return s.laozhangApiKey
    case 'lingyaai':
      return s.lingyaaiApiKey
    default:
      return ''
  }
}

/** Get the currently configured image model from settings. */
function currentImageModel(): ImageModelConfig {
  const s = get(settings)
  return getImageModelByKey(s.imageGenerationModel ?? DEFAULT_IMAGE_MODEL_KEY)
}

async function callGenerateApi(
  prompt: string,
  aspectRatio: string,
  imageSize: string,
  model: ImageModelConfig,
  apiKey: string,
): Promise<GeneratedImage> {
  const res = await fetch(modelEndpoint(model), {
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
    operation: 'generate',
  }
}

async function callEditApi(
  editPrompt: string,
  sourceImage: ImageContext,
  aspectRatio: string,
  model: ImageModelConfig,
  apiKey: string,
): Promise<GeneratedImage> {
  const res = await fetch(modelEndpoint(model), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: editPrompt },
            { inlineData: { mimeType: sourceImage.mimeType, data: sourceImage.imageData } },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio },
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Image edit API error ${res.status}: ${body}`)
  }

  const json = await res.json()
  const part = json?.candidates?.[0]?.content?.parts?.[0]?.inlineData
  if (!part?.data) {
    throw new Error('Image edit API returned no image data')
  }

  return {
    imageData: part.data as string,
    mimeType: (part.mimeType as string) ?? 'image/png',
    prompt: editPrompt,
    aspectRatio,
    imageSize: '',
    operation: 'edit',
  }
}

// ── generate_image tool ────────────────────────────────────────────────────────

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
      description:
        'Image resolution. Defaults to "1K". Use "4K" only when the user explicitly requests high resolution.',
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
    const model = currentImageModel()
    const apiKey = resolveApiKey(model.provider)
    if (!apiKey) {
      throw new Error(
        `API key for provider "${model.provider}" is not configured. Please add it in Settings.`,
      )
    }

    const image = await callGenerateApi(prompt, aspectRatio, imageSize, model, apiKey)

    // Store so edit_image can use it — include the known aspect ratio
    setLastImageContext({ imageData: image.imageData, mimeType: image.mimeType, aspectRatio })

    return {
      content: [
        {
          type: 'text' as const,
          text: `Image generated successfully. Prompt: "${prompt}" | Size: ${imageSize} | Ratio: ${aspectRatio} | Model: ${model.name}`,
        },
      ],
      details: image satisfies GeneratedImage,
    }
  },
}

// ── edit_image tool ────────────────────────────────────────────────────────────

const imageEditParams = Type.Object({
  prompt: Type.String({
    description:
      'Edit instruction in English describing what to change in the image. Be specific about what to add, remove, replace, or modify. Example: "Replace the sky with a dramatic sunset", "Add a red hat to the person", "Make the background blurry".',
  }),
})

export const imageEditTool: AgentTool<typeof imageEditParams> = {
  name: 'edit_image',
  label: 'Edit Image',
  description:
    'Edit the most recently uploaded or generated image based on an instruction. Use when the user asks to modify, change, or transform an existing image. The tool automatically uses the last image from context and preserves its original aspect ratio — no need to supply image data or aspect ratio. Write a clear English edit instruction.',
  parameters: imageEditParams,
  execute: async (_id, { prompt }) => {
    const model = currentImageModel()
    const apiKey = resolveApiKey(model.provider)
    if (!apiKey) {
      throw new Error(
        `API key for provider "${model.provider}" is not configured. Please add it in Settings.`,
      )
    }

    if (!_lastImageContext) {
      throw new Error(
        'No image in context to edit. Please upload an image or generate one first.',
      )
    }

    // Preserve the source image's aspect ratio
    const aspectRatio = _lastImageContext.aspectRatio

    const image = await callEditApi(prompt, _lastImageContext, aspectRatio, model, apiKey)

    // Update context to the edited image, keeping the same aspect ratio
    setLastImageContext({ imageData: image.imageData, mimeType: image.mimeType, aspectRatio })

    return {
      content: [
        {
          type: 'text' as const,
          text: `Image edited successfully. Instruction: "${prompt}" | Ratio: ${aspectRatio} | Model: ${model.name}`,
        },
      ],
      details: image satisfies GeneratedImage,
    }
  },
}
