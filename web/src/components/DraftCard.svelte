<script lang="ts">
  import type { Headline } from '../lib/db';
  import PhotoInput from './PhotoInput.svelte';

  type Props = { draft: Headline };
  let { draft }: Props = $props();

  let headline = $state(draft.headline);
  let subtitle = $state(draft.subtitle ?? '');
  let photoRef = $state(draft.photo_ref ?? '');

  let sourcePostUrl = $state(draft.source_post_url ?? '');
  let sourceNote = $state(draft.source_note ?? '');

  let saving = $state(false);
  let savedAt = $state<string | null>(null);
  let error = $state<string | null>(null);
  let publishing = $state(false);
  let discarding = $state(false);

  const isFactAnchored = $derived(!!sourceNote);
  const isPublished = $derived(draft.status === 'published');

  const safetyBadgeClass = $derived.by(() => {
    switch (draft.safety_status) {
      case 'review':
        return 'border-amber-700/30 bg-amber-50 text-amber-900';
      case 'blocked':
        return 'border-red/30 bg-red/10 text-red';
      default:
        return 'border-emerald-700/30 bg-emerald-50 text-emerald-800';
    }
  });

  async function save() {
    saving = true;
    error = null;
    try {
      const form = new FormData();
      form.set('headline', headline);
      if (subtitle) form.set('subtitle', subtitle);
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
      savedAt = new Date().toLocaleTimeString();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

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

<li
  bind:this={root}
  class="border border-paper-edge border-t-[3px] border-t-ink bg-card p-5 shadow-[0_1px_2px_rgba(13,27,46,0.06)] sm:p-6"
>
  <div class="mb-4 flex flex-wrap items-center gap-2 border-b border-paper-edge/80 pb-3">
    {#if draft.source === 'submission'}
      <span
        class="border border-blue/30 bg-blue/10 px-2 py-0.5 font-mono text-[0.65rem] font-bold tracking-wider text-blue uppercase"
        title="Came in through the public /submit form. Unverified provenance, review with extra care"
      >
        Tip{draft.submitter_name ? ` · ${draft.submitter_name}` : ' · anonymous'}
      </span>
    {/if}
    {#if draft.category}
      <span
        class="border border-paper-edge bg-paper-tint/70 px-2 py-0.5 font-mono text-[0.65rem] font-bold tracking-wider text-ink-soft uppercase"
      >
        {draft.category}
      </span>
    {/if}
    {#if draft.safety_status}
      <span
        class={`border px-2 py-0.5 font-mono text-[0.65rem] font-bold tracking-wider uppercase ${safetyBadgeClass}`}
        title={draft.safety_reason ?? ''}
      >
        {draft.safety_status}{draft.safety_reason ? ` · ${draft.safety_reason}` : ''}
      </span>
    {/if}
    {#if isFactAnchored}
      <span
        class="border border-red/30 bg-red/10 px-2 py-0.5 font-mono text-[0.65rem] font-bold tracking-wider text-red uppercase"
      >
        Fact-anchored · verify
      </span>
    {/if}
    {#if isPublished}
      <span
        class="border border-emerald-700/30 bg-emerald-50 px-2 py-0.5 font-mono text-[0.65rem] font-bold tracking-wider text-emerald-800 uppercase"
      >
        Published
      </span>
    {/if}
    <span class="ml-auto font-mono text-[0.68rem] tracking-wider text-ink-muted uppercase">
      № {draft.id} &middot; {new Date(draft.created_at).toLocaleDateString()}
    </span>
  </div>

  <form
    class="space-y-4"
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}
  >
    <label class="block font-mono text-[0.68rem] font-bold tracking-[0.12em] text-ink uppercase">
      <span class="sr-only">Headline</span>
      <textarea
        bind:value={headline}
        required
        rows="2"
        class="mt-1 w-full border border-paper-edge bg-paper/70 px-3 py-2 font-display text-lg leading-snug font-normal tracking-normal text-ink normal-case transition-colors focus:border-blue focus:bg-card focus:ring-2 focus:ring-blue/20 focus:outline-none"
      ></textarea>
    </label>

    <label class="block font-mono text-[0.68rem] font-bold tracking-[0.12em] text-ink uppercase">
      Subtitle
      <input
        bind:value={subtitle}
        class="mt-1.5 w-full border border-paper-edge bg-paper/70 px-3 py-2 font-display text-base font-normal tracking-normal text-ink normal-case italic transition-colors focus:border-blue focus:bg-card focus:ring-2 focus:ring-blue/20 focus:outline-none"
      />
    </label>

    <div>
      <span class="block font-mono text-[0.68rem] font-bold tracking-[0.12em] text-ink uppercase">
        Photo
      </span>
      <div class="mt-1.5">
        <PhotoInput currentRef={photoRef || null} onchange={(k) => (photoRef = k ?? '')} />
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label class="block font-mono text-[0.68rem] font-bold tracking-[0.12em] text-ink uppercase">
        Source post URL
        <input
          bind:value={sourcePostUrl}
          class="mt-1.5 w-full border border-paper-edge bg-paper/70 px-3 py-2 font-sans text-sm font-normal tracking-normal text-ink normal-case transition-colors focus:border-blue focus:bg-card focus:ring-2 focus:ring-blue/20 focus:outline-none"
        />
      </label>

      <label class="block font-mono text-[0.68rem] font-bold tracking-[0.12em] text-ink uppercase">
        Source note
        <input
          bind:value={sourceNote}
          class="mt-1.5 w-full border border-paper-edge bg-paper/70 px-3 py-2 font-sans text-sm font-normal tracking-normal text-ink normal-case transition-colors focus:border-blue focus:bg-card focus:ring-2 focus:ring-blue/20 focus:outline-none"
        />
      </label>
    </div>

    <div class="flex flex-wrap items-center gap-3 pt-1">
      <button
        type="submit"
        disabled={saving}
        class="cursor-pointer border border-ink bg-ink px-4 py-2 font-mono text-xs font-bold tracking-[0.12em] text-white uppercase transition-colors hover:border-blue hover:bg-blue disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
      {#if savedAt && !error}
        <span class="font-mono text-xs text-emerald-700">Saved at {savedAt}</span>
      {/if}
      {#if error}
        <span class="font-mono text-xs text-red">{error}</span>
      {/if}
    </div>
  </form>

  <div class="mt-4 flex flex-wrap items-center gap-3 border-t border-paper-edge pt-4">
    {#if isPublished}
      <button
        onclick={unpublish}
        disabled={publishing}
        class="cursor-pointer border border-amber-800 bg-amber-800 px-4 py-2 font-mono text-xs font-bold tracking-[0.12em] text-white uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {publishing ? 'Unpublishing…' : 'Unpublish'}
      </button>
    {:else}
      <button
        onclick={publish}
        disabled={publishing}
        class="cursor-pointer border border-emerald-800 bg-emerald-800 px-4 py-2 font-mono text-xs font-bold tracking-[0.12em] text-white uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {publishing ? 'Publishing…' : 'Publish'}
      </button>
    {/if}
    <button
      onclick={discard}
      disabled={discarding}
      class="ml-auto cursor-pointer border border-red/40 px-4 py-2 font-mono text-xs font-bold tracking-[0.12em] text-red uppercase transition-colors hover:bg-red hover:text-white disabled:opacity-50"
    >
      {discarding ? 'Discarding…' : 'Discard'}
    </button>
  </div>
</li>
