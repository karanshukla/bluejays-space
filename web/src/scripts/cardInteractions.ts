// Client behaviour shared by the feed (index.astro) and permalink pages
// (h/[id].astro). Both render the same HeadlineCard, and the feed re-runs the
// binding for every infinite-scroll batch, so this lived in three near-identical
// copies before it moved here.

export const CARD_ANCHOR_KEY = 'cardAnchor';
export const FEED_SCROLL_KEY = 'feedScrollY';

// Shared view-transition name, tagged on the card being navigated to and the
// card being navigated from, so the browser animates it as one continuous
// element instead of cross-fading it away with the rest of the page.
export const FOCUS_TRANSITION_NAME = 'card-focus';

export interface CardAnchor {
  id: string;
  top: number;
}

export function bindCopyLinks(root: ParentNode = document): void {
  root.querySelectorAll<HTMLButtonElement>('.copy-link').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const path = btn.dataset.url;
      if (!path) return;
      try {
        await navigator.clipboard.writeText(`${location.origin}${path}`);
        const svg = btn.querySelector('svg');
        if (svg) {
          svg.style.color = 'var(--color-blue)';
          setTimeout(() => (svg.style.color = ''), 1500);
        }
      } catch {
        window.open(path, '_blank');
      }
    });
  });
}

// Records where the card a visitor opened sat in their viewport, so the
// permalink page can place it at that exact offset instead of the card jumping
// somewhere else between the two pages. Delegated from the document so cards
// injected by infinite scroll are covered without re-binding.
export function rememberOpenedCard(): void {
  document.addEventListener('click', (event) => {
    const opener = (event.target as HTMLElement | null)?.closest('.card-open');
    const card = opener?.closest<HTMLLIElement>('li[data-headline-id]');
    if (!card?.dataset.headlineId) return;

    const anchor: CardAnchor = {
      id: card.dataset.headlineId,
      top: card.getBoundingClientRect().top,
    };
    try {
      sessionStorage.setItem(CARD_ANCHOR_KEY, JSON.stringify(anchor));
    } catch {
      // Private-mode storage failures just cost the scroll anchoring, not the navigation.
    }
    card.style.viewTransitionName = FOCUS_TRANSITION_NAME;
  });
}
