/**
 * Deep HTML Style Extractor for Draw.io cell values
 * Extracts real font size (> 2px), colors, font family and bold/italic flags
 * before cleaning HTML tags.
 */

export interface ExtractedHtmlStyles {
  fontSizePx?: number;
  fontSizePt?: number;
  fontColor?: string;
  fontFamily?: string;
  isBold?: boolean;
  isItalic?: boolean;
  fontStyle?: number; // 0=normal, 1=bold, 2=italic, 3=bold+italic
}

export function rgbToHex(colorStr: string): string {
  if (!colorStr) return '';
  const trimmed = colorStr.trim();
  if (trimmed.startsWith('#')) {
    if (trimmed.length === 4) {
      // #rgb -> #rrggbb
      const r = trimmed[1];
      const g = trimmed[2];
      const b = trimmed[3];
      return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
    return trimmed.toUpperCase();
  }

  const match = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (match) {
    const r = parseInt(match[1], 10).toString(16).padStart(2, '0');
    const g = parseInt(match[2], 10).toString(16).padStart(2, '0');
    const b = parseInt(match[3], 10).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`.toUpperCase();
  }

  // Common named colors fallback
  const namedColors: Record<string, string> = {
    black: '#000000',
    white: '#FFFFFF',
    red: '#FF0000',
    green: '#008000',
    blue: '#0000FF',
    yellow: '#FFFF00',
    gray: '#808080',
    grey: '#808080',
  };
  if (namedColors[trimmed.toLowerCase()]) {
    return namedColors[trimmed.toLowerCase()];
  }

  return trimmed;
}

/**
 * Extracts typography and colors from raw HTML strings in draw.io values.
 */
export function extractHtmlStyles(html: string): ExtractedHtmlStyles {
  const result: ExtractedHtmlStyles = {};
  if (!html || !html.includes('<')) {
    return result;
  }

  // 1. Try DOMParser if available
  let domSuccess = false;
  try {
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      // In browser, text/html parses fragments very forgivingly
      const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
      const doc = parser.parseFromString(
        isBrowser ? `<body>${html}</body>` : `<root>${html.replace(/<br\s*\/?>/gi, '<br/>')}</root>`,
        isBrowser ? 'text/html' : 'application/xml'
      );

      const allElements = doc.querySelectorAll ? Array.from(doc.querySelectorAll('*')) : Array.from(doc.getElementsByTagName('*'));

      for (const el of allElements) {
        // Tag-based bold / italic
        const tag = el.tagName.toLowerCase();
        if (tag === 'b' || tag === 'strong') result.isBold = true;
        if (tag === 'i' || tag === 'em') result.isItalic = true;

        // <font color="..." face="..." size="...">
        if (el.hasAttribute('color')) {
          const c = el.getAttribute('color') || '';
          if (c) result.fontColor = rgbToHex(c);
        }
        if (el.hasAttribute('face')) {
          const f = el.getAttribute('face') || '';
          if (f) result.fontFamily = f.replace(/['"]/g, '').trim();
        }

        // Parse style attribute
        const styleAttr = el.getAttribute('style');
        if (styleAttr) {
          // font-size: ignore 1px / <= 2px container wrappers
          const sizeMatch = styleAttr.match(/font-size:\s*([\d.]+)(px|pt)?/i);
          if (sizeMatch) {
            const val = parseFloat(sizeMatch[1]);
            const unit = (sizeMatch[2] || 'px').toLowerCase();
            const pxVal = unit === 'pt' ? val / 0.75 : val;

            if (pxVal > 2) {
              result.fontSizePx = pxVal;
              result.fontSizePt = pxVal * 0.75;
            }
          }

          // color: rgb(...) or #...
          const colorMatch = styleAttr.match(/color:\s*([^;]+)/i);
          if (colorMatch) {
            const c = colorMatch[1].trim();
            if (c) result.fontColor = rgbToHex(c);
          }

          // font-family: ...
          const familyMatch = styleAttr.match(/font-family:\s*([^;]+)/i);
          if (familyMatch) {
            result.fontFamily = familyMatch[1].replace(/['"]/g, '').trim();
          }

          // font-weight: bold
          if (/font-weight:\s*(bold|[6-9]00)/i.test(styleAttr)) {
            result.isBold = true;
          }

          // font-style: italic
          if (/font-style:\s*italic/i.test(styleAttr)) {
            result.isItalic = true;
          }
        }
      }

      domSuccess = true;
    }
  } catch {
    domSuccess = false;
  }

  // 2. Regex fallback if DOMParser missed anything or failed
  if (!domSuccess || !result.fontSizePx) {
    // Search for all font-size matches and pick the innermost (> 2px)
    const fontSizeRegex = /font-size:\s*([\d.]+)(px|pt)?/gi;
    let match: RegExpExecArray | null;
    while ((match = fontSizeRegex.exec(html)) !== null) {
      const val = parseFloat(match[1]);
      const unit = (match[2] || 'px').toLowerCase();
      const pxVal = unit === 'pt' ? val / 0.75 : val;
      if (pxVal > 2) {
        result.fontSizePx = pxVal;
        result.fontSizePt = pxVal * 0.75;
      }
    }
  }

  if (!result.fontColor) {
    const colorMatch = html.match(/color:\s*(rgb\([^)]+\)|#[0-9a-fA-F]{3,6}|[a-zA-Z]+)/i) ||
      html.match(/<font[^>]*color=["']?([^"'>\s]+)/i);
    if (colorMatch) {
      result.fontColor = rgbToHex(colorMatch[1]);
    }
  }

  if (!result.fontFamily) {
    const familyMatch = html.match(/font-family:\s*([^;"'>]+)/i) ||
      html.match(/<font[^>]*face=["']?([^"'>]+)/i);
    if (familyMatch) {
      result.fontFamily = familyMatch[1].replace(/['"]/g, '').trim();
    }
  }

  if (html.includes('<b>') || html.includes('<strong>') || /font-weight:\s*(bold|[6-9]00)/i.test(html)) {
    result.isBold = true;
  }
  if (html.includes('<i>') || html.includes('<em>') || /font-style:\s*italic/i.test(html)) {
    result.isItalic = true;
  }

  // Calculate bitwise fontStyle for Visio (0=normal, 1=bold, 2=italic, 3=bold+italic)
  let styleBit = 0;
  if (result.isBold) styleBit |= 1;
  if (result.isItalic) styleBit |= 2;
  result.fontStyle = styleBit;

  return result;
}

