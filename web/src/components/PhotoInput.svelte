<script lang="ts">
  type Props = {
    name?: string;
    currentRef?: string | null;
    onchange?: (key: string | null) => void;
  };
  let { name, currentRef = null, onchange }: Props = $props();

  let key = $state<string | null>(currentRef);
  let urlInput = $state('');
  let uploading = $state(false);
  let dragging = $state(false);
  let error = $state<string | null>(null);

  let previewRetries = $state(0);
  let previewBust = $state(0);
  const MAX_PREVIEW_RETRIES = 4;

  function retryPreview() {
    if (previewRetries >= MAX_PREVIEW_RETRIES) return;
    previewRetries += 1;
    setTimeout(() => {
      previewBust += 1;
    }, 300 * previewRetries);
  }

  function setKey(next: string | null) {
    key = next;
    previewRetries = 0;
    previewBust = 0;
    onchange?.(next);
  }

  async function importFile(file: File) {
    uploading = true;
    error = null;
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/admin/api/photos/import', { method: 'POST', body: form });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = (await res.json()) as { key: string };
      setKey(data.key);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Upload failed';
    } finally {
      uploading = false;
    }
  }

  async function importUrl() {
    const url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      setKey(url);
      return;
    }
    uploading = true;
    error = null;
    try {
      const form = new FormData();
      form.append('url', url);
      const res = await fetch('/admin/api/photos/import', { method: 'POST', body: form });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = (await res.json()) as { key: string };
      setKey(data.key);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Import failed';
    } finally {
      uploading = false;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) importFile(file);
  }

  function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) importFile(file);
        return;
      }
    }
  }

  let fileInput = $state<HTMLInputElement | null>(null);
  let root = $state<HTMLDivElement | null>(null);
  let dropzone = $state<HTMLDivElement | null>(null);
</script>

<div bind:this={root} onpaste={onPaste} class="space-y-2">
  {#if name}
    <input type="hidden" {name} value={key ?? ''} />
  {/if}

  {#if key}
    <div class="relative">
      <img
        src={`/api/images/${key}${previewBust ? `?r=${previewBust}` : ''}`}
        onerror={retryPreview}
        alt=""
        class="h-32 w-auto rounded border border-paper-edge object-cover"
      />
      <button
        type="button"
        onclick={() => setKey(null)}
        disabled={uploading}
        class="absolute right-1 top-1 rounded bg-ink/70 px-2 py-0.5 text-xs font-semibold text-white hover:bg-ink/90 disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  {/if}

  <div
    bind:this={dropzone}
    role="button"
    tabindex="0"
    ondragover={(e) => {
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={onDrop}
    onclick={() => fileInput?.click()}
    onmouseenter={() => dropzone?.focus()}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput?.click();
      }
    }}
    class={`flex cursor-pointer items-center justify-center rounded border-2 border-dashed px-3 py-4 text-sm outline-none transition-colors focus-visible:border-blue focus-visible:ring-2 focus-visible:ring-blue/30 ${dragging ? 'border-blue bg-blue/5' : 'border-paper-edge bg-paper hover:border-blue/50'}`}
  >
    <span class="text-center text-ink-soft">
      {uploading
        ? 'Uploading…'
        : dragging
          ? 'Drop to upload'
          : 'Drop image, paste from clipboard, or click to browse'}
    </span>
    <input
      bind:this={fileInput}
      type="file"
      accept="image/*"
      class="hidden"
      onchange={(e) => {
        const file = (e.currentTarget as HTMLInputElement).files?.[0];
        if (file) importFile(file);
        e.currentTarget.value = '';
      }}
    />
  </div>

  <label class="block text-sm font-medium text-ink">
    <span class="text-ink-soft/70">…or paste a URL / existing key</span>
    <input
      bind:value={urlInput}
      onblur={importUrl}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          importUrl();
        }
      }}
      placeholder="https://… or admin/1234-photo.webp"
      class="mt-1 w-full rounded border border-paper-edge bg-paper p-2 text-ink"
    />
  </label>

  {#if error}
    <p class="text-xs text-red font-mono">{error}</p>
  {/if}
</div>
