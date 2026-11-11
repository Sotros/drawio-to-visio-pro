import JSZip from 'jszip';
import {
  ConversionOptions,
  DiagnosticReport,
  DrawioParsedCell
} from '../types';
import { sanitizeDrawio } from './drawioSanitizer';
import { patchVsdx } from './vsdxPatcher';
import { stencilToVisioGeometry } from './stencilParser';
import { safeNum } from './xmlUtils';

function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseHexColor(colorStr?: string, defaultColor = '#FFFFFF'): string {
  if (!colorStr || colorStr === 'none') return defaultColor;
  if (colorStr.startsWith('#')) return colorStr;
  return `#${colorStr}`;
}

interface ShapeMapping {
  visioId: number;
  cell: DrawioParsedCell;
  pinX: number;
  pinY: number;
  width: number;
  height: number;
  absX: number;
  absY: number;
}

/**
 * Recursively sums (x, y) coordinates through all parent ancestors until parent="1" or "0".
 * Width and Height are preserved without swapping during rotation,
 * ensuring exact CAD alignment for pins and components.
 */
export function getAbsoluteGeometry(
  cellId: string,
  cellsMap: Map<string, DrawioParsedCell>
): { x: number; y: number; width: number; height: number; rotation: number } {
  const cell = cellsMap.get(cellId);
  if (!cell || !cell.geometry) {
    return { x: 0, y: 0, width: 0, height: 0, rotation: 0 };
  }

  let currX = cell.geometry.x;
  let currY = cell.geometry.y;
  const width = cell.geometry.width;
  const height = cell.geometry.height;
  const totalRotation = cell.rotation || 0;

  let currParentId = cell.parent;
  const visited = new Set<string>([cellId]);

  while (currParentId && currParentId !== '0' && currParentId !== '1') {
    if (visited.has(currParentId)) break;
    visited.add(currParentId);

    const parentCell = cellsMap.get(currParentId);
    if (!parentCell || !parentCell.geometry) break;

    currX += parentCell.geometry.x;
    currY += parentCell.geometry.y;
    currParentId = parentCell.parent;
  }

  return { x: currX, y: currY, width, height, rotation: totalRotation };
}

/**
 * Builds a complete, compliant Microsoft Visio OpenXML (.vsdx) package
 * Architecture V4.0: Strict Visio XSD schema compliance (zero blank pages).
 */
export async function convertDrawioToVsdx(
  xmlContent: string,
  options: ConversionOptions
): Promise<{
  vsdxBlob: Blob;
  cleanDrawioXml: string;
  report: DiagnosticReport;
}> {
  // Step 1: Pre-clean and sanitize Draw.io XML
  const sanitized = sanitizeDrawio(xmlContent, options);
  const pages = sanitized.pages;

  if (pages.length === 0) {
    throw new Error('No se encontraron páginas válidas en el diagrama Draw.io.');
  }

  const zip = new JSZip();
  let totalShapes = 0;
  let totalConnectors = 0;
  let totalOrthogonalConnectors = 0;
  let totalTextBlocksFixed = 0;
  let totalNestedResolved = 0;
  const totalStencilsDecoded = sanitized.report.stencilsDecoded || 0;
  let totalGhostBordersCleared = 0;
  let totalHairlinesPreserved = 0;

  const warnings: string[] = [...(sanitized.report.warnings || [])];
  const logs: string[] = [...(sanitized.report.logs || [])];

  logs.push(`[V4.0] Iniciando construcción OpenXML para planos eléctricos de ${pages.length} página(s)...`);

  // 1. Pages entries for pages.xml & relationships
  const pagesEntries: string[] = [];
  const pagesRelsEntries: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageNum = i + 1;
    const relId = `rId${pageNum}`;
    const pWidthInches = (page.width || 1169) / 96;
    const pHeightInches = (page.height || 827) / 96;

    pagesEntries.push(`  <Page ID="${i}" Name="${escapeXml(page.name)}" ViewScale="1" ViewCenterX="${safeNum(pWidthInches / 2)}" ViewCenterY="${safeNum(pHeightInches / 2)}">
    <PageSheet>
      <Cell N="PageWidth" V="${safeNum(pWidthInches, 11)}"/>
      <Cell N="PageHeight" V="${safeNum(pHeightInches, 8.5)}"/>
      <Cell N="PageScale" V="1"/>
      <Cell N="DrawingScale" V="1"/>
      <Cell N="DrawingSizeType" V="0"/>
    </PageSheet>
    <Rel ID="${relId}"/>
  </Page>`);

    pagesRelsEntries.push(`  <Relationship Id="${relId}" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page${pageNum}.xml"/>`);
  }

  // 2. Process each page's shapes and connectors
  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const page = pages[pIdx];
    const pageNum = pIdx + 1;
    const pageHeightPx = page.height || 827;
    const pageHeightInches = pageHeightPx / 96;

    let shapeCounter = 1;
    const cellsMap = new Map<string, DrawioParsedCell>();
    page.cells.forEach(c => cellsMap.set(c.id, c));

    const drawioIdToVisioMap = new Map<string, ShapeMapping>();
    const shapesXmlParts: string[] = [];
    const connectsXmlParts: string[] = [];

    // Separate vertices and edges
    const vertexCells = page.cells.filter(c => c.vertex && c.geometry);
    const edgeCells = page.cells.filter(c => c.edge);

    // =========================================================================
    // Section 1: Formas 2D (Vertices)
    // =========================================================================
    for (const cell of vertexCells) {
      const visioId = shapeCounter++;

      const absGeo = options.resolveUserObjects || options.resolveNestedCoords
        ? getAbsoluteGeometry(cell.id, cellsMap)
        : {
            x: cell.geometry!.x,
            y: cell.geometry!.y,
            width: cell.geometry!.width,
            height: cell.geometry!.height,
            rotation: cell.rotation || 0
          };

      if (cell.parent && cell.parent !== '0' && cell.parent !== '1') {
        totalNestedResolved++;
      }

      const pxW = Math.max(1, absGeo.width);
      const pxH = Math.max(1, absGeo.height);
      const widthIn = pxW / 96;
      const heightIn = pxH / 96;

      const pxX = absGeo.x;
      const pxY = absGeo.y;
      const pinX = (pxX + pxW / 2) / 96;
      const pinY = pageHeightInches - ((pxY + pxH / 2) / 96);
      const locPinX = widthIn / 2;
      const locPinY = heightIn / 2;

      const rotationDeg = absGeo.rotation || 0;
      const angleRad = -((rotationDeg % 360) * Math.PI) / 180;

      drawioIdToVisioMap.set(cell.id, {
        visioId,
        cell,
        pinX,
        pinY,
        width: widthIn,
        height: heightIn,
        absX: pxX,
        absY: pxY
      });

      const style = cell.parsedStyle;
      const rawStrokeColor = style['strokeColor'];
      const rawFillColor = style['fillColor'];

      const isStrokeNone = !rawStrokeColor || rawStrokeColor === 'none';
      const isFillNone = !rawFillColor || rawFillColor === 'none';

      if (isStrokeNone) {
        totalGhostBordersCleared++;
      }

      const strokeColorHex = parseHexColor(rawStrokeColor, '#000000');
      const isDashed = style['dashed'] === '1';

      let strokeWidthIn = '0.0104';
      if (!isStrokeNone) {
        const rawW = style['strokeWidth'];
        if (rawW && rawW !== '0') {
          const pt = parseFloat(rawW);
          strokeWidthIn = safeNum(pt / 72, 0.0104);
        } else {
          strokeWidthIn = '0.007';
          totalHairlinesPreserved++;
        }
      }

      const fillColorHex = parseHexColor(rawFillColor, '#FFFFFF');

      // Geometry construction (pure 2D vector geometry)
      let geometryRows = '';
      if (isStrokeNone && isFillNone) {
        // Pure text bounding box or transparent container
        geometryRows = '';
      } else if (cell.isThinLine && !isStrokeNone) {
        // Divider hairline
        if (pxW >= pxH) {
          geometryRows = `        <Row T="MoveTo" IX="1"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="${safeNum(locPinY)}" F="Height*0.5"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${safeNum(widthIn, 0.01)}" F="Width*1"/><Cell N="Y" V="${safeNum(locPinY)}" F="Height*0.5"/></Row>`;
        } else {
          geometryRows = `        <Row T="MoveTo" IX="1"><Cell N="X" V="${safeNum(locPinX)}" F="Width*0.5"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${safeNum(locPinX)}" F="Width*0.5"/><Cell N="Y" V="${safeNum(heightIn, 0.01)}" F="Height*1"/></Row>`;
        }
      } else if (cell.isStencil && cell.stencilDef) {
        // Stencil definition
        const stencilXml = stencilToVisioGeometry(cell.stencilDef, widthIn, heightIn);
        // Extract rows from stencilXml
        const match = stencilXml.match(/<Section N="Geometry" IX="0">([\s\S]*?)<\/Section>/);
        if (match) {
          geometryRows = match[1].replace(/<Cell N="NoFill"[^>]*\/>/g, '').replace(/<Cell N="NoLine"[^>]*\/>/g, '').trim();
        }
      } else if (style['ellipse'] === '1' || style['shape'] === 'ellipse') {
        geometryRows = `        <Row T="Ellipse" IX="1">
          <Cell N="X" V="${safeNum(locPinX)}" F="Width*0.5"/>
          <Cell N="Y" V="${safeNum(locPinY)}" F="Height*0.5"/>
          <Cell N="A" V="${safeNum(widthIn, 0.01)}" F="Width*1"/>
          <Cell N="B" V="${safeNum(locPinY)}" F="Height*0.5"/>
          <Cell N="C" V="${safeNum(locPinX)}" F="Width*0.5"/>
          <Cell N="D" V="${safeNum(heightIn, 0.01)}" F="Height*1"/>
        </Row>`;
      } else if (style['rhombus'] === '1' || style['shape'] === 'rhombus') {
        geometryRows = `        <Row T="MoveTo" IX="1"><Cell N="X" V="${safeNum(locPinX)}" F="Width*0.5"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${safeNum(widthIn, 0.01)}" F="Width*1"/><Cell N="Y" V="${safeNum(locPinY)}" F="Height*0.5"/></Row>
        <Row T="LineTo" IX="3"><Cell N="X" V="${safeNum(locPinX)}" F="Width*0.5"/><Cell N="Y" V="${safeNum(heightIn, 0.01)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="4"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="${safeNum(locPinY)}" F="Height*0.5"/></Row>
        <Row T="LineTo" IX="5"><Cell N="X" V="${safeNum(locPinX)}" F="Width*0.5"/><Cell N="Y" V="0" F="Height*0"/></Row>`;
      } else {
        // Standard Rectangle
        geometryRows = `        <Row T="MoveTo" IX="1"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${safeNum(widthIn, 0.01)}" F="Width*1"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="3"><Cell N="X" V="${safeNum(widthIn, 0.01)}" F="Width*1"/><Cell N="Y" V="${safeNum(heightIn, 0.01)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="4"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="${safeNum(heightIn, 0.01)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="5"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>`;
      }

      // Check text content
      const hasText = !!cell.value && cell.value.trim().length > 0;
      let textContentXml = '';
      let textCellsXml = '';

      if (hasText) {
        totalTextBlocksFixed++;
        const fontSizePt = cell.fontSizePt || (style['fontSize'] ? parseFloat(style['fontSize']) * 0.75 : 9);
        const fontSizeIn = safeNum(fontSizePt / 72, 0.125);

        let fontColor = cell.fontColor || style['fontColor'];
        if (!fontColor) {
          fontColor = (!isFillNone && fillColorHex === '#000000') ? '#FFFFFF' : '#000000';
        } else {
          fontColor = parseHexColor(fontColor, '#000000');
        }

        const fontFamily = cell.fontFamily || options.targetFontFamily || 'Calibri';
        const fontStyleBit = cell.fontStyle !== undefined ? cell.fontStyle : 0;

        let horzAlign = '1';
        if (style['align'] === 'left') horzAlign = '0';
        else if (style['align'] === 'right') horzAlign = '2';

        let vertAlign = '1';
        if (style['verticalAlign'] === 'top') vertAlign = '0';
        else if (style['verticalAlign'] === 'bottom') vertAlign = '2';

        // BLOQUE 1 Text cells
        textCellsXml = `
      <Cell N="TxtPinX" V="${safeNum(locPinX)}" F="Width*0.5"/>
      <Cell N="TxtPinY" V="${safeNum(locPinY)}" F="Height*0.5"/>
      <Cell N="TxtWidth" V="${safeNum(widthIn, 0.01)}" F="Width*1"/>
      <Cell N="TxtHeight" V="${safeNum(heightIn, 0.01)}" F="Height*1"/>
      <Cell N="TxtLocPinX" V="${safeNum(locPinX)}" F="TxtWidth*0.5"/>
      <Cell N="TxtLocPinY" V="${safeNum(locPinY)}" F="TxtHeight*0.5"/>
      <Cell N="TxtAngle" V="0"/>
      <Cell N="LeftMargin" V="0"/>
      <Cell N="RightMargin" V="0"/>
      <Cell N="TopMargin" V="0"/>
      <Cell N="BottomMargin" V="0"/>
      <Cell N="VerticalAlign" V="${vertAlign}"/>
      <Cell N="LockTextEdit" V="0"/>`;

        // BLOQUE 2 Character & Paragraph sections
        textContentXml = `
      <Section N="Character">
        <Row IX="0">
          <Cell N="Font" V="${escapeXml(fontFamily)}"/>
          <Cell N="Size" V="${fontSizeIn}" unit="PT"/>
          <Cell N="Color" V="${fontColor}"/>
          <Cell N="Style" V="${fontStyleBit}"/>
        </Row>
      </Section>
      <Section N="Paragraph">
        <Row IX="0">
          <Cell N="HorzAlign" V="${horzAlign}"/>
        </Row>
      </Section>`;
      }

      // Geometry Section in BLOQUE 2
      const geometrySectionXml = `
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="${isFillNone ? '1' : '0'}"/>
        <Cell N="NoLine" V="${isStrokeNone ? '1' : '0'}"/>
${geometryRows}
      </Section>`;

      // STRICT XSD SCHEMA: 3 BLOQUES ORDENADOS
      const shapeXml = `    <Shape ID="${visioId}" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3">
      <!-- BLOQUE 1: Todas las etiquetas Cell directas -->
      <Cell N="PinX" V="${safeNum(pinX)}"/>
      <Cell N="PinY" V="${safeNum(pinY)}"/>
      <Cell N="Width" V="${safeNum(widthIn, 0.01)}"/>
      <Cell N="Height" V="${safeNum(heightIn, 0.01)}"/>
      <Cell N="LocPinX" V="${safeNum(locPinX)}"/>
      <Cell N="LocPinY" V="${safeNum(locPinY)}"/>
      <Cell N="Angle" V="${safeNum(angleRad)}"/>${cell.flipH ? '\n      <Cell N="FlipX" V="1"/>' : ''}${cell.flipV ? '\n      <Cell N="FlipY" V="1"/>' : ''}
      <Cell N="LineWeight" V="${strokeWidthIn}"/>
      <Cell N="LineColor" V="${strokeColorHex}"/>
      <Cell N="LinePattern" V="${isStrokeNone ? '0' : (isDashed ? '2' : '1')}"/>
      <Cell N="FillForegnd" V="${fillColorHex}"/>
      <Cell N="FillPattern" V="${isFillNone ? '0' : '1'}"/>${textCellsXml}
      <!-- BLOQUE 2: Todas las etiquetas Section directas -->${textContentXml}${geometrySectionXml}
      <!-- BLOQUE 3: Etiqueta Text SIEMPRE AL FINAL DEL SHAPE -->${hasText ? `\n      <Text><cp IX="0"/><pp IX="0"/>${escapeXml(cell.value)}</Text>` : ''}
    </Shape>`;

      shapesXmlParts.push(shapeXml);
      totalShapes++;
    }

    // =========================================================================
    // Section 2: Conectores Ortogonales como Polilíneas 2D (Sin Distorsión 1D)
    // =========================================================================
    for (const cell of edgeCells) {
      const visioId = shapeCounter++;

      const geo = cell.geometry;
      if (!geo) continue;

      let visioPoints: Array<{ x: number; y: number }> = [];

      let rawSrcX = 0;
      let rawSrcY = 0;
      let rawTgtX = 0;
      let rawTgtY = 0;

      if (cell.source && drawioIdToVisioMap.has(cell.source)) {
        const srcMap = drawioIdToVisioMap.get(cell.source)!;
        const exitX = cell.exitX !== undefined ? cell.exitX : 0.5;
        const exitY = cell.exitY !== undefined ? cell.exitY : 0.5;
        rawSrcX = srcMap.absX + srcMap.cell.geometry!.width * exitX;
        rawSrcY = srcMap.absY + srcMap.cell.geometry!.height * exitY;
      } else if (geo.sourcePoint) {
        rawSrcX = geo.sourcePoint.x;
        rawSrcY = geo.sourcePoint.y;
      }

      if (cell.target && drawioIdToVisioMap.has(cell.target)) {
        const tgtMap = drawioIdToVisioMap.get(cell.target)!;
        const entryX = cell.entryX !== undefined ? cell.entryX : 0.5;
        const entryY = cell.entryY !== undefined ? cell.entryY : 0.5;
        rawTgtX = tgtMap.absX + tgtMap.cell.geometry!.width * entryX;
        rawTgtY = tgtMap.absY + tgtMap.cell.geometry!.height * entryY;
      } else if (geo.targetPoint) {
        rawTgtX = geo.targetPoint.x;
        rawTgtY = geo.targetPoint.y;
      }

      visioPoints.push({
        x: rawSrcX / 96,
        y: pageHeightInches - rawSrcY / 96
      });

      if (geo.points && geo.points.length > 0 && options.routeOrthogonalConnectors) {
        totalOrthogonalConnectors++;
        for (const pt of geo.points) {
          visioPoints.push({
            x: pt.x / 96,
            y: pageHeightInches - pt.y / 96
          });
        }
      }

      visioPoints.push({
        x: rawTgtX / 96,
        y: pageHeightInches - rawTgtY / 96
      });

      const allX = visioPoints.map(p => p.x);
      const allY = visioPoints.map(p => p.y);
      const minX = Math.min(...allX);
      const maxX = Math.max(...allX);
      const minY = Math.min(...allY);
      const maxY = Math.max(...allY);

      const widthIn = Math.max(0.005, maxX - minX);
      const heightIn = Math.max(0.005, maxY - minY);
      const pinX = minX + widthIn / 2;
      const pinY = minY + heightIn / 2;
      const locPinX = widthIn / 2;
      const locPinY = heightIn / 2;

      const style = cell.parsedStyle;
      const strokeColor = parseHexColor(style['strokeColor'], '#000000');
      const strokeWidthPt = parseFloat(style['strokeWidth'] || '1.5');
      const strokeWidthIn = safeNum(strokeWidthPt / 72, 0.0104);
      const isDashed = style['dashed'] === '1';

      // 2D geometry rows in local unrotated coordinates (Angle = 0)
      const geomRows: string[] = [];
      const firstPt = visioPoints[0];
      geomRows.push(`        <Row T="MoveTo" IX="1">
          <Cell N="X" V="${safeNum(firstPt.x - minX)}"/>
          <Cell N="Y" V="${safeNum(firstPt.y - minY)}"/>
        </Row>`);

      for (let i = 1; i < visioPoints.length; i++) {
        const pt = visioPoints[i];
        geomRows.push(`        <Row T="LineTo" IX="${i + 1}">
          <Cell N="X" V="${safeNum(pt.x - minX)}"/>
          <Cell N="Y" V="${safeNum(pt.y - minY)}"/>
        </Row>`);
      }

      const edgeHasText = !!cell.value && cell.value.trim().length > 0;
      let edgeTextCellsXml = '';
      let edgeTextSectionXml = '';

      if (edgeHasText) {
        edgeTextCellsXml = `
      <Cell N="TxtPinX" V="${safeNum(locPinX)}" F="Width*0.5"/>
      <Cell N="TxtPinY" V="${safeNum(locPinY)}" F="Height*0.5"/>
      <Cell N="TxtWidth" V="${safeNum(Math.min(widthIn, 1.5), 0.5)}" F="Width*1"/>
      <Cell N="TxtHeight" V="0.3" F="Height*1"/>
      <Cell N="TxtLocPinX" V="${safeNum(Math.min(widthIn, 1.5) / 2)}" F="TxtWidth*0.5"/>
      <Cell N="TxtLocPinY" V="0.15" F="TxtHeight*0.5"/>
      <Cell N="TxtAngle" V="0"/>
      <Cell N="LeftMargin" V="0"/>
      <Cell N="RightMargin" V="0"/>
      <Cell N="TopMargin" V="0"/>
      <Cell N="BottomMargin" V="0"/>
      <Cell N="VerticalAlign" V="1"/>
      <Cell N="LockTextEdit" V="0"/>`;

        edgeTextSectionXml = `
      <Section N="Character">
        <Row IX="0">
          <Cell N="Font" V="Calibri"/>
          <Cell N="Size" V="0.125" unit="PT"/>
          <Cell N="Color" V="${strokeColor}"/>
          <Cell N="Style" V="0"/>
        </Row>
      </Section>
      <Section N="Paragraph">
        <Row IX="0">
          <Cell N="HorzAlign" V="1"/>
        </Row>
      </Section>`;
      }

      const edgeShapeXml = `    <Shape ID="${visioId}" Type="Shape" LineStyle="3" TextStyle="3">
      <!-- BLOQUE 1: Celdas directas del conector -->
      <Cell N="PinX" V="${safeNum(pinX)}"/>
      <Cell N="PinY" V="${safeNum(pinY)}"/>
      <Cell N="Width" V="${safeNum(widthIn, 0.005)}"/>
      <Cell N="Height" V="${safeNum(heightIn, 0.005)}"/>
      <Cell N="LocPinX" V="${safeNum(locPinX)}"/>
      <Cell N="LocPinY" V="${safeNum(locPinY)}"/>
      <Cell N="Angle" V="0"/>
      <Cell N="LineWeight" V="${strokeWidthIn}"/>
      <Cell N="LineColor" V="${strokeColor}"/>
      <Cell N="LinePattern" V="${isDashed ? '2' : '1'}"/>
      <Cell N="FillForegnd" V="#000000"/>
      <Cell N="FillPattern" V="0"/>${edgeTextCellsXml}
      <!-- BLOQUE 2: Secciones del conector -->${edgeTextSectionXml}
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="1"/>
        <Cell N="NoLine" V="0"/>
${geomRows.join('\n')}
      </Section>
      <!-- BLOQUE 3: Text siempre al final -->${edgeHasText ? `\n      <Text><cp IX="0"/><pp IX="0"/>${escapeXml(cell.value)}</Text>` : ''}
    </Shape>`;

      shapesXmlParts.push(edgeShapeXml);
      totalConnectors++;
    }

    // Connects XML
    const connectsXml = connectsXmlParts.length > 0
      ? `\n    <Connects>\n${connectsXmlParts.join('\n')}\n    </Connects>`
      : '';

    // Final page XML (Clean schema)
    const pageXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <Shapes>
${shapesXmlParts.join('\n')}
  </Shapes>${connectsXml}
</PageContents>`;

    zip.file(`visio/pages/page${pageNum}.xml`, pageXml);
  }

  // 3. Clean [Content_Types].xml (Strict XSD standard without extra media extensions)
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
  <Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>
${pages.map((_, i) => `  <Override PartName="/visio/pages/page${i + 1}.xml" ContentType="application/vnd.ms-visio.page+xml"/>`).join('\n')}
</Types>`;
  zip.file('[Content_Types].xml', contentTypesXml);

  // 4. _rels/.rels
  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
</Relationships>`;
  zip.file('_rels/.rels', rootRelsXml);

  // 5. visio/document.xml
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <DocumentSettings>
    <GlueSettings>9</GlueSettings>
    <SnapSettings>65535</SnapSettings>
    <SnapExtensions>31</SnapExtensions>
  </DocumentSettings>
  <Colors>
    <ColorEntry IX="0" RGB="#000000"/>
    <ColorEntry IX="1" RGB="#FFFFFF"/>
    <ColorEntry IX="2" RGB="#FF0000"/>
    <ColorEntry IX="3" RGB="#00FF00"/>
    <ColorEntry IX="4" RGB="#0000FF"/>
  </Colors>
</VisioDocument>`;
  zip.file('visio/document.xml', docXml);

  // 6. visio/_rels/document.xml.rels
  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>
  <Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/>
</Relationships>`;
  zip.file('visio/_rels/document.xml.rels', docRelsXml);

  // 7. visio/windows.xml
  const windowsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Windows xmlns="http://schemas.microsoft.com/office/visio/2012/main">
  <Window ID="0" WindowType="Drawing" WindowState="1073741824">
    <ShowRulers>1</ShowRulers>
    <ShowGrid>1</ShowGrid>
    <ShowPageBreaks>0</ShowPageBreaks>
    <ShowGuides>1</ShowGuides>
    <ShowConnectionPoints>1</ShowConnectionPoints>
    <GlueSettings>9</GlueSettings>
    <SnapSettings>65535</SnapSettings>
    <SnapExtensions>31</SnapExtensions>
  </Window>
</Windows>`;
  zip.file('visio/windows.xml', windowsXml);

  // 8. visio/pages/pages.xml & visio/pages/_rels/pages.xml.rels
  const pagesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${pagesEntries.join('\n')}
</Pages>`;
  zip.file('visio/pages/pages.xml', pagesXml);

  const pagesRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${pagesRelsEntries.join('\n')}
</Relationships>`;
  zip.file('visio/pages/_rels/pages.xml.rels', pagesRelsXml);

  // Generate initial VSDX
  logs.push(`Comprimiendo archivo binario .vsdx V4.0 estricto...`);
  const initialVsdxBlob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.ms-visio.drawing.main+xml',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  // Step 2: Pass output through vsdxPatcher to guarantee strict XSD compliance
  logs.push(`Aplicando control de calidad y parcheo final con VsdxPatcher...`);
  const patchedResult = await patchVsdx(initialVsdxBlob, options);

  logs.push(`Conversión V4.0 finalizada con éxito.`);

  const report: DiagnosticReport = {
    fileName: '',
    fileType: 'drawio',
    pagesCount: pages.length,
    userObjectsResolved: sanitized.report.userObjectsResolved || 0,
    htmlStylesRescued: sanitized.report.htmlStylesRescued || 0,
    htmlTagsRemoved: sanitized.report.htmlTagsRemoved || 0,
    shapesCount: totalShapes,
    connectorsCount: totalConnectors,
    orthogonalConnectorsCount: totalOrthogonalConnectors,
    stencilsDecoded: totalStencilsDecoded,
    imagesEmbedded: 0,
    ghostBordersCleared: totalGhostBordersCleared,
    hairlinesPreserved: totalHairlinesPreserved,
    textBlocksFixed: patchedResult.report.textBlocksFixed || totalTextBlocksFixed,
    nestedResolvedCount: totalNestedResolved,
    warnings,
    logs,
    status: 'success',
    outputVsdxSize: patchedResult.patchedBlob.size,
    outputDrawioSize: new Blob([sanitized.sanitizedXml]).size
  };

  return {
    vsdxBlob: patchedResult.patchedBlob,
    cleanDrawioXml: sanitized.sanitizedXml,
    report
  };
}
