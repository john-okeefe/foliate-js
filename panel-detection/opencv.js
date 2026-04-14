// panel-detection/opencv.js
// OpenCV-based edge detection for panel boundaries
export async function detectPanelsOpenCV(imageData, cv) {
  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, 50, 150, 3, false);
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE,
    );

    const panels = [];
    const imgWidth = imageData.width;
    const imgHeight = imageData.height;

    for (let i = 0; i < contours.size(); i++) {
      const rect = cv.boundingRect(contours.get(i));
      const minSize = Math.min(imgWidth, imgHeight) * 0.08;
      const aspectRatio = rect.width / rect.height;

      if (rect.width < minSize || rect.height < minSize) continue;
      if (aspectRatio < 0.2 || aspectRatio > 8) continue;

      panels.push({
        id: `opencv-${i}`,
        x: (rect.x / imgWidth) * 100,
        y: (rect.y / imgHeight) * 100,
        width: (rect.width / imgWidth) * 100,
        height: (rect.height / imgHeight) * 100,
        reading_order: i,
      });
    }

    panels.sort((a, b) => {
      const rowA = Math.floor(a.y / 20);
      const rowB = Math.floor(b.y / 20);
      if (rowA !== rowB) return rowA - rowB;
      return a.x - b.x;
    });

    return panels.map((p, i) => ({ ...p, reading_order: i }));
  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}
