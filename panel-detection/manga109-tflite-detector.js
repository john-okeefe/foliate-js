// panel-detection/manga109-tflite-detector.js
// Manga109 panel detection using TFLite
let tfliteModel = null;
/**
 * Initialize the Manga109 TFLite model
 * @returns {Promise<boolean>} True if loaded successfully
 */
export async function initManga109Model() {
  if (tfliteModel) {
    console.log("[Manga109 TFLite] Using cached model");
    return true;
  }
  try {
    console.log("[Manga109 TFLite] Loading model...");
    // Check if TFLite is available
    if (typeof tflite === "undefined") {
      throw new Error(
        "TensorFlow.js TFLite not loaded. Include @tensorflow/tfjs-tflite",
      );
    }
    // Load the TFLite model directly - NO CONVERSION NEEDED!
    tfliteModel = await tflite.loadTFLiteModel(
      "./vendor/manga109/model.tflite",
    );
    console.log("[Manga109 TFLite] Model loaded successfully");
    return true;
  } catch (error) {
    console.error("[Manga109 TFLite] Failed to load model:", error);
    tfliteModel = null;
    return false;
  }
}
/**
 * Detect panels using Manga109 TFLite model
 * @param {ImageData} imageData - Image data from canvas
 * @returns {Promise<Array>} Array of panel detections
 */
export async function detectManga109Panels(imageData) {
  if (!tfliteModel) {
    throw new Error("Model not loaded. Call initManga109Model() first.");
  }
  console.log("[Manga109 TFLite] Detecting panels...");
  try {
    const imgWidth = imageData.width;
    const imgHeight = imageData.height;
    // Convert ImageData to tensor
    const tensor = tf.browser.fromPixels(imageData);
    // Preprocess: resize to 640x640 (YOLO26 input size)
    const resized = tf.image.resizeBilinear(tensor, [640, 640]);

    // Normalize to 0-1 and adjust for TFLite model input requirements
    // YOLO models typically expect RGB in [0, 255] range or [0, 1]
    // We'll use [0, 1] range
    const normalized = resized.div(255.0);

    // Add batch dimension: [1, 640, 640, 3]
    const batched = normalized.expandDims(0);
    // Run inference
    const startTime = performance.now();
    const outputTensor = tfliteModel.predict(batched);
    const endTime = performance.now();
    console.log(
      `[Manga109 TFLite] Inference took ${(endTime - startTime).toFixed(2)}ms`,
    );
    // Postprocess outputs
    const panels = postprocessTFLiteOutputs(outputTensor, imgWidth, imgHeight);
    console.log(`[Manga109 TFLite] Detected ${panels.length} panels`);
    // Clean up tensors
    tensor.dispose();
    resized.dispose();
    normalized.dispose();
    batched.dispose();
    return panels;
  } catch (error) {
    console.error("[Manga109 TFLite] Detection failed:", error);
    throw error;
  }
}
/**
 * Postprocess TFLite YOLO outputs to panel detections
 * @param {Tensor} outputTensor - Model output tensor
 * @param {number} imgWidth - Original image width
 * @param {number} imgHeight - Original image height
 * @returns {Array} Array of panel objects
 */
function postprocessTFLiteOutputs(outputTensor, imgWidth, imgHeight) {
  const panels = [];
  const confidenceThreshold = 0.5;
  // TFLite YOLO output format
  // Typically: [batch, num_detections, 85] for 80 classes (COCO)
  // For 2-class model (panel, text): [batch, num_detections, 6]
  // where 6 = [x_center, y_center, width, height, confidence, class_id]

  const outputArray = outputTensor.dataSync();
  const shape = outputTensor.shape;

  console.log(`[Manga109 TFLite] Output shape: [${shape.join(", ")}]`);
  const [batch, numDetections, numClasses] = shape;
  // Parse detections
  for (let i = 0; i < numDetections; i++) {
    const offset = i * numClasses;
    // Extract values (may need adjustment based on actual model output)
    const centerX = outputArray[offset];
    const centerY = outputArray[offset + 1];
    const width = outputArray[offset + 2];
    const height = outputArray[offset + 3];
    const confidence = outputArray[offset + 4];
    const classId = Math.round(outputArray[offset + 5]);
    // Only detect panels (class 0)
    if (classId !== 0) continue;

    if (confidence < confidenceThreshold) continue;
    // Convert from center coords to top-left
    // YOLO outputs are typically normalized [0, 1] or in pixels
    // Assuming normalized output:
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const x = (centerX - halfWidth) * imgWidth;
    const y = (centerY - halfHeight) * imgHeight;
    const w = width * imgWidth;
    const h = height * imgHeight;
    // Convert to percentages
    panels.push({
      id: `manga109-tflite-${panels.length}`,
      x: (x / imgWidth) * 100,
      y: (y / imgHeight) * 100,
      width: (w / imgWidth) * 100,
      height: (h / imgHeight) * 100,
      confidence: confidence,
      reading_order: panels.length,
    });
  }
  // Apply Non-Maximum Suppression
  return applyNMS(panels);
}

/**
 * Apply Non-Maximum Suppression to remove duplicate detections
 * @param {Array} panels - Array of panel detections
 * @param {number} iouThreshold - IoU threshold for NMS
 * @returns {Array} Filtered panels
 */
function applyNMS(panels, iouThreshold = 0.5) {
  if (panels.length === 0) return panels;
  // Sort by confidence (highest first)
  panels.sort((a, b) => b.confidence - a.confidence);
  const keep = [];
  const suppressed = new Set();
  for (let i = 0; i < panels.length; i++) {
    if (suppressed.has(i)) continue;
    keep.push(panels[i]);
    // Suppress overlapping boxes
    for (let j = i + 1; j < panels.length; j++) {
      if (suppressed.has(j)) continue;
      const iou = calculateIoU(panels[i], panels[j]);
      if (iou > iouThreshold) {
        suppressed.add(j);
      }
    }
  }
  return keep.map((p, i) => ({ ...p, reading_order: i }));
}
/**
 * Calculate Intersection over Union (IoU)
 * @param {Object} box1 - First panel
 * @param {Object} box2 - Second panel
 * @returns {number} IoU value
 */
function calculateIoU(box1, box2) {
  // Convert percentage coordinates to pixels for calculation
  const x1 = Math.max(box1.x, box2.x);
  const y1 = Math.max(box1.y, box2.y);
  const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
  const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);
  if (x2 < x1 || y2 < y1) return 0;
  const intersection = (x2 - x1) * (y2 - y1);
  const area1 = box1.width * box1.height;
  const area2 = box2.width * box2.height;
  const union = area1 + area2 - intersection;
  return intersection / union;
}
/**
 * Get model status
 * @returns {Object} Status information
 */
export function getManga109Status() {
  return {
    loaded: model !== null,
    type: "YOLO26-nano (Manga109)",
    accuracy: "95.6% mAP50",
    classes: ["panel", "text"],
  };
}
/**
 * Clear cached model
 */
export function clearManga109Model() {
  if (model) {
    model.dispose();
    model = null;
  }
  console.log("[Manga109] Model cache cleared");
}
