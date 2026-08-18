// Vertical-scroll (webtoon) renderer for comics: all pages stacked in one
// scrolling column, lazily loaded with an IntersectionObserver and unloaded
// when far from the reading position (keeping placeholder geometry stable
// via aspect-ratio so the scrollbar never jumps).

export class Webtoon extends HTMLElement {
  #root = this.attachShadow({ mode: "closed" });
  #book;
  #pages = [];
  #index = -1;
  #firstNav = true;
  #loadIO = null;
  #scrollRaf = null;

  constructor() {
    super();

    const sheet = new CSSStyleSheet();
    this.#root.adoptedStyleSheets = [sheet];
    sheet.replaceSync(`
            :host {
                display: block;
                width: 100%;
                height: 100%;
                overflow-y: auto;
                overscroll-behavior: contain;
            }
            .page {
                max-width: 900px;
                margin: 0 auto;
                position: relative;
            }
            .page img {
                display: block;
                width: 100%;
                /* brightness/contrast/invert driven by the host page
                   (CSS custom properties inherit into shadow DOM) */
                filter: var(--fx-filter, none);
            }
        `);

    this.addEventListener("scroll", () => this.#onScroll(), {
      passive: true,
    });
  }

  open(book) {
    this.#book = book;
    const sections = book.sections ?? [];
    // Placeholder height until the image loads and sets the real
    // aspect-ratio; oversized so early scrolling doesn't skip pages.
    const minH = Math.round((window.innerHeight || 1000) * 1.4);
    const frag = document.createDocumentFragment();
    this.#pages = sections.map((section, i) => {
      const el = document.createElement("div");
      el.className = "page";
      el.dataset.index = i;
      el.style.minHeight = `${minH}px`;
      frag.append(el);
      return { el, section, loaded: false, img: null };
    });
    this.#root.append(frag);

    this.#loadIO = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.#loadIO.unobserve(entry.target);
          this.#loadPage(Number(entry.target.dataset.index));
        }
      },
      // generous margin so pages are ready before they scroll into view
      { root: this, rootMargin: "150% 0%" },
    );
    for (const p of this.#pages) this.#loadIO.observe(p.el);
  }

  async #loadPage(i) {
    const p = this.#pages[i];
    if (!p || p.loaded) return;
    p.loaded = true;
    try {
      const url = await p.section.load?.();
      if (!url) return;
      const html = await (await fetch(url)).text();
      const m = html.match(/src="(blob:[^"]+)"/);
      if (!m) return;
      const img = new Image();
      img.decoding = "async";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = m[1];
      });
      // Fix the geometry so later unloading never shifts scroll height.
      p.el.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      p.el.style.minHeight = "0";
      p.el.append(img);
      p.img = img;
    } catch (e) {
      p.loaded = false;
      console.warn("webtoon: failed to load page", i + 1, e);
    }
  }

  // Free far-away pages (images + their blob URLs) while keeping the
  // aspect-ratio placeholder, so the column height stays stable.
  #unloadFar(current) {
    for (let i = 0; i < this.#pages.length; i++) {
      const p = this.#pages[i];
      if (!p.loaded || !p.img) continue;
      if (Math.abs(i - current) > 12) {
        p.img.remove();
        p.img = null;
        p.loaded = false;
        p.section.unload?.();
        this.#loadIO.observe(p.el);
      }
    }
  }

  #onScroll() {
    if (this.#scrollRaf) return;
    this.#scrollRaf = requestAnimationFrame(() => {
      this.#scrollRaf = null;
      this.#updateIndex();
    });
  }

  #updateIndex() {
    if (!this.#pages.length) return;
    const hostRect = this.getBoundingClientRect();
    const center = hostRect.top + hostRect.height / 2;
    let idx = this.#index < 0 ? 0 : this.#index;
    const n = this.#pages.length;
    while (idx < n - 1) {
      const r = this.#pages[idx].el.getBoundingClientRect();
      if (center < r.bottom - 1) break;
      idx++;
    }
    while (idx > 0) {
      const r = this.#pages[idx].el.getBoundingClientRect();
      if (center > r.top + 1) break;
      idx--;
    }
    const r = this.#pages[idx].el.getBoundingClientRect();
    const fraction = Math.min(
      1,
      Math.max(0, (center - r.top) / (r.height || 1)),
    );
    if (idx !== this.#index) {
      this.#index = idx;
      this.#unloadFar(idx);
    }
    this.#report(fraction);
  }

  #report(fraction = 0, reason = "scroll") {
    this.dispatchEvent(
      new CustomEvent("relocate", {
        detail: {
          reason,
          range: null,
          index: Math.max(0, this.#index),
          fraction,
          size: 1,
        },
      }),
    );
  }

  get index() {
    return Math.max(0, this.#index);
  }

  // Renderer interface (mirrors fixed-layout): goTo receives a thenable
  // resolving to { index }.
  async goTo(target) {
    const resolved = await target;
    const p = this.#pages[resolved?.index];
    if (!p) return;
    this.#firstNav = false;
    p.el.scrollIntoView({ block: "start" });
    this.#index = resolved.index;
    requestAnimationFrame(() => this.#updateIndex());
  }

  // Screen-height paging, like dedicated webtoon readers. The first call is
  // view.init()'s fresh-start probe — a no-op that just reports location.
  async next() {
    if (this.#firstNav) {
      this.#firstNav = false;
      this.scrollTo(0, 0);
      this.#index = 0;
      this.#updateIndex();
      return true;
    }
    this.scrollBy({ top: this.clientHeight * 0.88, behavior: "smooth" });
    return true;
  }

  async prev() {
    this.scrollBy({ top: -this.clientHeight * 0.88, behavior: "smooth" });
    return true;
  }

  goLeft() {
    return this.prev();
  }

  goRight() {
    return this.next();
  }

  getContents() {
    return [];
  }

  destroy() {
    this.#loadIO?.disconnect();
  }
}

customElements.define("foliate-webtoon", Webtoon);
