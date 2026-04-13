import { loadMLLibraries, getLibrariesStatus } from "./load-scripts.js";

// panel-detection/detector.js
// Main panel detector with lazy-loaded fallback chain
import { loadMLLibraries, getLibrariesStatus } from "./load-scripts.js";
export class PanelDetector {
  #cache = new Map();
  #scriptsLoaded = false;

  async detectPanels(doc, index, force = false) {
    const cacheKey = `${doc.location?.pathname || ""}-${index}`;

    if (!force && this.#cache.has(cacheKey)) {
      return this.#cache.get(cacheKey);
    }

    const imageData = this.#extractImageData(doc);
    if (!imageData) {
      return { panels: [], method: "no-image", confidence: 0 };
    }

    // Load ML libraries on first use
    if (!this.#scriptsLoaded) {
      const result = await loadMLLibraries();
      if (!result.loaded) {
        console.warn(
          "ML libraries not available, using grid detection:",
          result.reason,
        );
        // Fall back to grid immediately
        const { detectPanelsGrid } = await import("./grid.js");
        const panels = detectPanelsGrid(imageData);
        this.#cache.set(cacheKey, {
          panels,
          method: "grid",
          confidence: 0.4,
          reason: result.reason,
        });
        return {
          panels,
          method: "grid",
          confidence: 0.4,
          reason: result.reason,
        };
      }
      this.#scriptsLoaded = true;
    }

    const result = await this.#runDetectionPipeline(imageData);
    this.#cache.set(cacheKey, result);
    return result;
  }

  #extractImageData(doc) {
    const img = doc.querySelector("img") || doc.querySelector("canvas");
    if (!img) return null;

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  async #runDetectionPipeline(imageData) {
    const { detectPanelsOpenCV } = await import("./opencv.js");
    const { detectPanelsML } = await import("./coco-ssd.js");
    const { detectPanelsGrid } = await import("./grid.js");

    // Try OpenCV (uses global cv)
    try {
      const cv = globalThis.cv;
      if (cv && cv.Mat) {
        // Wait for OpenCV to be ready
        await new Promise((resolve, reject) => {
          const check = () => {
            if (cv && cv.Mat) resolve();
            else if (cv && cv.readyState === "complete")
              reject(new Error("OpenCV failed to load"));
            else setTimeout(check, 50);
          };
          check();
        });

        const panels = await detectPanelsOpenCV(imageData, cv);
        if (this.#validatePanels(panels, imageData)) {
          return { panels, method: "opencv", confidence: 0.85 };
        }
      }
    } catch (e) {
      console.warn("OpenCV detection failed:", e);
    }

    // Try ML (uses global cocoSsd)
    try {
      const cocoSsd = globalThis.cocoSsd;
      if (cocoSsd) {
        // Wait for COCO-SSD to be ready
        if (!cocoSsd.load) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const panels = await detectPanelsML(imageData, cocoSsd);
        if (this.#validatePanels(panels, imageData)) {
          return { panels, method: "ml", confidence: 0.7 };
        }
      }
    } catch (e) {
      console.warn("ML detection failed:", e);
    }

    // Grid fallback (always works)
    const panels = detectPanelsGrid(imageData);
    return { panels, method: "grid", confidence: 0.4 };
  }

  #validatePanels(panels, imageData) {
    if (!panels || panels.length === 0) return false;
    if (panels.length > 30) return false;

    const imgArea = imageData.width * imageData.height;
    let totalPanelArea = 0;
    for (const panel of panels) {
      const panelArea = ((panel.width * panel.height) / 10000) * imgArea;
      totalPanelArea += panelArea;
    }

    const coverage = totalPanelArea / imgArea;
    return coverage > 0.1 && coverage < 0.95;
  }

  clear() {
    this.#cache.clear();
  }

  // Expose library status for debugging
  getStatus() {
    return {
      ...getLibrariesStatus(),
      scriptsLoaded: this.#scriptsLoaded,
      cacheSize: this.#cache.size,
    };
  }
}
