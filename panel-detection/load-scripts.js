// panel-detection/load-scripts.js
// Dynamically loads ML/CV libraries as script tags
const loadedScripts = new Set();
export async function loadMLLibraries() {
  // Check if already loaded
  if (globalThis.cv && globalThis.tf && globalThis.cocoSsd) {
    return { loaded: true, method: "cached" };
  }

  // Check CSP compatibility
  if (!canUseEval()) {
    console.warn("Panel detection requires CSP with unsafe-eval");
    return { loaded: false, reason: "csp-blocked" };
  }

  const scripts = [
    { name: "TensorFlow", src: "./vendor/tfjs/tf.min.js", global: "tf" },
    { name: "OpenCV", src: "./vendor/opencv/opencv.js", global: "cv" },
    {
      name: "COCO-SSD",
      src: "./vendor/coco-ssd/coco-ssd.min.js",
      global: "cocoSsd",
    },
  ];

  try {
    for (const { name, src, global: globalName } of scripts) {
      if (globalThis[globalName]) continue; // Already loaded

      await loadScript(src);
      loadedScripts.add(src);

      // Verify global was set
      if (!globalThis[globalName]) {
        throw new Error(`${name} failed to load (global not set)`);
      }
    }

    return { loaded: true, method: "dynamic" };
  } catch (e) {
    console.warn("Failed to load ML libraries:", e);
    return { loaded: false, reason: e.message };
  }
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(script);
  });
}
function canUseEval() {
  // Try to detect if CSP allows eval
  try {
    const test = new Function("return true")();
    return test === true;
  } catch {
    return false;
  }
}
export function getLibrariesStatus() {
  return {
    opencv: !!globalThis.cv,
    tensorflow: !!globalThis.tf,
    cocoSsd: !!globalThis.cocoSsd,
  };
}
export function clearScripts() {
  // Note: We don't remove script tags as they can't be unloaded
  // This is for future cleanup if needed
  loadedScripts.clear();
}
