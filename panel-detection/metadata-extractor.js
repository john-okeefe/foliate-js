// panel-detection/metadata-extractor.js
// Extract panel coordinates from comic/manga metadata
/**
 * Extract panel regions from EPUB/HTML content
 * @param {Document} doc - The document object from iframe
 * @param {string} contentPath - Path to current content (for debugging)
 * @returns {Promise<Object>} Result with panels array and metadata
 */
export async function extractPanelMetadata(doc, contentPath) {
  console.log(`[Metadata Extraction] Extracting from: ${contentPath}`);

  // Try Kodansha linkhotspots first (inline CSS - easy)
  const linkhotspotPanels = extractLinkhotspots(doc);
  if (linkhotspotPanels.length > 0) {
    console.log(
      `[Metadata Extraction] Found ${linkhotspotPanels.length} Kodansha linkhotspots`,
    );
    return {
      panels: linkhotspotPanels,
      source: "kodansha-linkhotspots",
      confidence: 1.0,
      complete: true, // Metadata is complete
    };
  }
  // Try Amazon magnification regions (CSS-based - harder)
  const amazonPanels = await extractAmazonRegions(doc);
  if (amazonPanels.length > 0) {
    console.log(
      `[Metadata Extraction] Found ${amazonPanels.length} Amazon magnification regions`,
    );
    return {
      panels: amazonPanels,
      source: "amazon-magnify",
      confidence: 1.0,
      complete: true,
    };
  }
  console.log("[Metadata Extraction] No panel metadata found");
  return {
    panels: [],
    source: null,
    confidence: 0,
    complete: false,
  };
}
/**
 * Extract Kodansha-style linkhotspots with inline CSS coordinates
 * @param {Document} doc - Document object
 * @returns {Array} Array of panel objects
 */
function extractLinkhotspots(doc) {
  const linkhotspots = doc.querySelectorAll('.linkhotspot[style*="top"]');
  const panels = [];
  linkhotspots.forEach((hotspot, index) => {
    const style = hotspot.getAttribute("style");
    if (!style) return;
    const coords = parseInlineCSS(style);

    if (coords && coords.top !== undefined) {
      // Convert left/right to width, top/bottom to height
      const width = 100 - coords.left - coords.right;
      const height = 100 - coords.top - coords.bottom;

      panels.push({
        id: `metadata-linkhotspot-${index}`,
        x: coords.left,
        y: coords.top,
        width: width,
        height: height,
        reading_order: index,
        source: "kodansha-linkhotspot",
        confidence: 1.0,
      });
    }
  });
  return panels;
}
/**
 * Extract Amazon magnification regions using getBoundingClientRect()
 * @param {Document} doc - Document object
 * @returns {Promise<Array>} Array of panel objects
 */
async function extractAmazonRegions(doc) {
  // Find all magnify links
  const magnifyLinks = doc.querySelectorAll("a[data-app-amzn-magnify]");
  if (magnifyLinks.length === 0) return [];
  const panels = [];
  const processed = new Set();
  // Extract target IDs from data attributes
  magnifyLinks.forEach((link, index) => {
    try {
      const data = JSON.parse(link.getAttribute("data-app-amzn-magnify"));
      const targetId = data.targetId;

      if (processed.has(targetId)) return;
      processed.add(targetId);

      // Find the target div
      const targetDiv = doc.getElementById(targetId);
      if (!targetDiv) {
        console.warn(`[Metadata Extraction] Target not found: ${targetId}`);
        return;
      }
      // Get computed position
      const rect = targetDiv.getBoundingClientRect();
      const parentRect = targetDiv.parentElement?.getBoundingClientRect();

      console.log("[DEBUG] targetDiv:", targetDiv);
      console.log("[DEBUG] targetDiv classes:", targetDiv.className);
      console.log(
        "[DEBUG] targetDiv getBoundingClientRect:",
        targetDiv.getBoundingClientRect(),
      );

      if (!parentRect) {
        console.warn(`[Metadata Extraction] No parent rect for: ${targetId}`);
        return;
      }
      // Convert to percentages relative to parent
      const x = ((rect.left - parentRect.left) / parentRect.width) * 100;
      const y = ((rect.top - parentRect.top) / parentRect.height) * 100;
      const width = (rect.width / parentRect.width) * 100;
      const height = (rect.height / parentRect.height) * 100;
      panels.push({
        id: `metadata-amazon-${index}`,
        x,
        y,
        width,
        height,
        reading_order: index,
        source: "amazon-magnify",
        confidence: 1.0,
      });
    } catch (e) {
      console.error(`[Metadata Extraction] Failed to parse Amazon region:`, e);
    }
  });
  return panels;
}
/**
 * Parse inline CSS to extract coordinate percentages
 * @param {string} style - Inline CSS string
 * @returns {Object} Object with top, left, right, bottom
 */
function parseInlineCSS(style) {
  const coords = {};

  // Parse each property
  const properties = style.split(";").map((s) => s.trim());

  properties.forEach((prop) => {
    const [key, value] = prop.split(":").map((s) => s.trim());
    if (value && value.endsWith("%")) {
      coords[key] = parseFloat(value);
    }
  });
  return coords;
}
/**
 * Check if document has extractable metadata
 * @param {Document} doc - Document object
 * @returns {boolean} True if metadata is present
 */
export function hasMetadata(doc) {
  return (
    doc.querySelectorAll('.linkhotspot[style*="top"]').length > 0 ||
    doc.querySelectorAll("a[data-app-amzn-magnify]").length > 0
  );
}

/**
 * Extract Amazon regions by parsing CSS classes
 * @param {Document} doc - Document object
 * @returns {Array} Array of panel objects
 */
async function extractAmazonRegionsFromCSS(doc) {
  const panels = [];

  // Find all links that point to magnification targets
  const magnifyLinks = doc.querySelectorAll("a[data-app-amzn-magnify]");
  if (magnifyLinks.length === 0) return [];
  // Get all stylesheets
  const styleSheets = doc.styleSheets;
  const cssRules = {};
  // Build a map of class names to their computed styles
  for (const sheet of styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText && rule.selectorText.startsWith(".")) {
          const className = rule.selectorText.substring(1); // Remove '.'
          cssRules[className] = rule.style;
        }
      }
    } catch (e) {
      // CORS may block access to some stylesheets
      console.warn("[Metadata Extraction] Could not read stylesheet:", e);
    }
  }
  // For each magnify link, find the target div and extract coordinates
  const processed = new Set();
  for (const link of magnifyLinks) {
    try {
      const data = JSON.parse(link.getAttribute("data-app-amzn-magnify"));
      const targetId = data.targetId;
      if (processed.has(targetId)) continue;
      processed.add(targetId);
      // Find the target div
      const targetDiv = doc.getElementById(targetId);
      if (!targetDiv) continue;
      // Find the child img element
      const img = targetDiv.querySelector("img");
      if (!img) continue;
      // Get the class that defines the panel region
      // The panel region class is usually applied to a sibling or parent
      // Look for div elements with percentage-based positioning
      const siblings = targetDiv.parentElement?.querySelectorAll(
        'div[class*="calibre"]',
      );

      for (const sibling of siblings) {
        if (sibling.id === targetId) continue;

        const style = sibling.getAttribute("style") || sibling.className;

        // Try to extract coordinates from inline style or class
        if (style && typeof style === "string") {
          const coords = parseInlineCSS(style);

          if (coords && coords.top !== undefined) {
            // Found a panel region
            const width = 100 - (coords.left || 0) - (coords.right || 0);
            const height = 100 - (coords.top || 0) - (coords.bottom || 0);

            panels.push({
              id: `metadata-amazon-${panels.length}`,
              x: coords.left || 0,
              y: coords.top || 0,
              width: width || 100,
              height: height || 100,
              reading_order: panels.length,
              source: "amazon-magnify",
              confidence: 1.0,
            });
            break; // Use the first valid sibling
          }
        }
      }
    } catch (e) {
      console.error(`[Metadata Extraction] Failed to parse Amazon region:`, e);
    }
  }
  return panels;
}
