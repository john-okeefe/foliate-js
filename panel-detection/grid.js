// panel-detection/grid.js
// Grid-based panel detection (lightweight fallback)
export function detectPanelsGrid(imageData, rows = 3, cols = 3) {
  const panels = [];
  const cellWidth = imageData.width / cols;
  const cellHeight = imageData.height / rows;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const startX = Math.floor(x * cellWidth);
      const startY = Math.floor(y * cellHeight);
      const cellData = extractCell(
        imageData,
        startX,
        startY,
        cellWidth,
        cellHeight,
      );

      if (!isEmpty(cellData)) {
        panels.push({
          id: `grid-${panels.length}`,
          x: (x / cols) * 100,
          y: (y / rows) * 100,
          width: (1 / cols) * 100,
          height: (1 / rows) * 100,
          reading_order: panels.length,
        });
      }
    }
  }

  return mergeAdjacentPanels(panels);
}
function extractCell(imageData, startX, startY, width, height) {
  const w = Math.floor(width);
  const h = Math.floor(height);
  const cellData = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = ((startY + y) * imageData.width + (startX + x)) * 4;
      const destIdx = (y * w + x) * 4;
      cellData[destIdx] = imageData.data[srcIdx];
      cellData[destIdx + 1] = imageData.data[srcIdx + 1];
      cellData[destIdx + 2] = imageData.data[srcIdx + 2];
      cellData[destIdx + 3] = imageData.data[srcIdx + 3];
    }
  }

  return { data: cellData, width: w, height: h };
}
function isEmpty(cellData) {
  let emptyPixels = 0;
  const totalPixels = cellData.width * cellData.height;

  for (let i = 3; i < cellData.data.length; i += 4) {
    if (cellData.data[i] < 10) emptyPixels++;
  }

  return emptyPixels / totalPixels > 0.95;
}
function mergeAdjacentPanels(panels) {
  const merged = [];
  const used = new Set();

  for (let i = 0; i < panels.length; i++) {
    if (used.has(i)) continue;

    let current = { ...panels[i] };
    used.add(i);

    let changed = true;
    while (changed) {
      changed = false;
      for (let j = i + 1; j < panels.length; j++) {
        if (used.has(j)) continue;
        if (isAdjacent(current, panels[j])) {
          current = mergePanels(current, panels[j]);
          used.add(j);
          changed = true;
        }
      }
    }
    console.log("[Grid] Merged to", merged.length, "panels");
    merged.push(current);
  }

  return merged;
}
function isAdjacent(p1, p2) {
  const tolerance = 5;
  if (
    Math.abs(p1.y - p2.y) < tolerance &&
    Math.abs(p1.height - p2.height) < tolerance
  ) {
    return (
      Math.abs(p1.x + p1.width - p2.x) < tolerance ||
      Math.abs(p2.x + p2.width - p1.x) < tolerance
    );
  }
  if (
    Math.abs(p1.x - p2.x) < tolerance &&
    Math.abs(p1.width - p2.width) < tolerance
  ) {
    return (
      Math.abs(p1.y + p1.height - p2.y) < tolerance ||
      Math.abs(p2.y + p2.height - p1.y) < tolerance
    );
  }
  return false;
}
function mergePanels(p1, p2) {
  const minX = Math.min(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxX = Math.max(p1.x + p1.width, p2.x + p2.width);
  const maxY = Math.max(p1.y + p1.height, p2.y + p2.height);

  return {
    id: p1.id,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    reading_order: Math.min(p1.reading_order, p2.reading_order),
  };
}
