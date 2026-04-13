// panel-detection/coco-ssd.js
// ML-based panel detection using COCO-SSD
export async function detectPanelsML(imageData, model) {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);

  const predictions = await model.detect(canvas);

  const panels = [];
  const imgWidth = imageData.width;
  const imgHeight = imageData.height;

  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i];
    const [x, y, w, h] = pred.bbox;
    const aspectRatio = w / h;

    const isRectangular =
      aspectRatio > 0.3 &&
      aspectRatio < 5 &&
      w > imgWidth * 0.05 &&
      h > imgHeight * 0.05;

    if (isRectangular) {
      panels.push({
        id: `ml-${i}`,
        x: (x / imgWidth) * 100,
        y: (y / imgHeight) * 100,
        width: (w / imgWidth) * 100,
        height: (h / imgHeight) * 100,
        reading_order: i,
      });
    }
  }

  panels.sort((a, b) => {
    const rowA = Math.floor(a.y / 20);
    const rowB = Math.floor(b.y / 20);
    if (rowA !== rowB) return rowA - rowB;
    return a.x - b.x;
  });

  return panels.map((p, i) => ({ ...p, reading_order: i }));
}
