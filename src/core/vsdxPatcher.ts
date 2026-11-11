import JSZip from 'jszip';
import { ConversionOptions, DiagnosticReport } from '../types';
import {
  parseXml,
  serializeXml,
  getParserError,
  findElementsByTag,
  findFirstElementByTag,
  getDirectChildrenByTag
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
 * STRICT XSD RULE: In Visio OpenXML Schema, ALL direct child <Cell> elements
 * MUST appear BEFORE any <Section>, <Text>, <ForeignData>, or <Shapes> elements.
 * Inserting a <Cell> after <Text> or <Section> causes Visio to discard the page (blank page).
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

    // STRICT XSD ORDER: Insert BEFORE the first child node that is not a <Cell>
    const children = Array.from(shape.childNodes);
    const firstNonCell = children.find(
      n => n.nodeType === 1 && (n as Element).tagName.toLowerCase() !== 'cell'
    );

    if (firstNonCell) {
      shape.insertBefore(cell, firstNonCell);
    } else {
      shape.appendChild(cell);
    }
  }

  return cell;
}

/**
 * Surgical VSDX Patcher - Architecture V4.0
 * Corrects misaligned text boxes and margins without EVER breaking Visio's XSD schema.
 *
 * 5 GOLDEN RULES IMPLEMENTED:
 * 1) Only visio/pages/page*.xml are touched; all other ZIP entries remain intact.
 * 2) Strict 'application/xml' DOM parsing and validation.
 * 3) NEVER create <Section N="TextXForm"> or <Section N="TextBlock"> (they don't exist in Visio XSD).
 * 4) All direct child <Cell> elements MUST precede <Section>, <Text>, <ForeignData>, <Shapes>.
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
      // Rule 3: Clean up any illegal sections (<Section N="TextXForm">, <Section N="TextBlock">, <Section N="Text">, <Section N="Protection">) on ALL shapes
      const directSections = getDirectChildrenByTag(shape, 'Section');
      for (const sec of directSections) {
        const secName = sec.getAttribute('N');
        if (secName === 'TextXForm' || secName === 'TextBlock' || secName === 'Text' || secName === 'Protection') {
          shape.removeChild(sec);
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
        continue;
      }

      // Check if shape has own text content
      const textNode = findFirstElementByTag(shape, 'Text');
      if (!textNode) {
        continue;
      }
      const textContent = (textNode.textContent || '').trim();
      if (!textContent) {
        continue;
      }

      // Read numeric Width and Height (> 0)
      const widthCell = directCells.find(c => c.getAttribute('N') === 'Width') || getCell(shape, 'Width');
      const heightCell = directCells.find(c => c.getAttribute('N') === 'Height') || getCell(shape, 'Height');

      const widthVal = widthCell ? parseFloat(widthCell.getAttribute('V') || '') : NaN;
      const heightVal = heightCell ? parseFloat(heightCell.getAttribute('V') || '') : NaN;

      if (isNaN(widthVal) || isNaN(heightVal) || widthVal <= 0 || heightVal <= 0) {
        // Skip invalid or zero dimension shapes
        continue;
      }

      // Rule 4 & Specification 2.b: Create or update direct child <Cell> elements of <Shape>
      // Strict position: inserted BEFORE the first <Section> or <Text>
      if (options.fixTextXForm || options.adjustTextBoxesAndRotations) {
        const wStr = widthVal.toFixed(6);
        const hStr = heightVal.toFixed(6);
        const halfW = (widthVal * 0.5).toFixed(6);
        const halfH = (heightVal * 0.5).toFixed(6);

        // Required text transform cells:
        setOrUpdateDirectShapeCell(doc, shape, 'TxtWidth', wStr, 'Width*1');
        setOrUpdateDirectShapeCell(doc, shape, 'TxtHeight', hStr, 'Height*1');
        setOrUpdateDirectShapeCell(doc, shape, 'TxtPinX', halfW, 'Width*0.5');
        setOrUpdateDirectShapeCell(doc, shape, 'TxtPinY', halfH, 'Height*0.5');
        setOrUpdateDirectShapeCell(doc, shape, 'TxtLocPinX', halfW, 'TxtWidth*0.5');
        setOrUpdateDirectShapeCell(doc, shape, 'TxtLocPinY', halfH, 'TxtHeight*0.5');
        setOrUpdateDirectShapeCell(doc, shape, 'LockTextEdit', '0');
        setOrUpdateDirectShapeCell(doc, shape, 'TopMargin', '0', undefined, 'PT');
        setOrUpdateDirectShapeCell(doc, shape, 'BottomMargin', '0', undefined, 'PT');
        setOrUpdateDirectShapeCell(doc, shape, 'LeftMargin', '0', undefined, 'PT');
        setOrUpdateDirectShapeCell(doc, shape, 'RightMargin', '0', undefined, 'PT');
        setOrUpdateDirectShapeCell(doc, shape, 'VerticalAlign', '1');

        textBlocksFixed++;
      }

      // Specification 2.c: Small height handling (Height < 0.25 inches)
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
