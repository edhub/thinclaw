<script lang="ts">
  import { isStreaming } from '$lib/stores/chat';

  interface Props {
    onSend: (content: string) => void;
    onAbort?: () => void;
  }
  let { onSend, onAbort }: Props = $props();

  let value = $state('');
  let textareaEl = $state<HTMLTextAreaElement | undefined>(undefined);

  function handleKeydown(e: KeyboardEvent) {
    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || $isStreaming) return;
    value = '';
    onSend(trimmed);
    // Reset textarea height
    if (textareaEl) textareaEl.style.height = 'auto';
  }

  function autoResize(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }
</script>

<div class="input-area">
  <div class="input-box" class:disabled={$isStreaming}>
    <textarea
      bind:this={textareaEl}
      bind:value
      placeholder={$isStreaming ? 'Waiting for response…' : 'Message (Enter to send, Shift+Enter for new line)'}
      rows="1"
      disabled={$isStreaming}
      onkeydown={handleKeydown}
      oninput={autoResize}
    ></textarea>
    <button
      class="send-btn"
      disabled={!value.trim() && !$isStreaming}
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

  .input-box {
    display: flex;
    align-items: flex-end;
    gap: 8px;
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
</style>
