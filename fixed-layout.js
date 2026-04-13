const parseViewport = (str) =>
  str
    ?.split(/[,;\s]/) // NOTE: technically, only the comma is valid
    ?.filter((x) => x)
    ?.map((x) => x.split("=").map((x) => x.trim()));

const getViewport = (doc, viewport) => {
  // use `viewBox` for SVG
  if (doc.documentElement.localName === "svg") {
    const [, , width, height] =
      doc.documentElement.getAttribute("viewBox")?.split(/\s/) ?? [];
    return { width, height };
  }

  // get `viewport` `meta` element
  const meta = parseViewport(
    doc.querySelector('meta[name="viewport"]')?.getAttribute("content"),
  );
  if (meta) return Object.fromEntries(meta);

  // fallback to book's viewport
  if (typeof viewport === "string") return parseViewport(viewport);
  if (viewport?.width && viewport.height) return viewport;

  // if no viewport (possibly with image directly in spine), get image size
  const img = doc.querySelector("img");
  if (img) return { width: img.naturalWidth, height: img.naturalHeight };

  // just show *something*, i guess...
  console.warn(new Error("Missing viewport properties"));
  return { width: 1000, height: 2000 };
};

export class FixedLayout extends HTMLElement {
  static observedAttributes = ["zoom", "panel-mode"];
  #root = this.attachShadow({ mode: "closed" });
  #observer = new ResizeObserver(() => this.#render());
  #spreads;
  #index = -1;
  defaultViewport;
  spread;
  #portrait = false;
  #left;
  #right;
  #center;
  #side;
  #zoom;
  // Panel detection support
  #panelDetector = null;
  #currentPanels = [];
  #panelOverlay = null;
  #touchStartX = 0;
  #touchStartY = 0;
  #touchStartTime = 0;
  #panelIndex = 0;
  constructor() {
    super();

    const sheet = new CSSStyleSheet();
    this.#root.adoptedStyleSheets = [sheet];
    sheet.replaceSync(`:host {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: auto;
        }`);

    this.#observer.observe(this);
    // Initialize panel detector
    if (customElements.get("foliate-fxl") === this.constructor) {
      import("./panel-detection/detector.js").then((m) => {
        this.#panelDetector = new m.PanelDetector();
      });
    }
  }
  attributeChangedCallback(name, _, value) {
    switch (name) {
      case "zoom":
        this.#zoom =
          value !== "fit-width" && value !== "fit-page"
            ? parseFloat(value)
            : value;
        this.#render();
        break;
      case "panel-mode":
        if (value === null) {
          this.#exitPanelMode();
        }
        break;
    }
  }
  async #createFrame({ index, src: srcOption }) {
    const srcOptionIsString = typeof srcOption === "string";
    const src = srcOptionIsString ? srcOption : srcOption?.src;
    const onZoom = srcOptionIsString ? null : srcOption?.onZoom;
    const element = document.createElement("div");
    element.setAttribute("dir", "ltr");
    const iframe = document.createElement("iframe");
    element.append(iframe);
    Object.assign(iframe.style, {
      border: "0",
      display: "none",
      overflow: "hidden",
    });
    // `allow-scripts` is needed for events because of WebKit bug
    // https://bugs.webkit.org/show_bug.cgi?id=218086
    iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("part", "filter");
    this.#root.append(element);
    if (!src) return { blank: true, element, iframe };
    return new Promise((resolve) => {
      iframe.addEventListener(
        "load",
        () => {
          const doc = iframe.contentDocument;
          this.dispatchEvent(
            new CustomEvent("load", { detail: { doc, index } }),
          );
          const { width, height } = getViewport(doc, this.defaultViewport);
          resolve({
            element,
            iframe,
            width: parseFloat(width),
            height: parseFloat(height),
            onZoom,
          });
        },
        { once: true },
      );
      iframe.src = src;
    });
  }
  #render(side = this.#side) {
    if (!side) return;
    const left = this.#left ?? {};
    const right = this.#center ?? this.#right ?? {};
    const target = side === "left" ? left : right;
    const { width, height } = this.getBoundingClientRect();
    const portrait =
      this.spread !== "both" && this.spread !== "portrait" && height > width;
    this.#portrait = portrait;
    const blankWidth = left.width ?? right.width ?? 0;
    const blankHeight = left.height ?? right.height ?? 0;

    const scale =
      typeof this.#zoom === "number" && !isNaN(this.#zoom)
        ? this.#zoom
        : (this.#zoom === "fit-width"
            ? portrait || this.#center
              ? width / (target.width ?? blankWidth)
              : width /
                ((left.width ?? blankWidth) + (right.width ?? blankWidth))
            : portrait || this.#center
              ? Math.min(
                  width / (target.width ?? blankWidth),
                  height / (target.height ?? blankHeight),
                )
              : Math.min(
                  width /
                    ((left.width ?? blankWidth) + (right.width ?? blankWidth)),
                  height /
                    Math.max(
                      left.height ?? blankHeight,
                      right.height ?? blankHeight,
                    ),
                )) || 1;

    const transform = (frame) => {
      let { element, iframe, width, height, blank, onZoom } = frame;
      if (!iframe) return;
      if (onZoom) onZoom({ doc: frame.iframe.contentDocument, scale });
      const iframeScale = onZoom ? scale : 1;
      Object.assign(iframe.style, {
        width: `${width * iframeScale}px`,
        height: `${height * iframeScale}px`,
        transform: onZoom ? "none" : `scale(${scale})`,
        transformOrigin: "top left",
        display: blank ? "none" : "block",
      });
      Object.assign(element.style, {
        width: `${(width ?? blankWidth) * scale}px`,
        height: `${(height ?? blankHeight) * scale}px`,
        overflow: "hidden",
        display: "block",
        flexShrink: "0",
        marginBlock: "auto",
      });
      if (portrait && frame !== target) {
        element.style.display = "none";
      }
    };
    if (this.#center) {
      transform(this.#center);
    } else {
      transform(left);
      transform(right);
    }
  }
  async #showSpread({ left, right, center, side }) {
    this.#root.replaceChildren();
    this.#left = null;
    this.#right = null;
    this.#center = null;
    if (center) {
      this.#center = await this.#createFrame(center);
      this.#side = "center";
      this.#render();
    } else {
      this.#left = await this.#createFrame(left);
      this.#right = await this.#createFrame(right);
      this.#side = this.#left.blank
        ? "right"
        : this.#right.blank
          ? "left"
          : side;
      this.#render();
    }
  }
  #goLeft() {
    if (this.#center || this.#left?.blank) return;
    if (this.#portrait && this.#left?.element?.style?.display === "none") {
      this.#side = "left";
      this.#render();
      this.#reportLocation("page");
      return true;
    }
  }
  #goRight() {
    if (this.#center || this.#right?.blank) return;
    if (this.#portrait && this.#right?.element?.style?.display === "none") {
      this.#side = "right";
      this.#render();
      this.#reportLocation("page");
      return true;
    }
  }
  open(book) {
    this.book = book;
    const { rendition } = book;
    this.spread = rendition?.spread;
    this.defaultViewport = rendition?.viewport;

    const rtl = book.dir === "rtl";
    const ltr = !rtl;
    this.rtl = rtl;

    if (rendition?.spread === "none")
      this.#spreads = book.sections.map((section) => ({ center: section }));
    else
      this.#spreads = book.sections.reduce(
        (arr, section, i) => {
          const last = arr[arr.length - 1];
          const { pageSpread } = section;
          const newSpread = () => {
            const spread = {};
            arr.push(spread);
            return spread;
          };
          if (pageSpread === "center") {
            const spread = last.left || last.right ? newSpread() : last;
            spread.center = section;
          } else if (pageSpread === "left") {
            const spread =
              last.center || last.left || (ltr && i) ? newSpread() : last;
            spread.left = section;
          } else if (pageSpread === "right") {
            const spread =
              last.center || last.right || (rtl && i) ? newSpread() : last;
            spread.right = section;
          } else if (ltr) {
            if (last.center || last.right) newSpread().left = section;
            else if (last.left || !i) last.right = section;
            else last.left = section;
          } else {
            if (last.center || last.left) newSpread().right = section;
            else if (last.right || !i) last.left = section;
            else last.right = section;
          }
          return arr;
        },
        [{}],
      );

    // Add touch support for panel navigation
    this.#addTouchSupport();
  }
  #addTouchSupport() {
    const opts = { passive: false };
    this.addEventListener("touchstart", this.#onTouchStart.bind(this), opts);
    this.addEventListener("touchmove", this.#onTouchMove.bind(this), opts);
    this.addEventListener("touchend", this.#onTouchEnd.bind(this));
  }

  #onTouchStart(e) {
    this.#touchStartTime = e.timeStamp;
    const touch = e.changedTouches[0];
    this.#touchStartX = touch?.screenX || 0;
    this.#touchStartY = touch?.screenY || 0;
  }

  #onTouchMove(e) {
    if (this.hasAttribute("panel-mode")) return;
    const touch = e.changedTouches[0];
    if (!touch) return;

    const dx = this.#touchStartX - touch.screenX;
    const dy = this.#touchStartY - touch.screenY;

    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      e.preventDefault();
    }
  }

  async #onTouchEnd(e) {
    if (this.hasAttribute("panel-mode")) {
      await this.#handlePanelTouch(e);
      return;
    }

    const touch = e.changedTouches[0];
    if (!touch) return;

    const dx = this.#touchStartX - touch.screenX;
    const dy = this.#touchStartY - touch.screenY;
    const dt = e.timeStamp - (this.#touchStartTime || e.timeStamp);

    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;

    const vx = Math.abs(dx / dt);

    if (Math.abs(dx) > Math.abs(dy) && vx > 0.3) {
      if (dx > 0) await this.next();
      else await this.prev();
    }
  }

  async #handlePanelTouch(e) {
    const touch = e.changedTouches[0];
    if (!touch) return;

    const dx = this.#touchStartX - touch.screenX;
    const dy = this.#touchStartY - touch.screenY;

    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      // Tap - toggle panel overlay
      this.#togglePanelOverlay();
      return;
    }

    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) await this.nextPanel();
      else await this.prevPanel();
    } else {
      if (dy > 0) await this.nextPanel();
      else await this.prevPanel();
    }
  }
  get index() {
    const spread = this.#spreads[this.#index];
    const section =
      spread?.center ??
      (this.#side === "left"
        ? (spread.left ?? spread.right)
        : (spread.right ?? spread.left));
    return this.book.sections.indexOf(section);
  }
  #reportLocation(reason) {
    this.dispatchEvent(
      new CustomEvent("relocate", {
        detail: {
          reason,
          range: null,
          index: this.index,
          fraction: 0,
          size: 1,
        },
      }),
    );
  }
  getSpreadOf(section) {
    const spreads = this.#spreads;
    for (let index = 0; index < spreads.length; index++) {
      const { left, right, center } = spreads[index];
      if (left === section) return { index, side: "left" };
      if (right === section) return { index, side: "right" };
      if (center === section) return { index, side: "center" };
    }
  }
  async goToSpread(index, side, reason) {
    if (index < 0 || index > this.#spreads.length - 1) return;
    if (index === this.#index) {
      this.#render(side);
      return;
    }
    this.#index = index;
    const spread = this.#spreads[index];
    if (spread.center) {
      const index = this.book.sections.indexOf(spread.center);
      const src = await spread.center?.load?.();
      await this.#showSpread({ center: { index, src } });
    } else {
      const indexL = this.book.sections.indexOf(spread.left);
      const indexR = this.book.sections.indexOf(spread.right);
      const srcL = await spread.left?.load?.();
      const srcR = await spread.right?.load?.();
      const left = { index: indexL, src: srcL };
      const right = { index: indexR, src: srcR };
      await this.#showSpread({ left, right, side });
    }
    this.#reportLocation(reason);
  }
  async select(target) {
    await this.goTo(target);
    // TODO
  }
  async goTo(target) {
    const { book } = this;
    const resolved = await target;
    const section = book.sections[resolved.index];
    if (!section) return;
    const { index, side } = this.getSpreadOf(section);
    await this.goToSpread(index, side);
  }
  async next() {
    if (this.hasAttribute("panel-mode")) {
      await this.nextPanel();
      return;
    }
    const s = this.rtl ? this.#goLeft() : this.#goRight();
    if (!s)
      return this.goToSpread(
        this.#index + 1,
        this.rtl ? "right" : "left",
        "page",
      );
  }
  async prev() {
    if (this.hasAttribute("panel-mode")) {
      await this.prevPanel();
      return;
    }
    const s = this.rtl ? this.#goRight() : this.#goLeft();
    if (!s)
      return this.goToSpread(
        this.#index - 1,
        this.rtl ? "left" : "right",
        "page",
      );
  }

  // Internal methods for panel navigation (bypass panel-mode check)
  async #nextPage() {
    const s = this.rtl ? this.#goLeft() : this.#goRight();
    if (!s)
      return this.goToSpread(
        this.#index + 1,
        this.rtl ? "right" : "left",
        "page",
      );
  }
  async #prevPage() {
    const s = this.rtl ? this.#goRight() : this.#goLeft();
    if (!s)
      return this.goToSpread(
        this.#index - 1,
        this.rtl ? "left" : "right",
        "page",
      );
  }
  // Panel navigation methods
  async nextPanel() {
    if (!this.hasAttribute("panel-mode")) {
      this.setAttribute("panel-mode", "");
      await this.#enterPanelMode();
    }

    if (this.#panelIndex < this.#currentPanels.length - 1) {
      this.#panelIndex++;
      await this.#zoomToPanel(this.#currentPanels[this.#panelIndex]);
    } else {
      await this.#nextPage();
      this.#panelIndex = 0;
      if (this.#currentPanels.length > 0) {
        await this.#zoomToPanel(this.#currentPanels[0]);
      }
    }
  }

  async prevPanel() {
    if (!this.hasAttribute("panel-mode")) return;

    if (this.#panelIndex > 0) {
      this.#panelIndex--;
      await this.#zoomToPanel(this.#currentPanels[this.#panelIndex]);
    } else {
      await this.#prevPage();
      this.#panelIndex = this.#currentPanels.length - 1;
      if (this.#panelIndex >= 0) {
        await this.#zoomToPanel(this.#currentPanels[this.#panelIndex]);
      }
    }
  }

  async #enterPanelMode() {
    if (!this.#panelDetector) return;

    const contents = this.getContents();
    for (const { doc } of contents) {
      if (doc) {
        const index = this.index;
        const result = await this.#panelDetector.detectPanels(doc, index);
        this.#currentPanels = result.panels;
        this.#panelIndex = 0;
        break;
      }
    }

    if (this.#currentPanels.length > 0) {
      this.#showPanelOverlay();
      await this.#zoomToPanel(this.#currentPanels[0]);
    }
  }

  #exitPanelMode() {
    this.#panelIndex = 0;
    this.#currentPanels = [];
    this.#hidePanelOverlay();
    this.removeAttribute("panel-mode");
    this.#render();
  }

  #togglePanelOverlay() {
    if (this.#panelOverlay) {
      this.#hidePanelOverlay();
    } else {
      this.#showPanelOverlay();
    }
  }

  #showPanelOverlay() {
    if (this.#panelOverlay || this.#currentPanels.length === 0) return;

    const frame = this.#center || this.#left || this.#right;
    if (!frame?.element) return;

    this.#panelOverlay = document.createElement("div");
    this.#panelOverlay.className = "panel-overlay";
    this.#panelOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 100;
        `;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.style.cssText = "width: 100%; height: 100%;";

    this.#currentPanels.forEach((panel, i) => {
      const rect = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect",
      );
      rect.setAttribute("x", panel.x);
      rect.setAttribute("y", panel.y);
      rect.setAttribute("width", panel.width);
      rect.setAttribute("height", panel.height);
      rect.setAttribute("fill", "none");
      rect.setAttribute(
        "stroke",
        i === this.#panelIndex ? "#ff6b35" : "rgba(255,255,255,0.5)",
      );
      rect.setAttribute("stroke-width", "2");
      rect.setAttribute("stroke-dasharray", "5,5");
      svg.appendChild(rect);
    });

    this.#panelOverlay.appendChild(svg);
    frame.element.appendChild(this.#panelOverlay);
  }

  #hidePanelOverlay() {
    if (this.#panelOverlay) {
      this.#panelOverlay.remove();
      this.#panelOverlay = null;
    }
  }

  async #zoomToPanel(panel) {
    const frame = this.#center || this.#left || this.#right;
    if (!frame?.width || !frame?.height) return;

    const containerRect = this.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;

    const panelWidthPx = (panel.width / 100) * frame.width;
    const panelHeightPx = (panel.height / 100) * frame.height;
    const panelXPx = (panel.x / 100) * frame.width;
    const panelYPx = (panel.y / 100) * frame.height;

    const scaleX = containerWidth / panelWidthPx;
    const scaleY = containerHeight / panelHeightPx;
    const scale = Math.min(scaleX, scaleY) * 0.9;

    const scrollX = (panelXPx + panelWidthPx / 2) * scale - containerWidth / 2;
    const scrollY =
      (panelYPx + panelHeightPx / 2) * scale - containerHeight / 2;

    this.setAttribute("zoom", scale);
    this.scrollTo(scrollX, scrollY);

    this.#showPanelOverlay();
  }
  getContents() {
    return Array.from(this.#root.querySelectorAll("iframe"), (frame) => ({
      doc: frame.contentDocument,
      // TODO: index, overlayer
    }));
  }
  get panelCount() {
    return this.#currentPanels.length;
  }

  get currentPanelIndex() {
    return this.#panelIndex;
  }

  togglePanelMode() {
    if (this.hasAttribute("panel-mode")) {
      this.#exitPanelMode();
    } else {
      this.setAttribute("panel-mode", "");
      this.#enterPanelMode();
    }
  }
  destroy() {
    this.#observer.unobserve(this);
  }
}

customElements.define("foliate-fxl", FixedLayout);
