<script lang="ts">
  import type { Headline } from '../lib/db';

  type Props = { draft: Headline };
  let { draft }: Props = $props();

  let headline = $state(draft.headline);
  let register = $state<1 | 2>(draft.register);
  let statBlock = $state(draft.stat_block ?? '');
  let photoRef = $state(draft.photo_ref ?? '');
  // Decoupled from photoRef so typing into the field doesn't fire a failed
  // MinIO round-trip on every keystroke (a burst of those took prod down once).
  let previewRef = $state(draft.photo_ref ?? '');
  // A freshly-uploaded photo's GET can fire before the write is reliably
  // readable back — retry with backoff instead of needing a manual re-save.
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

  let sourcePostUrl = $state(draft.source_post_url ?? '');
  let sourceNote = $state(draft.source_note ?? '');

  let saving = $state(false);
  let savedAt = $state<string | null>(null);
  let error = $state<string | null>(null);
  let publishing = $state(false);
  let discarding = $state(false);

  const isFactAnchored = $derived(register === 2 && !!sourceNote);
  const isPublished = $derived(draft.status === 'published');

  async function save() {
    saving = true;
    error = null;
    try {
      const form = new FormData();
      form.set('headline', headline);
      form.set('register', String(register));
      if (statBlock) form.set('stat_block', statBlock);
      if (photoRef) form.set('photo_ref', photoRef);
      if (sourcePostUrl) form.set('source_post_url', sourcePostUrl);
      if (sourceNote) form.set('source_note', sourceNote);
      const res = await fetch(`/admin/api/headlines/${draft.id}/update`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = await res.json();
      photoRef = data.photo_ref ?? '';
      previewRef = photoRef;
      previewRetries = 0;
      previewBust = 0;
      savedAt = new Date().toLocaleTimeString();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  // Both reload the page rather than optimistically removing the card: the row
  // moves between the server-rendered "Drafts" and "Recently published"
  // sections, so an in-place removal would just make it vanish silently.
  async function publish() {
    publishing = true;
    error = null;
    try {
      const res = await fetch(`/admin/api/headlines/${draft.id}/publish`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      location.reload();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Publish failed';
      publishing = false;
    }
  }

  async function unpublish() {
    publishing = true;
    error = null;
    try {
      const res = await fetch(`/admin/api/headlines/${draft.id}/unpublish`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      location.reload();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unpublish failed';
      publishing = false;
    }
  }

  async function discard() {
    if (!confirm('Discard this headline? It will disappear from every list.')) return;
    discarding = true;
    error = null;
    try {
      const res = await fetch(`/admin/api/headlines/${draft.id}/discard`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      root?.remove();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Discard failed';
      discarding = false;
    }
  }

  let root: HTMLLIElement | undefined = $state();
</script>

<li bind:this={root} class="rounded-lg border border-neutral-200 p-5">
  <div class="mb-3 flex flex-wrap items-center gap-2">
    <span
      class={`rounded px-2 py-0.5 text-xs font-semibold ${register === 2 ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}
    >
      Register {register}
    </span>
    {#if isFactAnchored}
      <span class="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
        fact-anchored — verify before publish
      </span>
    {/if}
    <span class="text-xs text-neutral-400">
      #{draft.id} · {new Date(draft.created_at).toLocaleString()}
    </span>
  </div>

  <form
    class="space-y-3"
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}
  >
    <label class="block text-sm font-medium text-neutral-700">
      Headline
      <textarea
        bind:value={headline}
        required
        rows="2"
        class="mt-1 w-full rounded border border-neutral-300 p-2 text-base"
      ></textarea>
    </label>

    <label class="block text-sm font-medium text-neutral-700">
      Register
      <select bind:value={register} class="mt-1 w-full rounded border border-neutral-300 p-2">
        <option value={1}>1 — real-event riff</option>
        <option value={2}>2 — fabricated scenario</option>
      </select>
    </label>

    <label class="block text-sm font-medium text-neutral-700">
      Stat block
      <input bind:value={statBlock} class="mt-1 w-full rounded border border-neutral-300 p-2" />
    </label>

    <label class="block text-sm font-medium text-neutral-700">
      Photo ref
      <input
        bind:value={photoRef}
        onblur={() => {
          previewRef = photoRef;
          previewRetries = 0;
          previewBust = 0;
        }}
        class="mt-1 w-full rounded border border-neutral-300 p-2"
      />
    </label>
    {#if previewRef}
      <img
        src={`/api/images/${previewRef}${previewBust ? `?r=${previewBust}` : ''}`}
        onerror={retryPreview}
        alt=""
        class="h-32 w-auto rounded border border-neutral-200 object-cover"
      />
    {/if}

    <label class="block text-sm font-medium text-neutral-700">
      Source post URL <span class="font-normal text-neutral-400">(register 1 only)</span>
      <input bind:value={sourcePostUrl} class="mt-1 w-full rounded border border-neutral-300 p-2" />
    </label>

    <label class="block text-sm font-medium text-neutral-700">
      Source note <span class="font-normal text-neutral-400">(register 1 only)</span>
      <input bind:value={sourceNote} class="mt-1 w-full rounded border border-neutral-300 p-2" />
    </label>

    <div class="flex flex-wrap items-center gap-3 pt-1">
      <button
        type="submit"
        disabled={saving}
        class="rounded bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
      {#if savedAt && !error}
        <span class="text-xs text-emerald-600">Saved at {savedAt}</span>
      {/if}
      {#if error}
        <span class="text-xs text-red-600">{error}</span>
      {/if}
    </div>
  </form>

  <div class="mt-3 flex flex-wrap items-center gap-3">
    {#if isPublished}
      <button
        onclick={unpublish}
        disabled={publishing}
        class="rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {publishing ? 'Unpublishing…' : 'Unpublish'}
      </button>
    {:else}
      <button
        onclick={publish}
        disabled={publishing}
        class="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {publishing ? 'Publishing…' : 'Publish'}
      </button>
    {/if}
    <button
      onclick={discard}
      disabled={discarding}
      class="rounded border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
    >
      {discarding ? 'Discarding…' : 'Discard'}
    </button>
  </div>
</li>
