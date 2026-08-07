<script lang="ts">
  type Props = {
    name?: string;
    currentRef?: string | null;
    onchange?: (key: string | null) => void;
    // Where uploads/URL fetches are posted. Defaults to the admin route;
    // the public submission form (submit.astro) passes /api/submit-photo,
    // its own rate-limited, unauthenticated equivalent.
    importEndpoint?: string;
    // Admin usage lets you paste an already-uploaded object key straight
    // into the URL field, skipping the import round-trip. A public
    // submitter has no legitimate reason to do that (there's no prior
    // upload of theirs to reference), so submit.astro turns this off and
    // treats any non-http(s) input as a mistake instead of a raw key.
    allowRawKey?: boolean;
  };
  let {
    name,
    currentRef = null,
    onchange,
    importEndpoint = '/admin/api/photos/import',
    allowRawKey = true,
  }: Props = $props();

  let key = $state<string | null>(currentRef);
  let urlInput = $state('');
  let uploading = $state(false);
  let dragging = $state(false);
  let error = $state<string | null>(null);

  let previewRetries = $state(0);
  let previewBust = $state(0);
  const MAX_PREVIEW_RETRIES = 4;

  // 'published' frames the photo exactly as a live card will crop it (4:3,
  // .published-crop in global.css); 'full' shows the whole source. You need
  // both to judge a photo: the first is what ships, the second is what the
  // first is cutting off.
  const VIEWS = [
    { value: 'published', label: 'As published' },
    { value: 'full', label: 'Full image' },
  ] as const;

  let view = $state<'published' | 'full'>('published');
  let expanded = $state(false);
  let overlay = $state<HTMLDivElement | null>(null);
  let naturalWidth = $state(0);
  let naturalHeight = $state(0);

  // storeImageBytes resizes uploads to 1024w (and a 640w variant) but never
  // enlarges, so anything narrower than 640 is already below the small
  // variant the feed serves and will look soft on a card at 2x DPR.
  const SOFT_BELOW_WIDTH = 640;
  const looksSoft = $derived(naturalWidth > 0 && naturalWidth < SOFT_BELOW_WIDTH);

  const previewSrc = $derived(`/api/images/${key}${previewBust ? `?r=${previewBust}` : ''}`);

  // Move focus into the overlay when it opens so Escape reaches it and tab
  // order doesn't stay behind on the draft form underneath.
  $effect(() => {
    if (expanded) overlay?.focus();
  });

  function retryPreview() {
    if (previewRetries >= MAX_PREVIEW_RETRIES) return;
    previewRetries += 1;
    setTimeout(() => {
      previewBust += 1;
    }, 300 * previewRetries);
  }

  function onPreviewLoad(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    naturalWidth = img.naturalWidth;
    naturalHeight = img.naturalHeight;
  }

  function setKey(next: string | null) {
    key = next;
    previewRetries = 0;
    previewBust = 0;
    naturalWidth = 0;
    naturalHeight = 0;
    view = 'published';
    expanded = false;
    onchange?.(next);
  }

  async function importFile(file: File) {
    uploading = true;
    error = null;
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(importEndpoint, { method: 'POST', body: form });
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
      if (allowRawKey) {
        setKey(url);
      } else {
        error = 'Paste an image URL, or use the upload area above.';
      }
      return;
    }
    uploading = true;
    error = null;
    try {
      const form = new FormData();
      form.append('url', url);
      const res = await fetch(importEndpoint, { method: 'POST', body: form });
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
    <div class="space-y-2">
      <div class="relative mx-auto w-full max-w-sm">
        <!-- The preview is a button so the whole frame opens the full-size
             view; type="button" matters because this component renders inside
             the draft edit <form> in DraftCard.svelte. -->
        <button
          type="button"
          onclick={() => (expanded = true)}
          class="group block w-full cursor-zoom-in overflow-hidden rounded border border-paper-edge bg-paper focus-visible:ring-2 focus-visible:ring-blue/40 focus-visible:outline-none"
          title="View full size"
        >
          <img
            src={previewSrc}
            onerror={retryPreview}
            onload={onPreviewLoad}
            alt="Attached photo, shown as it will be cropped on the published card"
            class={view === 'published'
              ? 'published-crop w-full'
              : 'max-h-64 w-full object-contain'}
          />
        </button>
        <button
          type="button"
          onclick={() => setKey(null)}
          disabled={uploading}
          class="absolute top-1 right-1 rounded bg-ink/70 px-2 py-0.5 text-xs font-semibold text-white hover:bg-ink/90 disabled:opacity-50"
        >
          Remove
        </button>
      </div>

      <div class="mx-auto flex w-full max-w-sm flex-wrap items-center gap-2 text-xs">
        <div class="inline-flex overflow-hidden rounded border border-paper-edge">
          {#each VIEWS as option (option.value)}
            <button
              type="button"
              onclick={() => (view = option.value)}
              aria-pressed={view === option.value}
              class={`px-2 py-1 font-medium transition-colors ${
                view === option.value
                  ? 'bg-blue text-white'
                  : 'bg-paper text-ink-soft hover:text-blue'
              }`}
            >
              {option.label}
            </button>
          {/each}
        </div>
        {#if naturalWidth > 0}
          <span class="text-ink-soft/70 font-mono">{naturalWidth}×{naturalHeight}</span>
        {/if}
        {#if looksSoft}
          <span class="text-red font-mono" title="Below the 640px variant the feed serves">
            low resolution
          </span>
        {/if}
      </div>

      {#if view === 'published'}
        <p class="mx-auto max-w-sm text-xs text-ink-soft/70">
          This is the exact crop the published card uses. Switch to “Full image” to see what's
          outside it.
        </p>
      {/if}
    </div>
  {/if}

  {#if expanded && key}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      bind:this={overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Full size photo"
      tabindex="-1"
      onclick={() => (expanded = false)}
      onkeydown={(e) => {
        if (e.key === 'Escape') expanded = false;
      }}
      class="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-6"
    >
      <img
        src={previewSrc}
        alt="Attached photo at full size"
        class="max-h-full max-w-full rounded shadow-lg"
      />
      <button
        type="button"
        onclick={() => (expanded = false)}
        class="absolute top-4 right-4 rounded bg-card px-3 py-1 text-sm font-semibold text-ink hover:opacity-90"
      >
        Close
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
    <span class="text-ink-soft/70"
      >{allowRawKey ? '…or paste a URL / existing key' : '…or paste an image URL'}</span
    >
    <input
      bind:value={urlInput}
      onblur={importUrl}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          importUrl();
        }
      }}
      placeholder={allowRawKey ? 'https://… or admin/1234-photo.webp' : 'https://…'}
      class="mt-1 w-full rounded border border-paper-edge bg-paper p-2 text-ink"
    />
  </label>

  {#if error}
    <p class="text-xs text-red font-mono">{error}</p>
  {/if}
</div>
