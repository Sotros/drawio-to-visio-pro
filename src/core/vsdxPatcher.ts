import JSZip from 'jszip';
import { ConversionOptions, DiagnosticReport } from '../types';
import {
  parseXml,
  serializeXml,
  getParserError,
  findElementsByTag,
  findFirstElementByTag,
  getDirectChildrenByTag,
  safeNum
} from './xmlUtils';

/**
 * Retrieves a Cell inside an element by checking direct children or nested rows.
 */
function getCell(element: Element, cellName: string): Element | null {
  // Direct child cell
  const directCells = getDirectChildrenByTag(element, 'Cell');
  const foundDirect = directCells.find(c => c.getAttribute('N') === cellName);
  if (foundDirect) return foundDirect;

  // Search inside sections
  const sections = getDirectChildrenByTag(element, 'Section');
  for (const sec of sections) {
    const secCells = getDirectChildrenByTag(sec, 'Cell');
    const inSec = secCells.find(c => c.getAttribute('N') === cellName);
    if (inSec) return inSec;

    // Check rows in section
    const rows = getDirectChildrenByTag(sec, 'Row');
    for (const r of rows) {
      const rowCells = getDirectChildrenByTag(r, 'Cell');
      const inRow = rowCells.find(c => c.getAttribute('N') === cellName);
      if (inRow) return inRow;
    }
  }

  return null;
}

/**
 * Sets or updates a direct child <Cell> inside <Shape>.
 */
function setOrUpdateDirectShapeCell(
  doc: Document,
  shape: Element,
  name: string,
  val: string,
  formula?: string,
  unit?: string
): Element {
  const directCells = getDirectChildrenByTag(shape, 'Cell');
  let cell = directCells.find(c => c.getAttribute('N') === name);

  if (cell) {
    cell.setAttribute('V', val);
    if (formula !== undefined) {
      cell.setAttribute('F', formula);
    }
    if (unit !== undefined) {
      cell.setAttribute('U', unit);
    }
  } else {
    const ns = shape.namespaceURI || 'http://schemas.microsoft.com/office/visio/2012/main';
    cell = doc.createElementNS(ns, 'Cell');
    cell.setAttribute('N', name);
    cell.setAttribute('V', val);
    if (formula !== undefined) {
      cell.setAttribute('F', formula);
    }
    if (unit !== undefined) {
      cell.setAttribute('U', unit);
    }
    shape.appendChild(cell);
  }

  return cell;
}

/**
 * STRICT XSD NORMALIZER:
 * Reorders all child nodes of <Shape> into the 3 mandatory OpenXML blocks:
 *   BLOQUE 1: ONLY <Cell> elements (direct children of Shape)
 *   BLOQUE 2: ONLY <Section> elements (Character, Paragraph, Geometry, etc.)
 *   BLOQUE 3: <Text> element ALWAYS AT THE VERY END OF <Shape>
 *
 * Removes illegal sections (<Section N="TextXForm">, <Section N="TextBlock">, <Section N="Text">, <Section N="Protection">).
 */
function reorderShapeChildrenStrict(shape: Element): void {
  const children = Array.from(shape.childNodes);

  const cells: Element[] = [];
  const sections: Element[] = [];
  let textNode: Element | null = null;
  const otherElements: Element[] = [];

  for (const node of children) {
    if (node.nodeType === 1) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'cell') {
        cells.push(el);
      } else if (tag === 'section') {
        const secName = el.getAttribute('N');
        // Discard illegal/obsolete sections that break Visio XSD
        if (secName === 'TextXForm' || secName === 'TextBlock' || secName === 'Text' || secName === 'Protection') {
          continue;
        }
        sections.push(el);
      } else if (tag === 'text') {
        textNode = el;
      } else {
        otherElements.push(el);
      }
    }
    // Detach from shape
    shape.removeChild(node);
  }

  // 1. BLOQUE 1: Todas las etiquetas <Cell> al inicio
  for (const c of cells) {
    shape.appendChild(c);
  }

  // 2. BLOQUE 2: Todas las etiquetas <Section>
  for (const s of sections) {
    shape.appendChild(s);
  }

  // 3. Otros elementos estructurales (ej. <Shapes> en grupos)
  for (const o of otherElements) {
    shape.appendChild(o);
  }

  // 4. BLOQUE 3: <Text> SIEMPRE AL FINAL
  if (textNode) {
    shape.appendChild(textNode);
  }
}

/**
 * Surgical VSDX Patcher - Architecture V4.0
 * Corrects misaligned text boxes and margins without EVER breaking Visio's XSD schema.
 *
 * 5 GOLDEN RULES IMPLEMENTED:
 * 1) Only visio/pages/page*.xml are touched; all other ZIP entries remain intact.
 * 2) Strict 'application/xml' DOM parsing and validation.
 * 3) NEVER create <Section N="TextXForm"> or <Section N="TextBlock"> (they don't exist in Visio XSD).
 * 4) All direct child <Cell> elements MUST precede <Section> and <Text>.
 * 5) 1D connectors (BeginX / EndX) are strictly skipped.
 */
export async function patchVsdx(
  vsdxData: ArrayBuffer | Uint8Array | Blob,
  options: ConversionOptions
): Promise<{
  patchedBlob: Blob;
  report: Partial<DiagnosticReport>;
}> {
  const zip = await JSZip.loadAsync(vsdxData);

  let totalPages = 0;
  let totalShapes = 0;
  let textBlocksFixed = 0;
  let shapesSkipped1D = 0;
  let invalidSectionsRemoved = 0;
  const logs: string[] = [];
  const warnings: string[] = [];

  // Find all page XML files: visio/pages/page*.xml
  const pageFiles: string[] = [];
  zip.forEach((relativePath) => {
    if (/^visio\/pages\/page\d+\.xml$/i.test(relativePath)) {
      pageFiles.push(relativePath);
    }
  });

  if (pageFiles.length === 0) {
    zip.forEach((relativePath) => {
      if (relativePath.includes('pages/page') && relativePath.endsWith('.xml')) {
        pageFiles.push(relativePath);
      }
    });
  }

  totalPages = pageFiles.length;
  logs.push(`Encontradas ${totalPages} página(s) para parcheo quirúrgico en el paquete .vsdx.`);

  for (const pagePath of pageFiles) {
    const pageXmlText = await zip.file(pagePath)!.async('string');
    const doc = parseXml(pageXmlText);

    const errorMsg = getParserError(doc);
    if (errorMsg) {
      warnings.push(`Error de análisis XML en ${pagePath}: ${errorMsg.slice(0, 100)}`);
      continue;
    }

    const shapes = findElementsByTag(doc, 'Shape');
    totalShapes += shapes.length;

    for (const shape of shapes) {
      // Rule 3: Count and strip illegal sections on ALL shapes
      const directSections = getDirectChildrenByTag(shape, 'Section');
      for (const sec of directSections) {
        const secName = sec.getAttribute('N');
        if (secName === 'TextXForm' || secName === 'TextBlock' || secName === 'Text' || secName === 'Protection') {
          invalidSectionsRemoved++;
        }
      }

      const directCells = getDirectChildrenByTag(shape, 'Cell');

      // Rule 5: PROHIBIDO inyectar TxtWidth/TxtHeight en conectores 1D (BeginX / EndX)
      const is1DConnector = (
        directCells.some(c => c.getAttribute('N') === 'BeginX' || c.getAttribute('N') === 'EndX') ||
        !!getCell(shape, 'BeginX') ||
        !!getCell(shape, 'EndX')
      );

      if (is1DConnector) {
        shapesSkipped1D++;
        reorderShapeChildrenStrict(shape);
        continue;
      }

      // Check if shape has own text content
      const textNode = findFirstElementByTag(shape, 'Text');
      const textContent = textNode ? (textNode.textContent || '').trim() : '';
      if (!textNode || !textContent) {
        reorderShapeChildrenStrict(shape);
        continue;
      }

      // Read numeric Width and Height (> 0)
      const widthCell = directCells.find(c => c.getAttribute('N') === 'Width') || getCell(shape, 'Width');
      const heightCell = directCells.find(c => c.getAttribute('N') === 'Height') || getCell(shape, 'Height');

      const widthVal = widthCell ? parseFloat(widthCell.getAttribute('V') || '') : NaN;
      const heightVal = heightCell ? parseFloat(heightCell.getAttribute('V') || '') : NaN;

      if (isNaN(widthVal) || isNaN(heightVal) || widthVal <= 0 || heightVal <= 0) {
        reorderShapeChildrenStrict(shape);
        continue;
      }

      // Rule 4 & Specification 2: Inject text cells in BLOQUE 1
      if (options.fixTextXForm || options.adjustTextBoxesAndRotations) {
        const halfW = widthVal * 0.5;
        const halfH = heightVal * 0.5;

        setOrUpdateDirectShapeCell(doc, shape, 'TxtPinX', safeNum(halfW), 'Width*0.5');
        setOrUpdateDirectShapeCell(doc, shape, 'TxtPinY', safeNum(halfH), 'Height*0.5');
        setOrUpdateDirectShapeCell(doc, shape, 'TxtWidth', safeNum(widthVal, 0.01), 'Width*1');
        setOrUpdateDirectShapeCell(doc, shape, 'TxtHeight', safeNum(heightVal, 0.01), 'Height*1');
        setOrUpdateDirectShapeCell(doc, shape, 'TxtLocPinX', safeNum(halfW), 'TxtWidth*0.5');
        setOrUpdateDirectShapeCell(doc, shape, 'TxtLocPinY', safeNum(halfH), 'TxtHeight*0.5');
        setOrUpdateDirectShapeCell(doc, shape, 'TxtAngle', '0');
        setOrUpdateDirectShapeCell(doc, shape, 'LeftMargin', '0');
        setOrUpdateDirectShapeCell(doc, shape, 'RightMargin', '0');
        setOrUpdateDirectShapeCell(doc, shape, 'TopMargin', '0');
        setOrUpdateDirectShapeCell(doc, shape, 'BottomMargin', '0');
        setOrUpdateDirectShapeCell(doc, shape, 'VerticalAlign', '1');
        setOrUpdateDirectShapeCell(doc, shape, 'LockTextEdit', '0');

        textBlocksFixed++;
      }

      // Small height handling (Height < 0.25 inches)
      if (heightVal < 0.25) {
        const paraSec = directSections.find(s => s.getAttribute('N') === 'Paragraph');
        if (paraSec) {
          const rows = getDirectChildrenByTag(paraSec, 'Row');
          for (const row of rows) {
            const rowCells = getDirectChildrenByTag(row, 'Cell');
            const horzCell = rowCells.find(c => c.getAttribute('N') === 'HorzAlign');
            if (!horzCell) {
              const ns = shape.namespaceURI || 'http://schemas.microsoft.com/office/visio/2012/main';
              const newCell = doc.createElementNS(ns, 'Cell');
              newCell.setAttribute('N', 'HorzAlign');
              newCell.setAttribute('V', '1'); // Centered
              row.appendChild(newCell);
            }
          }
        }
      }

      // Character font normalization (optional)
      if (options.normalizeFont && options.targetFontFamily) {
        const charSec = directSections.find(s => s.getAttribute('N') === 'Character');
        if (charSec) {
          const rows = getDirectChildrenByTag(charSec, 'Row');
          for (const row of rows) {
            const rowCells = getDirectChildrenByTag(row, 'Cell');
            let fontCell = rowCells.find(c => c.getAttribute('N') === 'Font');
            if (!fontCell) {
              const ns = shape.namespaceURI || 'http://schemas.microsoft.com/office/visio/2012/main';
              fontCell = doc.createElementNS(ns, 'Cell');
              fontCell.setAttribute('N', 'Font');
              row.appendChild(fontCell);
            }
            fontCell.setAttribute('V', options.targetFontFamily);
          }
        }
      }

      // Reorder all children of this shape into the strict 3-block sequence
      reorderShapeChildrenStrict(shape);
    }

    // Write back updated page XML into ZIP (preserving all other files intact)
    const modifiedXml = serializeXml(doc);
    zip.file(pagePath, modifiedXml);
  }

  logs.push(
    `Parcheo quirúrgico VSDX completado: ${textBlocksFixed} figuras 2D calibradas con precisión XSD, ${shapesSkipped1D} conectores 1D protegidos, ${invalidSectionsRemoved} secciones ilegales eliminadas.`
  );

  const patchedBlob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.ms-visio.drawing.main+xml',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  return {
    patchedBlob,
    report: {
      pagesCount: totalPages,
      shapesCount: totalShapes,
      textBlocksFixed,
      shapesSkipped1D,
      invalidSectionsRemoved,
      warnings,
      logs
    }
  };
}
