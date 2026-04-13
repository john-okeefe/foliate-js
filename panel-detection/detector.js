// panel-detection/detector.js
// Main panel detector with lazy-loaded fallback chain
export class PanelDetector {
  #opencv = null;
  #model = null;
  #cache = new Map();

  async detectPanels(doc, index, force = false) {
    const cacheKey = `${doc.location?.pathname || ""}-${index}`;

    if (!force && this.#cache.has(cacheKey)) {
      return this.#cache.get(cacheKey);
    }

    const imageData = this.#extractImageData(doc);
    if (!imageData) {
      return { panels: [], method: "no-image", confidence: 0 };
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

    if (!this.#opencv) {
      try {
        this.#opencv = await this.#loadOpenCV();
      } catch (e) {
        console.warn("Failed to load OpenCV:", e);
      }
    }

    if (this.#opencv) {
      try {
        const panels = await detectPanelsOpenCV(imageData, this.#opencv);
        if (this.#validatePanels(panels, imageData)) {
          return { panels, method: "opencv", confidence: 0.85 };
        }
      } catch (e) {
        console.warn("OpenCV detection failed:", e);
      }
    }

    if (!this.#model) {
      try {
        this.#model = await this.#loadModel();
      } catch (e) {
        console.warn("Failed to load ML model:", e);
      }
    }

    if (this.#model) {
      try {
        const panels = await detectPanelsML(imageData, this.#model);
        if (this.#validatePanels(panels, imageData)) {
          return { panels, method: "ml", confidence: 0.7 };
        }
      } catch (e) {
        console.warn("ML detection failed:", e);
      }
    }

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

  async #loadOpenCV() {
    if (this.#opencv) return this.#opencv;

    try {
      const cv = await import("../vendor/opencv/opencv.js");

      await new Promise((resolve, reject) => {
        const check = () => {
          if (cv && cv.Mat) resolve();
          else if (cv.readyState === "complete")
            reject(new Error("OpenCV failed to load"));
          else setTimeout(check, 50);
        };
        check();
      });

      this.#opencv = cv.default || cv;
      return this.#opencv;
    } catch (e) {
      console.warn("Failed to load OpenCV:", e);
      return null;
    }
  }
  async #loadModel() {
    if (this.#model) return this.#model;

    try {
      await import("../vendor/tfjs/tf.min.js");
      const cocoSsd = await import("../vendor/coco-ssd/coco-ssd.min.js");
      this.#model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
      return this.#model;
    } catch (e) {
      console.warn("Failed to load ML model:", e);
      return null;
    }
  }

  clear() {
    this.#cache.clear();
  }
}
