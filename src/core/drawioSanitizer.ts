import pako from 'pako';
import {
  ConversionOptions,
  DiagnosticReport,
  DrawioPage,
  DrawioParsedCell,
  DrawioCellGeometry
} from '../types';
import {
  parseXml,
  serializeXml,
  getParserError,
  findFirstElementByTag,
  findElementsByTag
} from './xmlUtils';
import { extractHtmlStyles } from './htmlStyleExtractor';
import { decodeStencilBase64, parseStencilXml } from './stencilParser';

/**
 * Decodes a Draw.io compressed diagram string:
 * Base64 -> Raw Deflate Inflation -> decodeURIComponent
 */
export function decompressDiagram(data: string): string {
  const trimmed = data.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('<') && trimmed.includes('<mxGraphModel')) {
    return trimmed;
  }

  try {
    const binaryString = atob(trimmed);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const decompressed = pako.inflateRaw(bytes, { to: 'string' });
    return decodeURIComponent(decompressed);
  } catch {
    try {
      return decodeURIComponent(atob(trimmed));
    } catch {
      return trimmed;
    }
  }
}

/**
 * Compresses an XML diagram string into Draw.io's format:
 * encodeURIComponent -> Raw Deflate -> Base64
 */
export function compressDiagram(xml: string): string {
  const uriEncoded = encodeURIComponent(xml);
  const deflated = pako.deflateRaw(uriEncoded);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < deflated.length; i += chunkSize) {
    const chunk = deflated.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Strips HTML formatting after styles have been rescued.
 * Replaces <br> / </div> / </p> with real \n and decodes HTML entities.
 * Removes trailing newlines to prevent CAD title blocks from shifting text up.
 */
export function cleanHtmlText(rawText: string): {
  cleaned: string;
  tagsRemoved: number;
  trailingNewlinesRemoved: number;
} {
  if (!rawText) return { cleaned: '', tagsRemoved: 0, trailingNewlinesRemoved: 0 };

  let tagsCount = 0;
  const tagMatches = rawText.match(/<\/?[a-z][^>]*>/gi);
  if (tagMatches) {
    tagsCount = tagMatches.length;
  }

  // 1. Line breaks
  let text = rawText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n');

  // 2. Strip remaining tags
  text = text.replace(/<[^>]*>/g, '');

  // 3. Decode entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));

  // 4. Normalize multiple newlines and carriage returns
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 5. Remove trailing newlines (critical for CAD title block text boxes)
  const beforeTrailing = text;
  text = text.replace(/\n+$/, '');
  const trailingNewlinesRemoved = beforeTrailing.length - text.length;

  return { cleaned: text, tagsRemoved: tagsCount, trailingNewlinesRemoved };
}

/**
 * Parses style string into key-value map, safely preserving data URIs
 * both with and without ';base64'.
 */
export function parseStyleString(styleStr: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!styleStr) return map;

  // Protect data URIs (e.g. image=data:image/png,... or image=data:image/png;base64,...)
  const dataUris: string[] = [];
  const sanitized = styleStr.replace(/data:image\/[a-zA-Z0-9+]+(?:;base64)?,[^;]+/gi, (m) => {
    dataUris.push(m);
    return `__DATA_URI_${dataUris.length - 1}__`;
  });

  const parts = sanitized.split(';').map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx !== -1) {
      const k = part.substring(0, eqIdx).trim();
      let v = part.substring(eqIdx + 1).trim();
      v = v.replace(/__DATA_URI_(\d+)__/g, (_, idx) => dataUris[parseInt(idx, 10)]);
      map[k] = v;
    } else {
      map[part] = '1';
    }
  }
  return map;
}

/**
 * Serializes key-value map back into Draw.io style string.
 */
export function serializeStyleString(styleMap: Record<string, string>): string {
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(styleMap)) {
    if (v === '1' && ['rounded', 'shadow', 'comic', 'glass', 'dashed', 'image'].includes(k)) {
      pairs.push(k);
    } else {
      pairs.push(`${k}=${v}`);
    }
  }
  return pairs.join(';') + (pairs.length > 0 ? ';' : '');
}

/**
 * Normalizes style attribute:
 * Sets html=0, eliminates negative margins, and replaces overflow=width with whiteSpace=wrap.
 */
export function sanitizeStyle(styleStr: string, options: ConversionOptions): {
  style: string;
  negativeMarginsFixed: number;
} {
  const styleMap = parseStyleString(styleStr);
  let negativeMarginsFixed = 0;

  if (options.cleanHtml || options.rescueHtmlStyles) {
    styleMap['html'] = '0';
  }

  if (options.adjustTextBoxesAndRotations) {
    // Ensure clean spacing without negative bounds
    for (const key of ['spacingTop', 'spacingBottom', 'spacingLeft', 'spacingRight', 'spacing']) {
      if (styleMap[key] !== undefined) {
        const val = parseFloat(styleMap[key]);
        if (val < 0) {
          styleMap[key] = '0';
          negativeMarginsFixed++;
        }
      }
    }

    // Replace overflow=width with whiteSpace=wrap
    if (styleMap['overflow'] === 'width' || styleMap['overflow'] === 'fill') {
      delete styleMap['overflow'];
      styleMap['whiteSpace'] = 'wrap';
    }
  }

  return {
    style: serializeStyleString(styleMap),
    negativeMarginsFixed
  };
}

/**
 * Main sanitizer for .drawio or .xml file content.
 */
export function sanitizeDrawio(
  xmlContent: string,
  options: ConversionOptions
): {
  sanitizedXml: string;
  report: Partial<DiagnosticReport>;
  pages: DrawioPage[];
} {
  const xmlDoc = parseXml(xmlContent);

  const errorMsg = getParserError(xmlDoc);
  if (errorMsg) {
    throw new Error(`Error de sintaxis XML en el archivo: ${errorMsg.slice(0, 200)}`);
  }

  let totalPagesDecompressed = 0;
  let totalHtmlTagsRemoved = 0;
  let totalHtmlStylesRescued = 0;
  let totalTrailingNewlinesRemoved = 0;
  let totalNegativeMarginsCleared = 0;
  let totalUserObjectsResolved = 0;
  let totalShapes = 0;
  let totalConnectors = 0;
  let totalStencilsDecoded = 0;
  let totalImagesEmbedded = 0;
  const warnings: string[] = [];
  const logs: string[] = [];
  const parsedPages: DrawioPage[] = [];

  const diagramNodes = findElementsByTag(xmlDoc, 'diagram');

  if (diagramNodes.length > 0) {
    logs.push(`Encontradas ${diagramNodes.length} página(s) en estructura <mxfile>.`);

    for (let i = 0; i < diagramNodes.length; i++) {
      const diagram = diagramNodes[i];
      const pageId = diagram.getAttribute('id') || `page-${i + 1}`;
      const pageName = diagram.getAttribute('name') || `Página ${i + 1}`;

      let graphModelXml = '';
      const rawDiagramText = (diagram.textContent || '').trim();
      const modelNode = findFirstElementByTag(diagram, 'mxGraphModel');

      if (modelNode) {
        graphModelXml = serializeXml(modelNode);
      } else {
        graphModelXml = decompressDiagram(rawDiagramText);
        if (graphModelXml) {
          totalPagesDecompressed++;
        }
      }

      if (!graphModelXml) {
        warnings.push(`Página "${pageName}" está vacía o no pudo descomprimirse.`);
        continue;
      }

      const modelDoc = parseXml(graphModelXml);
      const processResult = processModelDocument(modelDoc, pageId, pageName, options);

      totalHtmlTagsRemoved += processResult.htmlTagsRemoved;
      totalHtmlStylesRescued += processResult.htmlStylesRescued;
      totalTrailingNewlinesRemoved += processResult.trailingNewlinesRemoved;
      totalNegativeMarginsCleared += processResult.negativeMarginsCleared;
      totalUserObjectsResolved += processResult.userObjectsResolved;
      totalShapes += processResult.shapesCount;
      totalConnectors += processResult.connectorsCount;
      totalStencilsDecoded += processResult.stencilsDecoded;
      totalImagesEmbedded += processResult.imagesEmbedded;
      parsedPages.push(processResult.page);

      // Replace diagram content with plain uncompressed <mxGraphModel>
      while (diagram.firstChild) {
        diagram.removeChild(diagram.firstChild);
      }
      try {
        const importedModel = xmlDoc.importNode
          ? xmlDoc.importNode(modelDoc.documentElement, true)
          : modelDoc.documentElement.cloneNode(true);
        diagram.appendChild(importedModel);
      } catch {
        const tempDoc = parseXml(`<wrap>${serializeXml(modelDoc.documentElement)}</wrap>`);
        diagram.appendChild(tempDoc.documentElement.firstChild!);
      }
    }
  } else if (findFirstElementByTag(xmlDoc, 'mxGraphModel')) {
    logs.push('Archivo en formato directo <mxGraphModel>.');
    const processResult = processModelDocument(xmlDoc, 'page-1', 'Página 1', options);

    totalHtmlTagsRemoved += processResult.htmlTagsRemoved;
    totalHtmlStylesRescued += processResult.htmlStylesRescued;
    totalTrailingNewlinesRemoved += processResult.trailingNewlinesRemoved;
    totalNegativeMarginsCleared += processResult.negativeMarginsCleared;
    totalUserObjectsResolved += processResult.userObjectsResolved;
    totalShapes += processResult.shapesCount;
    totalConnectors += processResult.connectorsCount;
    totalStencilsDecoded += processResult.stencilsDecoded;
    totalImagesEmbedded += processResult.imagesEmbedded;
    parsedPages.push(processResult.page);
  } else {
    throw new Error('El archivo no contiene un formato de diagrama draw.io válido (<mxfile> o <mxGraphModel>).');
  }

  const sanitizedXml = serializeXml(xmlDoc);

  logs.push(
    `Pre-limpieza CAD Fase 1 completada: ${parsedPages.length} páginas (${totalPagesDecompressed} descomprimidas), ${totalShapes} formas, ${totalConnectors} conectores, ${totalUserObjectsResolved} UserObjects preservados, ${totalHtmlStylesRescued} estilos tipográficos rescatados, ${totalNegativeMarginsCleared} márgenes corregidos.`
  );

  return {
    sanitizedXml,
    report: {
      pagesCount: parsedPages.length,
      pagesDecompressed: totalPagesDecompressed,
      userObjectsResolved: totalUserObjectsResolved,
      htmlStylesRescued: totalHtmlStylesRescued,
      htmlTagsRemoved: totalHtmlTagsRemoved,
      trailingNewlinesRemoved: totalTrailingNewlinesRemoved,
      negativeMarginsCleared: totalNegativeMarginsCleared,
      shapesCount: totalShapes,
      connectorsCount: totalConnectors,
      stencilsDecoded: totalStencilsDecoded,
      imagesEmbedded: totalImagesEmbedded,
      warnings,
      logs
    },
    pages: parsedPages
  };
}

/**
 * Processes an individual mxGraphModel document:
 * Resolves <UserObject>/<object> wrappers, rescues inner HTML styles,
 * cleans tags, and normalizes cell properties.
 */
function processModelDocument(
  doc: Document,
  pageId: string,
  pageName: string,
  options: ConversionOptions
): {
  page: DrawioPage;
  htmlTagsRemoved: number;
  htmlStylesRescued: number;
  trailingNewlinesRemoved: number;
  negativeMarginsCleared: number;
  userObjectsResolved: number;
  shapesCount: number;
  connectorsCount: number;
  stencilsDecoded: number;
  imagesEmbedded: number;
} {
  let htmlTagsRemoved = 0;
  let htmlStylesRescued = 0;
  let trailingNewlinesRemoved = 0;
  let negativeMarginsCleared = 0;
  let userObjectsResolved = 0;
  let shapesCount = 0;
  let connectorsCount = 0;
  let stencilsDecoded = 0;
  let imagesEmbedded = 0;

  const modelNode = findFirstElementByTag(doc, 'mxGraphModel');
  const pageWidth = modelNode ? parseFloat(modelNode.getAttribute('pageWidth') || '1169') : 1169;
  const pageHeight = modelNode ? parseFloat(modelNode.getAttribute('pageHeight') || '827') : 827;

  const cellsMap: Map<string, DrawioParsedCell> = new Map();

  // Find all elements inside <root>
  const rootNode = findFirstElementByTag(doc, 'root') || doc.documentElement;
  const childNodes = Array.from(rootNode.childNodes).filter(n => n.nodeType === 1) as Element[];

  for (const node of childNodes) {
    const tagName = node.tagName.toLowerCase();

    let cellEl: Element | null = null;
    let cellId = '';
    let cellValue = '';

    if (tagName === 'userobject' || tagName === 'object') {
      userObjectsResolved++;
      cellId = node.getAttribute('id') || '';
      cellValue = node.getAttribute('label') || '';

      cellEl = findFirstElementByTag(node, 'mxCell');
      if (cellEl) {
        if (!cellEl.getAttribute('id') && cellId) {
          cellEl.setAttribute('id', cellId);
        } else if (cellEl.getAttribute('id')) {
          cellId = cellEl.getAttribute('id')!;
        }

        if (!cellEl.getAttribute('value') && cellValue) {
          cellEl.setAttribute('value', cellValue);
        } else if (cellEl.getAttribute('value')) {
          cellValue = cellEl.getAttribute('value')!;
        }
      }
    } else if (tagName === 'mxcell') {
      cellEl = node;
      cellId = cellEl.getAttribute('id') || '';
      cellValue = cellEl.getAttribute('value') || '';
    }

    if (!cellEl || !cellId || cellId === '0' || cellId === '1') {
      continue;
    }

    // Deep HTML Style Extractor before cleaning HTML
    let extractedStyles = extractHtmlStyles(cellValue);
    if (extractedStyles.fontSizePt || extractedStyles.fontColor || extractedStyles.fontFamily || (extractedStyles.fontStyle && extractedStyles.fontStyle > 0)) {
      htmlStylesRescued++;
    }

    // Clean HTML tags and decode entities
    if (options.cleanHtml || options.rescueHtmlStyles) {
      const cleanRes = cleanHtmlText(cellValue);
      htmlTagsRemoved += cleanRes.tagsRemoved;
      trailingNewlinesRemoved += cleanRes.trailingNewlinesRemoved;
      cellValue = cleanRes.cleaned;
      cellEl.setAttribute('value', cellValue);
      if (node !== cellEl && node.hasAttribute('label')) {
        node.setAttribute('label', cellValue);
      }
    }

    const rawStyle = cellEl.getAttribute('style') || '';
    const parsedStyle = parseStyleString(rawStyle);

    // Apply rescued styles into cell parsedStyle (deep typography rescue)
    if (extractedStyles.fontSizePx && extractedStyles.fontSizePx > 2) {
      parsedStyle['fontSize'] = extractedStyles.fontSizePx.toString();
    }
    if (extractedStyles.fontColor) {
      parsedStyle['fontColor'] = extractedStyles.fontColor;
    }
    if (extractedStyles.fontFamily) {
      parsedStyle['fontFamily'] = extractedStyles.fontFamily;
    }
    if (extractedStyles.fontStyle && extractedStyles.fontStyle > 0) {
      parsedStyle['fontStyle'] = extractedStyles.fontStyle.toString();
    }

    const sanitizedStyleResult = sanitizeStyle(serializeStyleString(parsedStyle), options);
    negativeMarginsCleared += sanitizedStyleResult.negativeMarginsFixed;
    const style = sanitizedStyleResult.style;
    cellEl.setAttribute('style', style);

    const isVertex = cellEl.getAttribute('vertex') === '1';
    const isEdge = cellEl.getAttribute('edge') === '1';

    if (isVertex) shapesCount++;
    if (isEdge) connectorsCount++;

    const parent = cellEl.getAttribute('parent') || undefined;
    const source = cellEl.getAttribute('source') || undefined;
    const target = cellEl.getAttribute('target') || undefined;

    // Parse geometry
    let geometry: DrawioCellGeometry | undefined = undefined;
    const geoNode = findFirstElementByTag(cellEl, 'mxGeometry');
    if (geoNode) {
      const x = parseFloat(geoNode.getAttribute('x') || '0');
      const y = parseFloat(geoNode.getAttribute('y') || '0');
      const width = parseFloat(geoNode.getAttribute('width') || '0');
      const height = parseFloat(geoNode.getAttribute('height') || '0');
      const as = geoNode.getAttribute('as') || undefined;
      const relative = geoNode.getAttribute('relative') === '1';

      const points: Array<{ x: number; y: number }> = [];
      const ptNodes = findElementsByTag(geoNode, 'mxPoint');
      let srcPt: { x: number; y: number } | undefined = undefined;
      let tgtPt: { x: number; y: number } | undefined = undefined;

      for (const pt of ptNodes) {
        const ptAs = pt.getAttribute('as');
        const px = parseFloat(pt.getAttribute('x') || '0');
        const py = parseFloat(pt.getAttribute('y') || '0');

        if (ptAs === 'sourcePoint') {
          srcPt = { x: px, y: py };
        } else if (ptAs === 'targetPoint') {
          tgtPt = { x: px, y: py };
        } else {
          points.push({ x: px, y: py });
        }
      }

      geometry = {
        x,
        y,
        width,
        height,
        as,
        relative,
        points: points.length > 0 ? points : undefined,
        sourcePoint: srcPt,
        targetPoint: tgtPt,
      };
    }

    // Rotation & Flips
    const rotation = parsedStyle['rotation'] ? parseFloat(parsedStyle['rotation']) : 0;
    const flipH = parsedStyle['flipH'] === '1';
    const flipV = parsedStyle['flipV'] === '1';

    // Connection anchors
    const exitX = parsedStyle['exitX'] ? parseFloat(parsedStyle['exitX']) : undefined;
    const exitY = parsedStyle['exitY'] ? parseFloat(parsedStyle['exitY']) : undefined;
    const entryX = parsedStyle['entryX'] ? parseFloat(parsedStyle['entryX']) : undefined;
    const entryY = parsedStyle['entryY'] ? parseFloat(parsedStyle['entryY']) : undefined;

    // Check thin lines (title block lines, width <= 2 or height <= 2)
    const isThinLine = isVertex && !!geometry && (geometry.width <= 2 || geometry.height <= 2);

    // Stencil detection (shape=stencil(base64))
    let isStencil = false;
    let stencilDef = undefined;
    const stencilMatch = rawStyle.match(/shape=stencil\(([^)]+)\)/i);
    if (stencilMatch && options.convertStencilsAndImages) {
      const decodedXml = decodeStencilBase64(stencilMatch[1]);
      if (decodedXml) {
        const parsed = parseStencilXml(decodedXml);
        if (parsed) {
          isStencil = true;
          stencilDef = parsed;
          stencilsDecoded++;
        }
      }
    }

    // Base64 image detection: accepts image=data:image/png,... and image=data:image/png;base64,...
    let isBase64Image = false;
    let imageData = undefined;
    const imageRegex = /image=data:image\/(png|jpe?g|gif|bmp)(?:;base64)?,([^;]+)/i;
    const imageMatch = rawStyle.match(imageRegex) || (parsedStyle['image'] ? parsedStyle['image'].match(/data:image\/(png|jpe?g|gif|bmp)(?:;base64)?,([^;]+)/i) : null);

    if (imageMatch && options.convertStencilsAndImages) {
      const mimeSubtype = imageMatch[1].toLowerCase();
      const rawBase64 = imageMatch[2].replace(/[\s\r\n]+/g, '');
      const extension = mimeSubtype === 'jpeg' ? 'jpg' : mimeSubtype;
      isBase64Image = true;
      imageData = {
        mimeType: `image/${mimeSubtype}`,
        base64: rawBase64,
        extension
      };
      imagesEmbedded++;
    }

    cellsMap.set(cellId, {
      id: cellId,
      value: cellValue,
      style,
      parsedStyle,
      vertex: isVertex,
      edge: isEdge,
      parent,
      source,
      target,
      geometry,
      rotation,
      flipH,
      flipV,
      exitX,
      exitY,
      entryX,
      entryY,
      fontSizePt: extractedStyles.fontSizePt || (parsedStyle['fontSize'] ? parseFloat(parsedStyle['fontSize']) * 0.75 : undefined),
      fontColor: extractedStyles.fontColor || parsedStyle['fontColor'],
      fontFamily: extractedStyles.fontFamily || parsedStyle['fontFamily'],
      fontStyle: extractedStyles.fontStyle,
      isThinLine,
      isStencil,
      stencilDef,
      isBase64Image,
      imageData
    });
  }

  return {
    page: {
      id: pageId,
      name: pageName,
      width: pageWidth,
      height: pageHeight,
      cells: Array.from(cellsMap.values()),
      xmlDoc: doc
    },
    htmlTagsRemoved,
    htmlStylesRescued,
    trailingNewlinesRemoved,
    negativeMarginsCleared,
    userObjectsResolved,
    shapesCount,
    connectorsCount,
    stencilsDecoded,
    imagesEmbedded
  };
}
