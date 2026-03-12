<script lang="ts">
  import { onMount } from 'svelte';
  import { isStreaming } from '$lib/stores/chat';
  import type { ImageContent } from '@mariozechner/pi-ai';

  interface Props {
    onSend: (content: string, images: ImageContent[]) => void;
    onAbort?: () => void;
  }
  let { onSend, onAbort }: Props = $props();

  let value = $state('');
  let images = $state<ImageContent[]>([]);
  let textareaEl = $state<HTMLTextAreaElement | undefined>(undefined);
  let fileInputEl = $state<HTMLInputElement | undefined>(undefined);
  let isDraggingOver = $state(false);
  let isMobile = $state(false);

  onMount(() => {
    isMobile = window.matchMedia('(max-width: 639px)').matches;
  });

  // ── Image helpers ─────────────────────────────────────────────────────────

  /** Read a File as base64 ImageContent. */
  function fileToImageContent(file: File): Promise<ImageContent> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // dataUrl = "data:<mimeType>;base64,<data>"
        const commaIdx = dataUrl.indexOf(',');
        const data = dataUrl.slice(commaIdx + 1);
        resolve({ type: 'image', data, mimeType: file.type });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  async function addFiles(files: FileList | File[]) {
    const valid = Array.from(files).filter((f) => ACCEPTED_TYPES.includes(f.type));
    const contents = await Promise.all(valid.map(fileToImageContent));
    images = [...images, ...contents];
  }

  function removeImage(idx: number) {
    images = images.filter((_, i) => i !== idx);
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = value.trim();
    // Allow sending images without text, but not completely empty
    if ((!trimmed && images.length === 0) || $isStreaming) return;
    // $state.snapshot() strips Svelte 5 Proxy wrappers so ImageContent objects
    // are plain serializable values — required for IndexedDB structured clone.
    const snapshot = $state.snapshot(images) as ImageContent[];
    value = '';
    images = [];
    onSend(trimmed, snapshot);
    if (textareaEl) textareaEl.style.height = 'auto';
  }

  function autoResize(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  // File picker
  function openFilePicker() {
    fileInputEl?.click();
  }

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) addFiles(input.files);
    // Reset so the same file can be picked again
    input.value = '';
  }

  // Clipboard paste
  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.kind === 'file' && ACCEPTED_TYPES.includes(item.type)) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addFiles(imageFiles);
    }
  }

  // Drag & drop
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDraggingOver = true;
  }
  function handleDragLeave() {
    isDraggingOver = false;
  }
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDraggingOver = false;
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  }

  // Preview data-URL for a given ImageContent
  function previewSrc(img: ImageContent) {
    return `data:${img.mimeType};base64,${img.data}`;
  }

  const canSend = $derived((value.trim().length > 0 || images.length > 0) && !$isStreaming);
</script>

<!-- Hidden file input -->
<input
  bind:this={fileInputEl}
  type="file"
  accept="image/jpeg,image/png,image/gif,image/webp"
  multiple
  style="display:none"
  onchange={handleFileChange}
/>

<div
  class="input-area"
  role="region"
  aria-label="Message input"
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
            title="Remove image"
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

  <div class="input-box" class:disabled={$isStreaming} class:drag-over={isDraggingOver}>
    <textarea
      bind:this={textareaEl}
      bind:value
      placeholder={$isStreaming
        ? 'Waiting for response…'
        : isMobile
          ? 'Message…'
          : 'Message (Enter to send, Shift+Enter for new line)'}
      rows="1"
      disabled={$isStreaming}
      onkeydown={handleKeydown}
      oninput={autoResize}
      onpaste={handlePaste}
    ></textarea>

    <!-- Attach button -->
    <button
      class="attach-btn"
      type="button"
      disabled={$isStreaming}
      onclick={openFilePicker}
      title="Attach image"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
      </svg>
    </button>

    <!-- Send / Stop button -->
    <button
      class="send-btn"
      disabled={!canSend}
      onclick={$isStreaming ? onAbort : submit}
      title={$isStreaming ? 'Stop' : 'Send'}
    >
      {#if $isStreaming}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2"/>
        </svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      {/if}
    </button>
  </div>

  <p class="hint">ThinClaw stores conversations locally in your browser. API keys never leave your device.</p>
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

  .input-box.disabled {
    opacity: 0.6;
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

  .attach-btn:not(:disabled):hover {
    color: var(--text-secondary);
    background: var(--surface-hover);
  }

  .attach-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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
