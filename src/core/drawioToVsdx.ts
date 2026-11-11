import JSZip from 'jszip';
import {
  ConversionOptions,
  DiagnosticReport,
  DrawioParsedCell
} from '../types';
import { sanitizeDrawio } from './drawioSanitizer';
import { patchVsdx } from './vsdxPatcher';
import { stencilToVisioGeometry } from './stencilParser';

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
 * In V3.0, Width and Height are preserved without swapping during rotation,
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
 * Architecture V3.0 Definitive for complex CAD and electrical schematics.
 */
export async function convertDrawioToVsdx(
  xmlContent: string,
  options: ConversionOptions
): Promise<{
  vsdxBlob: Blob;
  cleanDrawioXml: string;
  report: DiagnosticReport;
}> {
  // Step 1: Sanitize Draw.io XML, resolve UserObjects and rescue HTML styles
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
  let totalStencilsDecoded = sanitized.report.stencilsDecoded || 0;
  let totalImagesEmbedded = 0;
  let totalGhostBordersCleared = 0;
  let totalHairlinesPreserved = 0;

  const warnings: string[] = [...(sanitized.report.warnings || [])];
  const logs: string[] = [...(sanitized.report.logs || [])];

  logs.push(`[V3.0] Iniciando construcción OpenXML para planos eléctricos de ${pages.length} página(s)...`);

  // Media files registry for images
  let globalImageCounter = 1;
  const imageExtensions = new Set<string>(['png', 'jpg', 'jpeg', 'gif', 'bmp']);

  // 1. Pages entries for pages.xml & relationships
  const pagesEntries: string[] = [];
  const pagesRelsEntries: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageNum = i + 1;
    const relId = `rId${pageNum}`;
    const pWidthInches = ((page.width || 1169) / 96).toFixed(4);
    const pHeightInches = ((page.height || 827) / 96).toFixed(4);

    pagesEntries.push(`  <Page ID="${i}" Name="${escapeXml(page.name)}" ViewScale="1" ViewCenterX="${(parseFloat(pWidthInches) / 2).toFixed(4)}" ViewCenterY="${(parseFloat(pHeightInches) / 2).toFixed(4)}">
    <PageSheet>
      <Cell N="PageWidth" V="${pWidthInches}"/>
      <Cell N="PageHeight" V="${pHeightInches}"/>
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
    const pageImageRels: string[] = [];

    // Separate vertices and edges
    const vertexCells = page.cells.filter(c => c.vertex && c.geometry);
    const edgeCells = page.cells.filter(c => c.edge);

    // ==========================================
    // Process Vertices (2D Shapes, Stencils, Hairlines, Images)
    // ==========================================
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

      const pxW = Math.max(absGeo.width, 0.5);
      const pxH = Math.max(absGeo.height, 0.5);
      const widthIn = pxW / 96;
      const heightIn = pxH / 96;

      // Invert Y axis for Visio: origin bottom-left
      const pinX = (absGeo.x + pxW / 2) / 96;
      const pinY = pageHeightInches - ((absGeo.y + pxH / 2) / 96);
      const locPinX = widthIn / 2;
      const locPinY = heightIn / 2;

      // Convert rotation: draw.io clockwise deg -> Visio counter-clockwise rad
      const rotDeg = absGeo.rotation || 0;
      const angleRad = -((rotDeg % 360) * Math.PI) / 180;

      drawioIdToVisioMap.set(cell.id, {
        visioId,
        cell,
        pinX,
        pinY,
        width: widthIn,
        height: heightIn,
        absX: absGeo.x,
        absY: absGeo.y
      });

      const style = cell.parsedStyle;
      const rawStrokeColor = style['strokeColor'] ? style['strokeColor'].trim() : '';
      const rawFillColor = style['fillColor'] ? style['fillColor'].trim() : '';

      // ========================================================
      // Section 4: Fill & Stroke Rules (Ghost Border Elimination)
      // ========================================================
      const isFillNone = rawFillColor === 'none' || (!rawFillColor && !style['shape']);
      const isStrokeNone = rawStrokeColor === 'none' || (!rawStrokeColor && !cell.isThinLine);
      const isDashed = style['dashed'] === '1';

      if (isStrokeNone) {
        totalGhostBordersCleared++;
      }

      let strokeColorHex = '#000000';
      let strokeWidthIn = '0.007'; // default hairline ~0.5pt

      if (!isStrokeNone) {
        strokeColorHex = parseHexColor(rawStrokeColor, '#000000');
        const swVal = style['strokeWidth'];
        if (swVal && parseFloat(swVal) > 0) {
          strokeWidthIn = (parseFloat(swVal) / 72).toFixed(6);
        } else {
          // Hairline CAD (strokeWidth is "0" or not defined, but strokeColor is valid)
          strokeWidthIn = '0.007';
          totalHairlinesPreserved++;
        }
      }

      const fillColorHex = parseHexColor(rawFillColor, '#FFFFFF');

      // Embedded Base64 Image (V3.0: supports with and without ';base64')
      let foreignImageXml = '';
      let isForeignType = false;

      if (cell.isBase64Image && cell.imageData && options.convertStencilsAndImages) {
        const imgNum = globalImageCounter++;
        const ext = cell.imageData.extension;
        imageExtensions.add(ext);
        const imgPath = `visio/media/image${imgNum}.${ext}`;

        try {
          const binaryStr = atob(cell.imageData.base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let b = 0; b < binaryStr.length; b++) {
            bytes[b] = binaryStr.charCodeAt(b);
          }
          zip.file(imgPath, bytes);

          const rId = `rIdImg${imgNum}`;
          pageImageRels.push(
            `  <Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${imgNum}.${ext}"/>`
          );

          isForeignType = true;
          foreignImageXml = `
      <Cell N="ImgOffsetX" V="0"/>
      <Cell N="ImgOffsetY" V="0"/>
      <Cell N="ImgWidth" V="${widthIn.toFixed(4)}" F="Width*1"/>
      <Cell N="ImgHeight" V="${heightIn.toFixed(4)}" F="Height*1"/>
      <ForeignData ForeignType="Bitmap" CompressionType="${ext === 'png' ? 'PNG' : 'JPEG'}">
        <Rel r:id="${rId}"/>
      </ForeignData>`;
          totalImagesEmbedded++;
        } catch {
          warnings.push(`No se pudo decodificar la imagen Base64 de la celda ${cell.id}.`);
        }
      }

      // ==========================================
      // Geometry construction
      // ==========================================
      let geometryXml = '';

      if (isStrokeNone && isFillNone && !isForeignType) {
        // Pure text bounding box or transparent container (e.g. UzV2 stencil)
        geometryXml = `
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="1"/>
        <Cell N="NoLine" V="1"/>
      </Section>`;
      } else if (cell.isThinLine && !isStrokeNone) {
        // Title block divider line (width <= 2px or height <= 2px)
        if (pxW >= pxH) {
          // Horizontal line
          geometryXml = `
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="1"/>
        <Cell N="NoLine" V="0"/>
        <Row T="MoveTo" IX="1"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="${locPinY.toFixed(4)}" F="Height*0.5"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${widthIn.toFixed(4)}" F="Width*1"/><Cell N="Y" V="${locPinY.toFixed(4)}" F="Height*0.5"/></Row>
      </Section>`;
        } else {
          // Vertical line
          geometryXml = `
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="1"/>
        <Cell N="NoLine" V="0"/>
        <Row T="MoveTo" IX="1"><Cell N="X" V="${locPinX.toFixed(4)}" F="Width*0.5"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${locPinX.toFixed(4)}" F="Width*0.5"/><Cell N="Y" V="${heightIn.toFixed(4)}" F="Height*1"/></Row>
      </Section>`;
        }
      } else if (cell.isStencil && cell.stencilDef) {
        geometryXml = stencilToVisioGeometry(cell.stencilDef, widthIn, heightIn);
      } else if (style['ellipse'] === '1' || style['shape'] === 'ellipse') {
        geometryXml = `
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="${isFillNone ? '1' : '0'}"/>
        <Cell N="NoLine" V="${isStrokeNone ? '1' : '0'}"/>
        <Row T="Ellipse" IX="1">
          <Cell N="X" V="${locPinX.toFixed(4)}" F="Width*0.5"/>
          <Cell N="Y" V="${locPinY.toFixed(4)}" F="Height*0.5"/>
          <Cell N="A" V="${widthIn.toFixed(4)}" F="Width*1"/>
          <Cell N="B" V="${locPinY.toFixed(4)}" F="Height*0.5"/>
          <Cell N="C" V="${locPinX.toFixed(4)}" F="Width*0.5"/>
          <Cell N="D" V="${heightIn.toFixed(4)}" F="Height*1"/>
        </Row>
      </Section>`;
      } else if (style['rhombus'] === '1' || style['shape'] === 'rhombus') {
        geometryXml = `
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="${isFillNone ? '1' : '0'}"/>
        <Cell N="NoLine" V="${isStrokeNone ? '1' : '0'}"/>
        <Row T="MoveTo" IX="1"><Cell N="X" V="${locPinX.toFixed(4)}" F="Width*0.5"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${widthIn.toFixed(4)}" F="Width*1"/><Cell N="Y" V="${locPinY.toFixed(4)}" F="Height*0.5"/></Row>
        <Row T="LineTo" IX="3"><Cell N="X" V="${locPinX.toFixed(4)}" F="Width*0.5"/><Cell N="Y" V="${heightIn.toFixed(4)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="4"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="${locPinY.toFixed(4)}" F="Height*0.5"/></Row>
        <Row T="LineTo" IX="5"><Cell N="X" V="${locPinX.toFixed(4)}" F="Width*0.5"/><Cell N="Y" V="0" F="Height*0"/></Row>
      </Section>`;
      } else if (!isForeignType) {
        // Standard Rectangle
        geometryXml = `
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="${isFillNone ? '1' : '0'}"/>
        <Cell N="NoLine" V="${isStrokeNone ? '1' : '0'}"/>
        <Row T="MoveTo" IX="1"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${widthIn.toFixed(4)}" F="Width*1"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="3"><Cell N="X" V="${widthIn.toFixed(4)}" F="Width*1"/><Cell N="Y" V="${heightIn.toFixed(4)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="4"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="${heightIn.toFixed(4)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="5"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>
      </Section>`;
      }

      // ==========================================
      // Text and Typography (Section 6)
      // ==========================================
      const hasText = cell.value && cell.value.trim().length > 0;
      let textContentXml = '';

      if (hasText) {
        totalTextBlocksFixed++;
        const fontSizePt = cell.fontSizePt || (style['fontSize'] ? parseFloat(style['fontSize']) * 0.75 : 9);
        const fontSizeIn = (fontSizePt / 72).toFixed(6);

        // Precedence: explicit rescued fontColor -> cell fontColor -> #FFFFFF if fill is black -> #000000
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
      </Section>
      <Section N="Text">
        <Cell N="TopMargin" V="0"/>
        <Cell N="BottomMargin" V="0"/>
        <Cell N="LeftMargin" V="0"/>
        <Cell N="RightMargin" V="0"/>
        <Cell N="WrapText" V="0"/>
        <Cell N="VerticalAlign" V="${vertAlign}"/>
      </Section>
      <Text><cp IX="0"/><pp IX="0"/>${escapeXml(cell.value)}</Text>`;
      }

      const shapeTypeAttr = isForeignType ? 'Type="Foreign"' : 'Type="Shape"';

      const shapeXml = `    <Shape ID="${visioId}" ${shapeTypeAttr} LineStyle="3" FillStyle="3" TextStyle="3">
      <Section N="XForm">
        <Cell N="PinX" V="${pinX.toFixed(4)}"/>
        <Cell N="PinY" V="${pinY.toFixed(4)}"/>
        <Cell N="Width" V="${widthIn.toFixed(4)}"/>
        <Cell N="Height" V="${heightIn.toFixed(4)}"/>
        <Cell N="LocPinX" V="${locPinX.toFixed(4)}"/>
        <Cell N="LocPinY" V="${locPinY.toFixed(4)}"/>
        <Cell N="Angle" V="${angleRad.toFixed(6)}"/>
        <Cell N="FlipX" V="${cell.flipH ? '1' : '0'}"/>
        <Cell N="FlipY" V="${cell.flipV ? '1' : '0'}"/>
      </Section>
      <Section N="TextXForm">
        <Cell N="TxtPinX" V="${locPinX.toFixed(4)}" F="Width*0.5"/>
        <Cell N="TxtPinY" V="${locPinY.toFixed(4)}" F="Height*0.5"/>
        <Cell N="TxtWidth" V="${widthIn.toFixed(4)}" F="Width*1"/>
        <Cell N="TxtHeight" V="${heightIn.toFixed(4)}" F="Height*1"/>
        <Cell N="TxtLocPinX" V="${locPinX.toFixed(4)}" F="TxtWidth*0.5"/>
        <Cell N="TxtLocPinY" V="${locPinY.toFixed(4)}" F="TxtHeight*0.5"/>
        <Cell N="TxtAngle" V="0"/>
      </Section>
      <Section N="Line">
        <Cell N="LineColor" V="${strokeColorHex}"/>
        <Cell N="LineWeight" V="${strokeWidthIn}"/>
        <Cell N="LinePattern" V="${isStrokeNone ? '0' : (isDashed ? '2' : '1')}"/>
        <Cell N="Rounding" V="${style['rounded'] === '1' ? '0.05' : '0'}"/>
      </Section>
      <Section N="Fill">
        <Cell N="FillForegnd" V="${fillColorHex}"/>
        <Cell N="FillPattern" V="${isFillNone ? '0' : '1'}"/>
      </Section>
      <Section N="Protection">
        <Cell N="LockTextEdit" V="0"/>
      </Section>${geometryXml}${foreignImageXml}${textContentXml}
    </Shape>`;

      shapesXmlParts.push(shapeXml);
      totalShapes++;
    }

    // =========================================================================
    // Section 3: Conectores Ortogonales como Polilíneas 2D (Sin Distorsión 1D)
    // =========================================================================
    for (const cell of edgeCells) {
      const visioId = shapeCounter++;

      let startPxX = 0;
      let startPxY = 0;
      let endPxX = 100;
      let endPxY = 100;

      const sourceMapped = cell.source ? drawioIdToVisioMap.get(cell.source) : undefined;
      const targetMapped = cell.target ? drawioIdToVisioMap.get(cell.target) : undefined;

      // 1. Calculate anchor-exact start point
      if (sourceMapped) {
        const exitX = cell.exitX !== undefined ? cell.exitX : (cell.geometry?.sourcePoint ? (cell.geometry.sourcePoint.x / (sourceMapped.width * 96)) : 0.5);
        const exitY = cell.exitY !== undefined ? cell.exitY : (cell.geometry?.sourcePoint ? (cell.geometry.sourcePoint.y / (sourceMapped.height * 96)) : 0.5);
        startPxX = sourceMapped.absX + exitX * (sourceMapped.width * 96);
        startPxY = sourceMapped.absY + exitY * (sourceMapped.height * 96);
      } else if (cell.geometry?.sourcePoint) {
        startPxX = cell.geometry.sourcePoint.x;
        startPxY = cell.geometry.sourcePoint.y;
      }

      // 2. Calculate anchor-exact end point
      if (targetMapped) {
        const entryX = cell.entryX !== undefined ? cell.entryX : (cell.geometry?.targetPoint ? (cell.geometry.targetPoint.x / (targetMapped.width * 96)) : 0.5);
        const entryY = cell.entryY !== undefined ? cell.entryY : (cell.geometry?.targetPoint ? (cell.geometry.targetPoint.y / (targetMapped.height * 96)) : 0.5);
        endPxX = targetMapped.absX + entryX * (targetMapped.width * 96);
        endPxY = targetMapped.absY + entryY * (targetMapped.height * 96);
      } else if (cell.geometry?.targetPoint) {
        endPxX = cell.geometry.targetPoint.x;
        endPxY = cell.geometry.targetPoint.y;
      }

      // 3. Collect polyline points: [Start, ...Waypoints, End]
      const rawPoints: Array<{ x: number; y: number }> = [{ x: startPxX, y: startPxY }];

      if (cell.geometry?.points && cell.geometry.points.length > 0) {
        for (const pt of cell.geometry.points) {
          rawPoints.push({ x: pt.x, y: pt.y });
        }
      }
      rawPoints.push({ x: endPxX, y: endPxY });

      // 4. Ensure orthogonal 90-degree elbows if diagonal segments exist
      const isOrthogonal = cell.style.includes('orthogonalEdgeStyle') || options.routeOrthogonalConnectors;
      const polylinePoints: Array<{ x: number; y: number }> = [];

      for (let i = 0; i < rawPoints.length - 1; i++) {
        const p1 = rawPoints[i];
        const p2 = rawPoints[i + 1];
        polylinePoints.push(p1);

        if (isOrthogonal && Math.abs(p1.x - p2.x) > 1 && Math.abs(p1.y - p2.y) > 1) {
          totalOrthogonalConnectors++;
          // Insert 90-degree elbow at midpoint
          const midX = (p1.x + p2.x) / 2;
          polylinePoints.push({ x: midX, y: p1.y });
          polylinePoints.push({ x: midX, y: p2.y });
        }
      }
      polylinePoints.push(rawPoints[rawPoints.length - 1]);

      // 5. Convert all vertices to Visio inches and invert Y
      const visioPoints = polylinePoints.map(p => ({
        x: p.x / 96,
        y: pageHeightInches - (p.y / 96)
      }));

      // 6. Calculate Bounding Box for 2D Unrotated Shape
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
      const strokeWidthIn = (strokeWidthPt / 72).toFixed(6);
      const isDashed = style['dashed'] === '1';
      const hasEndArrow = style['endArrow'] !== 'none';

      // 7. Generate 2D geometry rows in local unrotated coordinates (Angle = 0)
      const geomRows: string[] = [];
      const firstPt = visioPoints[0];
      geomRows.push(`        <Row T="MoveTo" IX="1">
          <Cell N="X" V="${(firstPt.x - minX).toFixed(4)}"/>
          <Cell N="Y" V="${(firstPt.y - minY).toFixed(4)}"/>
        </Row>`);

      for (let i = 1; i < visioPoints.length; i++) {
        const pt = visioPoints[i];
        geomRows.push(`        <Row T="LineTo" IX="${i + 1}">
          <Cell N="X" V="${(pt.x - minX).toFixed(4)}"/>
          <Cell N="Y" V="${(pt.y - minY).toFixed(4)}"/>
        </Row>`);
      }

      // Conector 2D puro sin XForm1D: nunca rota sobre la diagonal
      const edgeShapeXml = `    <Shape ID="${visioId}" Type="Shape" LineStyle="3" TextStyle="3">
      <Section N="XForm">
        <Cell N="PinX" V="${pinX.toFixed(4)}"/>
        <Cell N="PinY" V="${pinY.toFixed(4)}"/>
        <Cell N="Width" V="${widthIn.toFixed(4)}"/>
        <Cell N="Height" V="${heightIn.toFixed(4)}"/>
        <Cell N="LocPinX" V="${locPinX.toFixed(4)}"/>
        <Cell N="LocPinY" V="${locPinY.toFixed(4)}"/>
        <Cell N="Angle" V="0"/>
      </Section>
      <Section N="Line">
        <Cell N="LineColor" V="${strokeColor}"/>
        <Cell N="LineWeight" V="${strokeWidthIn}"/>
        <Cell N="LinePattern" V="${isDashed ? '2' : '1'}"/>
        <Cell N="EndArrow" V="${hasEndArrow ? '4' : '0'}"/>
      </Section>
      <Section N="Fill">
        <Cell N="FillPattern" V="0"/>
      </Section>
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="1"/>
        <Cell N="NoLine" V="0"/>
${geomRows.join('\n')}
      </Section>${cell.value ? `
      <Section N="TextXForm">
        <Cell N="TxtPinX" V="${locPinX.toFixed(4)}" F="Width*0.5"/>
        <Cell N="TxtPinY" V="${locPinY.toFixed(4)}" F="Height*0.5"/>
        <Cell N="TxtWidth" V="${Math.min(widthIn, 1.5).toFixed(4)}"/>
        <Cell N="TxtHeight" V="0.3"/>
        <Cell N="TxtLocPinX" V="${(Math.min(widthIn, 1.5) / 2).toFixed(4)}" F="TxtWidth*0.5"/>
        <Cell N="TxtLocPinY" V="0.15" F="TxtHeight*0.5"/>
        <Cell N="TxtAngle" V="0"/>
      </Section>
      <Section N="Character">
        <Row IX="0">
          <Cell N="Font" V="Calibri"/>
          <Cell N="Size" V="0.125" unit="PT"/>
          <Cell N="Color" V="${strokeColor}"/>
        </Row>
      </Section>
      <Section N="Text">
        <Cell N="WrapText" V="0"/>
      </Section>
      <Text><cp IX="0"/>${escapeXml(cell.value)}</Text>` : ''}
    </Shape>`;

      shapesXmlParts.push(edgeShapeXml);
      totalConnectors++;

      // Register dynamic connects in <Connects>
      if (sourceMapped) {
        connectsXmlParts.push(`    <Connect FromSheet="${visioId}" FromCell="PinX" FromPart="3" ToSheet="${sourceMapped.visioId}" ToCell="PinX" ToPart="3"/>`);
      }
      if (targetMapped) {
        connectsXmlParts.push(`    <Connect FromSheet="${visioId}" FromCell="PinX" FromPart="3" ToSheet="${targetMapped.visioId}" ToCell="PinX" ToPart="3"/>`);
      }
    }

    const pageXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <Shapes>
${shapesXmlParts.join('\n')}
  </Shapes>
  <Connects>
${connectsXmlParts.join('\n')}
  </Connects>
</PageContents>`;

    zip.file(`visio/pages/page${pageNum}.xml`, pageXml);

    if (pageImageRels.length > 0) {
      const pageRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${pageImageRels.join('\n')}
</Relationships>`;
      zip.file(`visio/pages/_rels/page${pageNum}.xml.rels`, pageRelsXml);
    }
  }

  // 3. [Content_Types].xml with image extensions
  const imageTypesEntries = Array.from(imageExtensions).map(ext => {
    let mime = 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
    else if (ext === 'gif') mime = 'image/gif';
    else if (ext === 'bmp') mime = 'image/bmp';
    return `  <Default Extension="${ext}" ContentType="${mime}"/>`;
  }).join('\n');

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
${imageTypesEntries}
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
  logs.push(`Comprimiendo archivo binario .vsdx V3.0...`);
  const initialVsdxBlob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.ms-visio.drawing.main+xml',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  // Step 2: Pass output through vsdxPatcher to guarantee TextXForm, margins, and lock protection
  logs.push(`Aplicando control de calidad y parcheo final con VsdxPatcher...`);
  const patchedResult = await patchVsdx(initialVsdxBlob, options);

  logs.push(`Conversión V3.0 finalizada con éxito.`);

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
    imagesEmbedded: totalImagesEmbedded,
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
