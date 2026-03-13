<script lang="ts">
  import { onMount } from 'svelte';
  import { isStreaming, queueLength } from '$lib/stores/chat';
  import type { ImageContent } from '@mariozechner/pi-ai';
  import FilePicker from '$lib/components/FilePicker.svelte';
  import {
    listWorkspaceFiles,
    fuzzyFilter,
    getFilePreview,
    type FileEntry,
  } from '$lib/fs/mention';
  import { writeFile } from '$lib/fs/opfs';

  interface Props {
    onSend: (content: string, images: ImageContent[]) => void;
    onAbort?: () => void;
  }
  let { onSend, onAbort }: Props = $props();

  let value = $state('');
  let images = $state<ImageContent[]>([]);
  let textareaEl = $state<HTMLTextAreaElement | undefined>(undefined);
  let fileInputEl = $state<HTMLInputElement | undefined>(undefined);
  let textFileInputEl = $state<HTMLInputElement | undefined>(undefined);
  let isDraggingOver = $state(false);
  let isMobile = $state(false);
  /** Names of files rejected during local upload (auto-clears after 3 s). */
  let uploadErrors = $state<string[]>([]);
  let uploadErrorTimer: ReturnType<typeof setTimeout> | null = null;

  // ── @mention state ────────────────────────────────────────────────────────

  /** Files selected via @mention — shown as chips, injected as context on send. */
  let fileChips = $state<FileEntry[]>([]);
  /** All workspace files (lazy-loaded on first @). */
  let allFiles = $state<FileEntry[]>([]);
  /** Whether the dropdown is visible. */
  let showDropdown = $state(false);
  /** The text typed after the triggering @. */
  let mentionQuery = $state('');
  /** Index of @ in textarea value, used to splice it out on selection. */
  let mentionStart = $state(-1);
  /** Keyboard-highlighted item in the dropdown. */
  let dropdownIndex = $state(0);

  const filteredFiles = $derived(fuzzyFilter(allFiles, mentionQuery));

  // Reset keyboard selection when the filtered list changes.
  $effect(() => {
    void filteredFiles;
    dropdownIndex = 0;
  });

  onMount(() => {
    isMobile = window.matchMedia('(max-width: 639px)').matches;
  });

  // ── @mention helpers ──────────────────────────────────────────────────────

  /**
   * Reload the workspace file list (once per dropdown session).
   * Fast on OPFS — only metadata reads.
   */
  async function refreshFiles() {
    try {
      allFiles = await listWorkspaceFiles();
    } catch {
      allFiles = [];
    }
  }

  /**
   * Inspect textarea content around the cursor.
   * Opens the dropdown when an @-word is directly before the cursor;
   * closes it otherwise.
   */
  function checkMentionTrigger(textarea: HTMLTextAreaElement) {
    const cursor = textarea.selectionStart;
    const before = textarea.value.slice(0, cursor);
    // Match @ followed by non-whitespace chars up to the cursor.
    const match = /@([^\s@]*)$/.exec(before);
    if (match) {
      if (!showDropdown) {
        // Dropdown just opened — refresh file list.
        refreshFiles();
      }
      mentionQuery = match[1];
      mentionStart = match.index;
      showDropdown = true;
    } else {
      showDropdown = false;
      mentionQuery = '';
      mentionStart = -1;
    }
  }

  /** Called when the user picks a file from the dropdown. */
  function selectFile(file: FileEntry) {
    // Remove the @query text from the textarea.
    if (mentionStart >= 0) {
      value =
        value.slice(0, mentionStart) +
        value.slice(mentionStart + 1 + mentionQuery.length);
    }
    // Add as a chip (avoid duplicates).
    if (!fileChips.find((c) => c.path === file.path)) {
      fileChips = [...fileChips, file];
    }
    showDropdown = false;
    mentionQuery = '';
    mentionStart = -1;
    textareaEl?.focus();
  }

  function removeChip(path: string) {
    fileChips = fileChips.filter((c) => c.path !== path);
  }

  // ── Image helpers ─────────────────────────────────────────────────────────

  function fileToImageContent(file: File): Promise<ImageContent> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const commaIdx = dataUrl.indexOf(',');
        const data = dataUrl.slice(commaIdx + 1);
        resolve({ type: 'image', data, mimeType: file.type });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  async function addFiles(files: FileList | File[]) {
    const valid = Array.from(files).filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
    const contents = await Promise.all(valid.map(fileToImageContent));
    images = [...images, ...contents];
  }

  // ── Local text-file upload helpers ───────────────────────────────────────

  /** Extensions we're confident are plain text / source code. */
  const TEXT_EXTENSIONS = new Set([
    'txt', 'md', 'markdown', 'rst', 'adoc',
    'json', 'jsonc', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'xml', 'sql',
    'ini', 'cfg', 'conf', 'env', 'properties', 'editorconfig',
    'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat',
    'html', 'htm', 'css', 'scss', 'less', 'svelte', 'vue',
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
    'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
    'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'r', 'scala', 'lua',
    'graphql', 'gql', 'proto', 'tf', 'hcl',
    'gitignore', 'dockerignore', 'npmignore', 'log',
  ]);

  function isTextFile(file: File): boolean {
    if (file.type.startsWith('text/')) return true;
    if (['application/json', 'application/xml', 'application/javascript'].includes(file.type))
      return true;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    return TEXT_EXTENSIONS.has(ext);
  }

  /**
   * Upload local text files to OPFS under `uploads/`, then add as chips.
   * Non-text files are rejected with a brief inline error.
   * Same-name files are silently overwritten.
   */
  async function uploadLocalFiles(files: FileList | File[]) {
    const all = Array.from(files);
    const rejected: string[] = [];
    const uploaded: FileEntry[] = [];

    for (const file of all) {
      if (!isTextFile(file)) {
        rejected.push(file.name);
        continue;
      }
      try {
        const text = await file.text();
        const opfsPath = `uploads/${file.name}`;
        await writeFile(opfsPath, text);
        uploaded.push({ name: file.name, path: opfsPath });
      } catch {
        rejected.push(file.name);
      }
    }

    // Add successfully uploaded files as chips (deduplicated).
    for (const entry of uploaded) {
      if (!fileChips.find((c) => c.path === entry.path)) {
        fileChips = [...fileChips, entry];
      } else {
        // Already chipped — content was silently overwritten; no need to add again.
      }
    }

    // Show rejection notice for 3 s.
    if (rejected.length > 0) {
      if (uploadErrorTimer) clearTimeout(uploadErrorTimer);
      uploadErrors = rejected;
      uploadErrorTimer = setTimeout(() => { uploadErrors = []; }, 3000);
    }
  }

  function removeImage(idx: number) {
    images = images.filter((_, i) => i !== idx);
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  function handleKeydown(e: KeyboardEvent) {
    // Escape closes the dropdown regardless of whether there are results.
    if (showDropdown && e.key === 'Escape') {
      e.preventDefault();
      showDropdown = false;
      return;
    }

    // Intercept navigation/selection keys only when there are items to pick from.
    if (showDropdown && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        dropdownIndex = Math.min(dropdownIndex + 1, filteredFiles.length - 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        dropdownIndex = Math.max(dropdownIndex - 1, 0);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredFiles[dropdownIndex]) selectFile(filteredFiles[dropdownIndex]);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handleInput(e: Event) {
    autoResize(e);
    checkMentionTrigger(e.target as HTMLTextAreaElement);
  }

  function handleBlur() {
    // Delay so FilePicker's onmousedown can fire before the dropdown disappears.
    setTimeout(() => {
      showDropdown = false;
    }, 150);
  }

  /**
   * Build and send the message.
   * File chip contexts are prepended; UI resets immediately before the async reads.
   */
  async function submit() {
    const trimmed = value.trim();
    if (!trimmed && images.length === 0 && fileChips.length === 0) return;

    const currentImages = $state.snapshot(images) as ImageContent[];
    const currentChips = $state.snapshot(fileChips) as FileEntry[];

    // Reset UI eagerly — prevents double-sends while awaiting file reads.
    value = '';
    images = [];
    fileChips = [];
    showDropdown = false;
    if (textareaEl) textareaEl.style.height = 'auto';

    // Inject file context blocks ahead of the user's message.
    let content = trimmed;
    if (currentChips.length > 0) {
      const parts: string[] = [];
      for (const chip of currentChips) {
        try {
          const preview = await getFilePreview(chip.path, 20);
          if (preview.truncated) {
            const returnedLines = preview.content.split('\n').length;
            parts.push(
              `<file-context path="${chip.path}" lines="1-${returnedLines}" total="${preview.totalLines}" truncated="true">\n` +
              `${preview.content}\n` +
              `</file-context>`,
            );
          } else {
            parts.push(
              `<file-context path="${chip.path}">\n` +
              `${preview.content}\n` +
              `</file-context>`,
            );
          }
        } catch {
          parts.push(`<file-context path="${chip.path}" error="true"></file-context>`);
        }
      }
      content = parts.join('\n\n') + (trimmed ? '\n\n' + trimmed : '');
    }

    onSend(content, currentImages);
    textareaEl?.focus();
  }

  function autoResize(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  function openFilePicker() {
    fileInputEl?.click();
  }

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) addFiles(input.files);
    input.value = '';
  }

  function openTextFilePicker() {
    textFileInputEl?.click();
  }

  function handleTextFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) uploadLocalFiles(input.files);
    input.value = '';
  }

  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.kind === 'file' && ACCEPTED_IMAGE_TYPES.includes(item.type)) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addFiles(imageFiles);
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDraggingOver = true;
  }
  function handleDragLeave() {
    isDraggingOver = false;
  }
  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDraggingOver = false;
    if (!e.dataTransfer?.files) return;
    const all = Array.from(e.dataTransfer.files);
    const imageFiles = all.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
    const otherFiles = all.filter((f) => !ACCEPTED_IMAGE_TYPES.includes(f.type));
    if (imageFiles.length > 0) await addFiles(imageFiles);
    if (otherFiles.length > 0) await uploadLocalFiles(otherFiles);
  }

  function previewSrc(img: ImageContent) {
    return `data:${img.mimeType};base64,${img.data}`;
  }

  const canSend = $derived(
    value.trim().length > 0 || images.length > 0 || fileChips.length > 0,
  );
</script>

<!-- Hidden image input -->
<input
  bind:this={fileInputEl}
  type="file"
  accept="image/jpeg,image/png,image/gif,image/webp"
  multiple
  style="display:none"
  onchange={handleFileChange}
/>

<!-- Hidden text-file input -->
<input
  bind:this={textFileInputEl}
  type="file"
  accept="text/*,.md,.ts,.tsx,.js,.jsx,.json,.yaml,.yml,.toml,.py,.go,.rs,.sql,.csv,.sh,.html,.css,.svelte"
  multiple
  style="display:none"
  onchange={handleTextFileChange}
/>

<div
  class="input-area"
  role="region"
  aria-label="消息输入框"
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <!-- Image previews -->
  {#if images.length > 0}
    <div class="previews">
      {#each images as img, i}
        <div class="preview-item">
          <img src={previewSrc(img)} alt="attachment {i + 1}" />
          <button
            class="remove-btn"
            onclick={() => removeImage(i)}
            title="移除图片"
            type="button"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- File chips (from @mention and local upload) -->
  {#if fileChips.length > 0}
    <div class="file-chips">
      {#each fileChips as chip}
        <div class="file-chip">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span class="chip-name" title={chip.path}>{chip.name}</span>
          <button
            class="chip-remove"
            onclick={() => removeChip(chip.path)}
            type="button"
            title="移除文件"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Upload error notice (auto-dismisses after 3 s) -->
  {#if uploadErrors.length > 0}
    <div class="upload-error">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      不支持：{uploadErrors.join('、')}（仅限文本 / 代码文件）
    </div>
  {/if}

  <!-- Input box wrapper (relative for dropdown positioning) -->
  <div class="input-wrapper">
    {#if showDropdown}
      <FilePicker
        files={filteredFiles}
        selectedIndex={dropdownIndex}
        onSelect={selectFile}
      />
    {/if}

    <div class="input-box" class:drag-over={isDraggingOver}>
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
        onkeydown={handleKeydown}
        oninput={handleInput}
        onblur={handleBlur}
        onpaste={handlePaste}
      ></textarea>

      <!-- Attach image button -->
      <button
        class="attach-btn"
        type="button"
        onclick={openFilePicker}
        title="附加图片"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
        </svg>
      </button>

      <!-- Upload local text file button -->
      <button
        class="attach-btn"
        type="button"
        onclick={openTextFilePicker}
        title="上传本地文本文件到工作区"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <polyline points="9 15 12 12 15 15"/>
        </svg>
      </button>

      <!-- Stop button — only visible while streaming -->
      {#if $isStreaming}
        <button
          class="stop-btn"
          onclick={onAbort}
          title="停止"
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
        </button>
      {/if}

      <!-- Send button — queues when streaming -->
      <button
        class="send-btn"
        disabled={!canSend}
        onclick={submit}
        title={$isStreaming ? '排队发送' : '发送'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    </div>
  </div>

  <p class="hint">ThinClaw 将对话存储在您的浏览器本地，API 密钥不会离开您的设备。</p>
</div>

<style>
  .input-area {
    padding: 12px 24px 16px;
    border-top: 1px solid var(--border);
    background: var(--surface-main);
    flex-shrink: 0;
  }

  /* Image previews row */
  .previews {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
  }

  .preview-item {
    position: relative;
    width: 64px;
    height: 64px;
    border-radius: 8px;
    overflow: visible;
    flex-shrink: 0;
  }

  .preview-item img {
    width: 64px;
    height: 64px;
    object-fit: cover;
    border-radius: 8px;
    border: 1px solid var(--border);
    display: block;
  }

  .remove-btn {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--text-secondary);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    padding: 0;
    transition: background 0.1s;
    z-index: 1;
  }

  .remove-btn:hover {
    background: var(--error);
  }

  /* File chips row (@mention selections) */
  .file-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }

  .file-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 3px 6px 3px 8px;
    font-size: 0.78rem;
    color: var(--text-secondary);
    max-width: 240px;
  }

  .chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .chip-remove {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    flex-shrink: 0;
    border-radius: 3px;
    transition: color 0.1s;
  }

  .chip-remove:hover {
    color: var(--error);
  }

  /* Upload error notice */
  .upload-error {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.78rem;
    color: var(--error);
    background: var(--error-bg);
    border: 1px solid var(--error);
    border-radius: 6px;
    padding: 5px 10px;
    margin-bottom: 8px;
  }

  /* Wrapper that anchors the FilePicker dropdown */
  .input-wrapper {
    position: relative;
  }

  /* Input box */
  .input-box {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    background: var(--surface-input);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px 12px;
    transition: border-color 0.15s;
  }

  .input-box:focus-within {
    border-color: var(--accent);
  }

  .input-box.drag-over {
    border-color: var(--accent);
    background: var(--surface-hover);
  }

  textarea {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    resize: none;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--text-primary);
    font-family: inherit;
    max-height: 200px;
    overflow-y: auto;
  }

  textarea::placeholder {
    color: var(--text-muted);
  }

  /* Attach button */
  .attach-btn {
    background: none;
    border: none;
    border-radius: 8px;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-muted);
    flex-shrink: 0;
    transition: color 0.1s, background 0.1s;
  }

  .attach-btn:hover {
    color: var(--text-secondary);
    background: var(--surface-hover);
  }

  /* Stop button */
  .stop-btn {
    background: none;
    border: 1.5px solid var(--border);
    border-radius: 8px;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-secondary);
    flex-shrink: 0;
    transition: color 0.1s, background 0.1s, border-color 0.1s;
  }

  .stop-btn:hover {
    color: var(--error);
    border-color: var(--error);
    background: var(--error-bg);
  }

  /* Send button */
  .send-btn {
    background: var(--accent);
    border: none;
    border-radius: 8px;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: white;
    flex-shrink: 0;
    transition: opacity 0.1s;
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .send-btn:not(:disabled):hover {
    opacity: 0.85;
  }

  .hint {
    font-size: 0.72rem;
    color: var(--text-muted);
    text-align: center;
    margin: 8px 0 0;
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
