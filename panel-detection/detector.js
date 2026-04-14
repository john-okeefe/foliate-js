// panel-detection/detector.js
// Main panel detector with lazy-loaded fallback chain
import { loadMLLibraries, getLibrariesStatus } from "./load-scripts.js";
export class PanelDetector {
  #cache = new Map();
  #scriptsLoaded = false;
  #model = null;

  async detectPanels(doc, index, force = false) {
    const cacheKey = `${doc.location?.pathname || ""}-${index}`;

    if (!force && this.#cache.has(cacheKey)) {
      console.log("[Panel Detection] Using cached result");
      return this.#cache.get(cacheKey);
    }

    const imageData = this.#extractImageData(doc);
    if (!imageData) {
      return { panels: [], method: "no-image", confidence: 0 };
    }
    console.log(
      "[Panel Detection] Starting detection for image:",
      `${imageData.width}x${imageData.height}px`,
    );
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
    console.log("[Panel Detection] Attempting OpenCV detection...");
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
        console.log("[Panel Detection] OpenCV found", panels.length, "panels");
        if (this.#validatePanels(panels, imageData)) {
          console.log("[Panel Detection] ✓ Using OpenCV detection");
          return { panels, method: "opencv", confidence: 0.85 };
        } else {
          console.log("[Panel Detection] ✗ OpenCV panels failed validation");
        }
      }
    } catch (e) {
      console.warn("OpenCV detection failed:", e);
    }

    // Try ML (uses global cocoSsd)
    console.log("[Panel Detection] Attempting ML detection...");
    try {
      const cocoSsdModule = globalThis.cocoSsd;
      if (cocoSsdModule && cocoSsdModule.load) {
        // Load model if not cached
        if (!this.#model) {
          console.log("[Panel Detection] Loading COCO-SSD model...");
          this.#model = await cocoSsdModule.load();
          console.log("[Panel Detection] COCO-SSD model loaded");
        } else {
          console.log("[Panel Detection] Using cached COCO-SSD model");
        }

        const panels = await detectPanelsML(imageData, this.#model);
        console.log("[Panel Detection] ML found", panels.length, "panels");
        if (this.#validatePanels(panels, imageData)) {
          console.log("[Panel Detection] ✓ Using ML detection");
          return { panels, method: "ml", confidence: 0.7 };
        } else {
          console.log("[Panel Detection] ✗ ML panels failed validation");
        }
      }
    } catch (e) {
      console.warn("ML detection failed:", e);
    }

    // Grid fallback (always works)
    console.log("[Panel Detection] Falling back to grid detection");
    const panels = detectPanelsGrid(imageData);
    console.log(
      "[Panel Detection] ✓ Using grid detection, found",
      panels.length,
      "panels",
    );
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
    this.#model = null;
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
