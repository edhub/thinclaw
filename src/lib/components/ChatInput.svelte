<script lang="ts">
  import { onMount } from 'svelte'
  import { Image, FileUp, X, Square, ArrowUp, AlertCircle, FileText } from 'lucide-svelte'
  import { isStreaming, queueLength } from '$lib/stores/chat'
  import type { ImageContent } from '@mariozechner/pi-ai'
  import FilePicker from '$lib/components/FilePicker.svelte'
  import { listWorkspaceFiles, fuzzyFilter, getFilePreview, type FileEntry } from '$lib/fs/mention'
  import { writeFile } from '$lib/fs/opfs'

  interface Props {
    onSend: (content: string, images: ImageContent[]) => void
    onAbort?: () => void
    open?: boolean
    onClose?: () => void
    isModal?: boolean
  }
  let { onSend, onAbort, open = true, onClose, isModal = false }: Props = $props()

  const DRAFT_KEY = 'thinclaw:input-draft'

  let value = $state('')
  let images = $state<ImageContent[]>([])
  let textareaEl = $state<HTMLTextAreaElement | undefined>(undefined)
  let fileInputEl = $state<HTMLInputElement | undefined>(undefined)
  let textFileInputEl = $state<HTMLInputElement | undefined>(undefined)
  let isDraggingOver = $state(false)
  let isMobile = $state(false)
  let uploadErrors = $state<string[]>([])
  let uploadErrorTimer: ReturnType<typeof setTimeout> | null = null

  // ── @mention state ────────────────────────────────────────────────────────
  let fileChips = $state<FileEntry[]>([])
  let allFiles = $state<FileEntry[]>([])
  let showDropdown = $state(false)
  let mentionQuery = $state('')
  let mentionStart = $state(-1)
  let dropdownIndex = $state(0)

  const filteredFiles = $derived(fuzzyFilter(allFiles, mentionQuery))

  $effect(() => {
    void filteredFiles
    dropdownIndex = 0
  })

  onMount(() => {
    isMobile = window.matchMedia('(max-width: 639px)').matches
    const saved = localStorage.getItem(DRAFT_KEY)
    if (saved) {
      value = saved
      setTimeout(resizeTextarea, 0)
    }
  })

  $effect(() => {
    if (value) {
      localStorage.setItem(DRAFT_KEY, value)
    } else {
      localStorage.removeItem(DRAFT_KEY)
    }
  })

  export function focus() {
    textareaEl?.focus()
  }

  async function refreshFiles() {
    try {
      allFiles = await listWorkspaceFiles()
    } catch {
      allFiles = []
    }
  }

  function checkMentionTrigger(textarea: HTMLTextAreaElement) {
    const cursor = textarea.selectionStart
    const before = textarea.value.slice(0, cursor)
    const match = /@([^\s@]*)$/.exec(before)
    if (match) {
      if (!showDropdown) refreshFiles()
      mentionQuery = match[1]
      mentionStart = match.index
      showDropdown = true
    } else {
      showDropdown = false
      mentionQuery = ''
      mentionStart = -1
    }
  }

  function selectFile(file: FileEntry) {
    if (mentionStart >= 0) {
      value = value.slice(0, mentionStart) + value.slice(mentionStart + 1 + mentionQuery.length)
    }
    if (!fileChips.find((c) => c.path === file.path)) {
      fileChips = [...fileChips, file]
    }
    showDropdown = false
    mentionQuery = ''
    mentionStart = -1
    textareaEl?.focus()
  }

  function removeChip(path: string) {
    fileChips = fileChips.filter((c) => c.path !== path)
  }

  function fileToImageContent(file: File): Promise<ImageContent> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const commaIdx = dataUrl.indexOf(',')
        const data = dataUrl.slice(commaIdx + 1)
        resolve({ type: 'image', data, mimeType: file.type })
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

  async function addFiles(files: FileList | File[]) {
    const valid = Array.from(files).filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type))
    const contents = await Promise.all(valid.map(fileToImageContent))
    images = [...images, ...contents]
  }

  const TEXT_EXTENSIONS = new Set([
    'txt',
    'md',
    'markdown',
    'rst',
    'adoc',
    'json',
    'jsonc',
    'yaml',
    'yml',
    'toml',
    'csv',
    'tsv',
    'xml',
    'sql',
    'ini',
    'cfg',
    'conf',
    'env',
    'properties',
    'editorconfig',
    'sh',
    'bash',
    'zsh',
    'fish',
    'ps1',
    'bat',
    'html',
    'htm',
    'css',
    'scss',
    'less',
    'svelte',
    'vue',
    'ts',
    'tsx',
    'js',
    'jsx',
    'mjs',
    'cjs',
    'py',
    'rb',
    'go',
    'rs',
    'java',
    'kt',
    'swift',
    'c',
    'cpp',
    'h',
    'hpp',
    'cs',
    'php',
    'r',
    'scala',
    'lua',
    'graphql',
    'gql',
    'proto',
    'tf',
    'hcl',
    'gitignore',
    'dockerignore',
    'npmignore',
    'log',
  ])

  function isTextFile(file: File): boolean {
    if (file.type.startsWith('text/')) return true
    if (['application/json', 'application/xml', 'application/javascript'].includes(file.type))
      return true
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    return TEXT_EXTENSIONS.has(ext)
  }

  async function uploadLocalFiles(files: FileList | File[]) {
    const all = Array.from(files)
    const rejected: string[] = []
    const uploaded: FileEntry[] = []

    for (const file of all) {
      if (!isTextFile(file)) {
        rejected.push(file.name)
        continue
      }
      try {
        const text = await file.text()
        const opfsPath = `uploads/${file.name}`
        await writeFile(opfsPath, text)
        uploaded.push({ name: file.name, path: opfsPath })
      } catch {
        rejected.push(file.name)
      }
    }

    for (const entry of uploaded) {
      if (!fileChips.find((c) => c.path === entry.path)) {
        fileChips = [...fileChips, entry]
      }
    }

    if (rejected.length > 0) {
      if (uploadErrorTimer) clearTimeout(uploadErrorTimer)
      uploadErrors = rejected
      uploadErrorTimer = setTimeout(() => {
        uploadErrors = []
      }, 3000)
    }
  }

  function removeImage(idx: number) {
    images = images.filter((_, i) => i !== idx)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (isModal && e.key === 'Escape') {
      e.preventDefault()
      onClose?.()
      return
    }
    if (showDropdown && e.key === 'Escape') {
      e.preventDefault()
      showDropdown = false
      return
    }

    if (showDropdown && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        dropdownIndex = Math.min(dropdownIndex + 1, filteredFiles.length - 1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        dropdownIndex = Math.max(dropdownIndex - 1, 0)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredFiles[dropdownIndex]) selectFile(filteredFiles[dropdownIndex])
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  function handleInput(e: Event) {
    autoResize(e)
    checkMentionTrigger(e.target as HTMLTextAreaElement)
  }

  function handleBlur() {
    setTimeout(() => {
      showDropdown = false
    }, 150)
  }

  async function submit() {
    const trimmed = value.trim()
    if (!trimmed && images.length === 0 && fileChips.length === 0) return

    const currentImages = $state.snapshot(images) as ImageContent[]
    const currentChips = $state.snapshot(fileChips) as FileEntry[]

    value = ''
    localStorage.removeItem(DRAFT_KEY)
    images = []
    fileChips = []
    showDropdown = false
    if (textareaEl) textareaEl.style.height = 'auto'

    let content = trimmed
    if (currentChips.length > 0) {
      const parts: string[] = []
      for (const chip of currentChips) {
        try {
          const preview = await getFilePreview(chip.path, 20)
          if (preview.truncated) {
            const returnedLines = preview.content.split('\n').length
            parts.push(
              `<file-context path="${chip.path}" lines="1-${returnedLines}" total="${preview.totalLines}" truncated="true">\n` +
                `${preview.content}\n</file-context>`,
            )
          } else {
            parts.push(`<file-context path="${chip.path}">\n${preview.content}\n</file-context>`)
          }
        } catch {
          parts.push(`<file-context path="${chip.path}" error="true"></file-context>`)
        }
      }
      content = parts.join('\n\n') + (trimmed ? '\n\n' + trimmed : '')
    }

    onSend(content, currentImages)
    textareaEl?.focus()
  }

  function autoResize(e: Event) {
    const el = e.target as HTMLTextAreaElement
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  function resizeTextarea() {
    if (!textareaEl) return
    textareaEl.style.height = 'auto'
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 200) + 'px'
  }

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    if (input.files) addFiles(input.files)
    input.value = ''
  }

  function handleTextFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    if (input.files) uploadLocalFiles(input.files)
    input.value = ''
  }

  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (const item of items) {
      if (item.kind === 'file' && ACCEPTED_IMAGE_TYPES.includes(item.type)) {
        const f = item.getAsFile()
        if (f) imageFiles.push(f)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      addFiles(imageFiles)
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    isDraggingOver = true
  }
  function handleDragLeave() {
    isDraggingOver = false
  }
  async function handleDrop(e: DragEvent) {
    e.preventDefault()
    isDraggingOver = false
    if (!e.dataTransfer?.files) return
    const all = Array.from(e.dataTransfer.files)
    const imageFiles = all.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type))
    const otherFiles = all.filter((f) => !ACCEPTED_IMAGE_TYPES.includes(f.type))
    if (imageFiles.length > 0) await addFiles(imageFiles)
    if (otherFiles.length > 0) await uploadLocalFiles(otherFiles)
  }

  function previewSrc(img: ImageContent) {
    return `data:${img.mimeType};base64,${img.data}`
  }

  const canSend = $derived(value.trim().length > 0 || images.length > 0 || fileChips.length > 0)
</script>

<!-- Hidden inputs -->
<input
  bind:this={fileInputEl}
  type="file"
  accept="image/jpeg,image/png,image/gif,image/webp"
  multiple
  style="display:none"
  onchange={handleFileChange}
/>
<input
  bind:this={textFileInputEl}
  type="file"
  accept="text/*,.md,.ts,.tsx,.js,.jsx,.json,.yaml,.yml,.toml,.py,.go,.rs,.sql,.csv,.sh,.html,.css,.svelte"
  multiple
  style="display:none"
  onchange={handleTextFileChange}
/>

<div
  class="input-area px-6 pb-4 pt-3 border-t border-line bg-surface flex-shrink-0"
  class:modal-mode={isModal}
  role="region"
  aria-label="消息输入框"
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <!-- Image previews -->
  {#if images.length > 0}
    <div class="flex flex-wrap gap-2 mb-2">
      {#each images as img, i}
        <div class="relative w-16 h-16 flex-shrink-0">
          <img
            src={previewSrc(img)}
            alt="attachment {i + 1}"
            class="w-16 h-16 object-cover rounded-lg border border-line block"
          />
          <button
            class="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-fg-sub
                   border-none cursor-pointer flex items-center justify-center text-white p-0
                   transition-colors duration-100 z-10 hover:bg-error"
            onclick={() => removeImage(i)}
            title="移除图片"
            type="button"
          >
            <X size={10} />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- File chips -->
  {#if fileChips.length > 0}
    <div class="flex flex-wrap gap-1.5 mb-2">
      {#each fileChips as chip}
        <div
          class="inline-flex items-center gap-1.5 bg-surface-elevated border border-line
                    rounded-md px-2 py-1 text-[0.78rem] text-fg-sub max-w-[240px]"
        >
          <FileText size={11} class="text-fg-muted flex-shrink-0" />
          <span class="truncate min-w-0">{chip.name}</span>
          <button
            class="bg-transparent border-none p-0 cursor-pointer text-fg-muted flex
                   items-center flex-shrink-0 rounded transition-colors duration-100
                   hover:text-error"
            onclick={() => removeChip(chip.path)}
            type="button"
            title="移除文件"
          >
            <X size={9} />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Upload error notice -->
  {#if uploadErrors.length > 0}
    <div
      class="flex items-center gap-1.5 text-[0.78rem] text-error bg-error-bg
                border border-error rounded-md px-2.5 py-1.5 mb-2"
    >
      <AlertCircle size={12} class="flex-shrink-0" />
      不支持：{uploadErrors.join('、')}（仅限文本 / 代码文件）
    </div>
  {/if}

  <!-- Input wrapper (relative for dropdown) -->
  <div class="relative">
    {#if showDropdown}
      <FilePicker files={filteredFiles} selectedIndex={dropdownIndex} onSelect={selectFile} />
    {/if}

    <div
      class="input-box flex flex-col rounded-xl px-3 pt-2.5 pb-2"
      class:drag-over={isDraggingOver}
    >
      <textarea
        bind:this={textareaEl}
        bind:value
        placeholder={$isStreaming
          ? $queueLength > 0
            ? `AI 正在回复，已排队 ${$queueLength} 条…`
            : 'AI 正在回复，可继续输入（Enter 排队）…'
          : isMobile
            ? '输入消息，@ 引用文件…'
            : '输入消息（Enter 发送，Shift+Enter 换行，@ 引用文件）'}
        rows="1"
        class="w-full bg-transparent border-none outline-none resize-none text-[0.9375rem]
               leading-relaxed text-fg font-[inherit] max-h-[200px] overflow-y-auto
               placeholder:text-fg-muted"
        onkeydown={handleKeydown}
        oninput={handleInput}
        onblur={handleBlur}
        onpaste={handlePaste}
      ></textarea>

      <div class="flex items-center justify-between mt-1.5">
        <div class="flex items-center gap-0.5">
          <button
            class="attach-btn w-[34px] h-[34px] flex items-center justify-center rounded-lg
                   bg-transparent border-none cursor-pointer text-fg-muted flex-shrink-0
                   transition-colors duration-100 hover:text-fg-sub hover:bg-surface-hover"
            type="button"
            onclick={() => fileInputEl?.click()}
            title="附加图片"
          >
            <Image size={17} />
          </button>
          <button
            class="attach-btn w-[34px] h-[34px] flex items-center justify-center rounded-lg
                   bg-transparent border-none cursor-pointer text-fg-muted flex-shrink-0
                   transition-colors duration-100 hover:text-fg-sub hover:bg-surface-hover"
            type="button"
            onclick={() => textFileInputEl?.click()}
            title="上传本地文本文件到工作区"
          >
            <FileUp size={16} />
          </button>
        </div>

        <div class="flex items-center gap-0.5">
          {#if $isStreaming}
            <button
              class="w-[34px] h-[34px] flex items-center justify-center rounded-lg
                     bg-transparent border border-line cursor-pointer text-fg-sub flex-shrink-0
                     transition-all duration-100 hover:text-error hover:border-error hover:bg-error-bg"
              onclick={onAbort}
              title="停止"
              type="button"
            >
              <Square size={14} />
            </button>
          {/if}
          <button
            class="w-[34px] h-[34px] flex items-center justify-center rounded-lg bg-accent
                   border-none cursor-pointer text-white flex-shrink-0
                   transition-opacity duration-100 disabled:opacity-40 disabled:cursor-not-allowed
                   not-disabled:hover:opacity-85"
            disabled={!canSend}
            onclick={submit}
            title={$isStreaming ? '排队发送' : '发送'}
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </div>
  </div>

  <p class="hint text-[0.72rem] text-fg-muted text-center mt-2 mb-0">
    ThinClaw 将对话存储在您的浏览器本地，API 密钥不会离开您的设备。
  </p>
</div>

<style>
  .input-box {
    background: var(--surface-input);
    border: 1px solid var(--border);
    transition: border-color 0.15s;
  }

  .input-box:focus-within {
    border-color: var(--accent);
  }

  .input-box.drag-over {
    border-color: var(--accent);
    background: var(--surface-hover);
  }

  .modal-mode {
    border-top: none !important;
    border-radius: 16px;
    padding: 16px 24px 20px;
  }

  .modal-mode .hint {
    display: none;
  }

  @media (max-width: 639px) {
    .input-area {
      padding: 8px 12px 16px;
    }

    .hint {
      display: none;
    }
  }
</style>
