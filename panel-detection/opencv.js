// panel-detection/opencv.js
// OpenCV-based panel detection optimized for comic/manga panels
// Extract a portion of image data for 2-page spread splitting
function extractImageDataRegion(imageData, startX, startY, width, height) {
  const result = new ImageData(
    new Uint8ClampedArray(width * height * 4),
    width,
    height,
  );

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = ((startY + y) * imageData.width + (startX + x)) * 4;
      const destIdx = (y * width + x) * 4;
      result.data[destIdx] = imageData.data[srcIdx];
      result.data[destIdx + 1] = imageData.data[srcIdx + 1];
      result.data[destIdx + 2] = imageData.data[srcIdx + 2];
      result.data[destIdx + 3] = imageData.data[srcIdx + 3];
    }
  }

  return result;
}
// Preprocess image to isolate comic panel borders
function preprocessComicImage(imageData, cv) {
  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  const binary = new cv.Mat();
  const processed = new cv.Mat();

  try {
    // Convert to grayscale
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

    // Threshold using Otsu's method (auto-detects optimal threshold)
    // THRESH_BINARY_INV makes dark borders white, light content black
    cv.threshold(gray, binary, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

    // Morphological operations to connect gaps in imperfect borders
    // Larger kernel (7x7) helps connect gaps in newspaper-style borders
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));

    // Dilate to connect gaps
    cv.dilate(binary, processed, kernel, new cv.Point(-1, -1), 2);

    // Erode to refine borders back to reasonable thickness
    cv.erode(processed, processed, kernel, new cv.Point(-1, -1), 1);

    return { src, gray, binary, processed };
  } catch (e) {
    // Clean up on error
    src.delete();
    gray.delete();
    binary.delete();
    processed.delete();
    throw e;
  }
}
// Detect panels in a single image (not split)
function detectPanelsInImage(imageData, cv) {
  const { src, gray, binary, processed } = preprocessComicImage(imageData, cv);

  try {
    const imgWidth = imageData.width;
    const imgHeight = imageData.height;

    // Connected components analysis
    const labels = new cv.Mat();
    const stats = new cv.Mat();
    const centroids = new cv.Mat();

    const numComponents = cv.connectedComponentsWithStats(
      processed,
      labels,
      stats,
      centroids,
      8, // connectivity type (8 = all neighbors)
      cv.CV_32S,
    );

    const panels = [];
    const minArea = imgWidth * imgHeight * 0.05; // Minimum 5% of image area
    const minDimension = Math.min(imgWidth, imgHeight) * 0.15; // Minimum 15% of smallest dimension

    // Start from 1 to skip background component (label 0)
    for (let i = 1; i < numComponents; i++) {
      // Extract component statistics
      const x = stats.data32S[i * 5]; // CC_STAT_LEFT
      const y = stats.data32S[i * 5 + 1]; // CC_STAT_TOP
      const width = stats.data32S[i * 5 + 2]; // CC_STAT_WIDTH
      const height = stats.data32S[i * 5 + 3]; // CC_STAT_HEIGHT
      const area = stats.data32S[i * 5 + 4]; // CC_STAT_AREA

      // Skip if too small (likely noise, text, or speech bubbles)
      if (area < minArea) continue;

      // Skip if dimensions too small
      if (width < minDimension || height < minDimension) continue;

      // Check aspect ratio (comic panels are typically rectangular)
      const aspectRatio = width / height;
      if (aspectRatio < 0.3 || aspectRatio > 5) continue;

      // Convert to percentages
      panels.push({
        id: `opencv-${i}`,
        x: (x / imgWidth) * 100,
        y: (y / imgHeight) * 100,
        width: (width / imgWidth) * 100,
        height: (height / imgHeight) * 100,
        reading_order: panels.length,
      });
    }

    // Clean up
    labels.delete();
    stats.delete();
    centroids.delete();

    return panels;
  } finally {
    src.delete();
    gray.delete();
    binary.delete();
    processed.delete();
  }
}
// Main detection function with 2-page spread handling
export async function detectPanelsOpenCV(imageData, cv) {
  const imgWidth = imageData.width;
  const imgHeight = imageData.height;
  const aspectRatio = imgWidth / imgHeight;

  console.log(
    `[OpenCV] Processing ${imgWidth}x${imgHeight}px image (aspect ratio: ${aspectRatio.toFixed(2)})`,
  );

  // Detect if this is a 2-page spread (aspect ratio > 1.3 suggests two pages)
  if (aspectRatio > 1.3) {
    console.log("[OpenCV] Detected 2-page spread, splitting for processing");

    const halfWidth = Math.floor(imgWidth / 2);

    // Split into left and right pages
    const leftData = extractImageDataRegion(
      imageData,
      0,
      0,
      halfWidth,
      imgHeight,
    );
    const rightData = extractImageDataRegion(
      imageData,
      halfWidth,
      0,
      imgWidth - halfWidth,
      imgHeight,
    );

    try {
      const leftPanels = detectPanelsInImage(leftData, cv);
      const rightPanels = detectPanelsInImage(rightData, cv);

      console.log(
        `[OpenCV] Left page: ${leftPanels.length} panels, Right page: ${rightPanels.length} panels`,
      );

      // Adjust right panel coordinates (they're relative to right half)
      const adjustedRightPanels = rightPanels.map((panel) => ({
        ...panel,
        x: 50 + panel.x / 2, // Map 0-100% of right half to 50-100% of full width
        width: panel.width / 2,
        id: `opencv-right-${panel.id}`,
      }));

      // Combine panels
      const allPanels = [...leftPanels, ...adjustedRightPanels];

      console.log(`[OpenCV] Total detected panels: ${allPanels.length}`);

      // Sort by reading order (left-to-right, top-to-bottom)
      allPanels.sort((a, b) => {
        const rowA = Math.floor(a.y / 20);
        const rowB = Math.floor(b.y / 20);
        if (rowA !== rowB) return rowA - rowB;
        return a.x - b.x;
      });

      // Reassign reading_order
      return allPanels.map((p, i) => ({ ...p, reading_order: i }));
    } finally {
      // Clean up image data regions
      // (ImageData doesn't need explicit cleanup like OpenCV Mats)
    }
  }

  // Single page processing
  const panels = detectPanelsInImage(imageData, cv);

  console.log(`[OpenCV] Detected ${panels.length} panels in single page`);

  // Sort by reading order
  panels.sort((a, b) => {
    const rowA = Math.floor(a.y / 20);
    const rowB = Math.floor(b.y / 20);
    if (rowA !== rowB) return rowA - rowB;
    return a.x - b.x;
  });

  return panels.map((p, i) => ({ ...p, reading_order: i }));
}
