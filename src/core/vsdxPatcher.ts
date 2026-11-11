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
 * Helper to get a cell in an XML element.
 * Checks direct children or inside sections/rows.
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
 * Ensures or updates a Cell inside a parent XML node.
 */
function setOrUpdateCell(
  doc: Document,
  parent: Element,
  name: string,
  val: string,
  formula?: string
): Element {
  const directCells = getDirectChildrenByTag(parent, 'Cell');
  let cell = directCells.find(c => c.getAttribute('N') === name);

  if (!cell) {
    cell = doc.createElement('Cell');
    cell.setAttribute('N', name);
    parent.appendChild(cell);
  }

  cell.setAttribute('V', val);
  if (formula !== undefined) {
    cell.setAttribute('F', formula);
  }
  return cell;
}

/**
 * Patches a Visio .vsdx package in-place using JSZip.
 * Fixes misaligned text blocks, text wrapping, edit locks, and font sizes.
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
  const logs: string[] = [];
  const warnings: string[] = [];

  // Find all page XML files in visio/pages/page*.xml
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
  logs.push(`Encontradas ${totalPages} página(s) en el archivo .vsdx.`);

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
      const hasText = !!findFirstElementByTag(shape, 'Text');
      if (!hasText) {
        continue;
      }

      // Read shape width and height
      const widthCell = getCell(shape, 'Width');
      const heightCell = getCell(shape, 'Height');

      const widthVal = widthCell ? parseFloat(widthCell.getAttribute('V') || '1') : 1;
      const heightVal = heightCell ? parseFloat(heightCell.getAttribute('V') || '1') : 1;

      // Ensure TextXForm section exists
      const directSections = getDirectChildrenByTag(shape, 'Section');
      let textXFormSec = directSections.find(c => c.getAttribute('N') === 'TextXForm');

      if (!textXFormSec) {
        textXFormSec = doc.createElement('Section');
        textXFormSec.setAttribute('N', 'TextXForm');

        const xFormSec = directSections.find(c => c.getAttribute('N') === 'XForm');
        if (xFormSec && xFormSec.nextSibling) {
          shape.insertBefore(textXFormSec, xFormSec.nextSibling);
        } else {
          shape.appendChild(textXFormSec);
        }
      }

      if (options.fixTextXForm || options.adjustTextBoxesAndRotations) {
        // TxtWidth = Width (formula: Width*1)
        setOrUpdateCell(doc, textXFormSec, 'TxtWidth', widthVal.toString(), 'Width*1');
        // TxtHeight = Height (formula: Height*1)
        setOrUpdateCell(doc, textXFormSec, 'TxtHeight', heightVal.toString(), 'Height*1');
        // TxtPinX = Width * 0.5 (formula: Width*0.5)
        setOrUpdateCell(doc, textXFormSec, 'TxtPinX', (widthVal * 0.5).toString(), 'Width*0.5');
        // TxtPinY = Height * 0.5 (formula: Height*0.5)
        setOrUpdateCell(doc, textXFormSec, 'TxtPinY', (heightVal * 0.5).toString(), 'Height*0.5');
        // TxtLocPinX = TxtWidth * 0.5 (formula: TxtWidth*0.5)
        setOrUpdateCell(doc, textXFormSec, 'TxtLocPinX', (widthVal * 0.5).toString(), 'TxtWidth*0.5');
        // TxtLocPinY = TxtHeight * 0.5 (formula: TxtHeight*0.5)
        setOrUpdateCell(doc, textXFormSec, 'TxtLocPinY', (heightVal * 0.5).toString(), 'TxtHeight*0.5');
        // TxtAngle = 0 to avoid duplicate rotation
        setOrUpdateCell(doc, textXFormSec, 'TxtAngle', '0');

        // Remove legacy conflicting direct cells from shape root if present
        const directCells = getDirectChildrenByTag(shape, 'Cell');
        const conflictingNames = ['TxtWidth', 'TxtHeight', 'TxtPinX', 'TxtPinY', 'TxtLocPinX', 'TxtLocPinY', 'TxtAngle'];
        for (const c of directCells) {
          const n = c.getAttribute('N') || '';
          if (conflictingNames.includes(n)) {
            shape.removeChild(c);
          }
        }

        textBlocksFixed++;
      }

      // Ensure LockTextEdit="0", WrapText="0" (to prevent word-break mid-word), and zero margins
      let textSec = directSections.find(c => c.getAttribute('N') === 'Text');
      if (!textSec) {
        textSec = doc.createElement('Section');
        textSec.setAttribute('N', 'Text');
        shape.appendChild(textSec);
      }
      setOrUpdateCell(doc, textSec, 'WrapText', '0');
      if (options.adjustTextBoxesAndRotations) {
        setOrUpdateCell(doc, textSec, 'TopMargin', '0');
        setOrUpdateCell(doc, textSec, 'BottomMargin', '0');
        setOrUpdateCell(doc, textSec, 'LeftMargin', '0');
        setOrUpdateCell(doc, textSec, 'RightMargin', '0');
      }

      let protSec = directSections.find(c => c.getAttribute('N') === 'Protection');
      if (!protSec) {
        protSec = doc.createElement('Section');
        protSec.setAttribute('N', 'Protection');
        shape.appendChild(protSec);
      }
      setOrUpdateCell(doc, protSec, 'LockTextEdit', '0');

      // Character font normalization and size scaling
      if (options.normalizeFont) {
        const charSec = directSections.find(c => c.getAttribute('N') === 'Character');
        if (charSec) {
          const rows = getDirectChildrenByTag(charSec, 'Row');
          for (const row of rows) {
            setOrUpdateCell(doc, row, 'Font', options.targetFontFamily || 'Calibri');

            const sizeCell = getCell(row, 'Size');
            if (sizeCell) {
              const currentSize = parseFloat(sizeCell.getAttribute('V') || '0');
              if (currentSize > 0) {
                const scaledSize = currentSize * options.fontScaleFactor;
                sizeCell.setAttribute('V', scaledSize.toFixed(6));
              }
            }
          }
        }
      }
    }

    // Write back modified page XML to ZIP
    const modifiedXml = serializeXml(doc);
    zip.file(pagePath, modifiedXml);
  }

  logs.push(`Parcheo VSDX completado: ${textBlocksFixed} bloques TextXForm reparados.`);

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
      warnings,
      logs
    }
  };
}
