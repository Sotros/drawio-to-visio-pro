import pako from 'pako';
import { StencilDefinition, StencilPathCommand } from '../types';

/**
 * Decodes base64-compressed draw.io stencil string:
 * atob -> Uint8Array -> pako.inflateRaw -> decodeURIComponent
 */
export function decodeStencilBase64(stencilBase64: string): string {
  try {
    const trimmed = stencilBase64.trim();
    const binary = atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const inflated = pako.inflateRaw(bytes, { to: 'string' });
    return decodeURIComponent(inflated);
  } catch {
    // If not raw deflate, try standard inflate or plain decode
    try {
      return decodeURIComponent(atob(stencilBase64.trim()));
    } catch {
      return '';
    }
  }
}

/**
 * Parses draw.io stencil XML string into structured definition
 */
export function parseStencilXml(xmlStr: string): StencilDefinition | null {
  if (!xmlStr || !xmlStr.includes('<shape')) return null;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'application/xml');
    const shapeEl = doc.querySelector('shape') || doc.getElementsByTagName('shape')[0];
    if (!shapeEl) return null;

    const w = parseFloat(shapeEl.getAttribute('w') || '100');
    const h = parseFloat(shapeEl.getAttribute('h') || '100');

    const commands: StencilPathCommand[] = [];

    // Parse all path, rect, ellipse nodes in foreground/background
    const allNodes = Array.from(doc.getElementsByTagName('*'));

    for (const node of allNodes) {
      const tag = node.tagName.toLowerCase();

      if (tag === 'move') {
        const x = parseFloat(node.getAttribute('x') || '0');
        const y = parseFloat(node.getAttribute('y') || '0');
        commands.push({ type: 'move', points: [{ x, y }] });
      } else if (tag === 'line') {
        const x = parseFloat(node.getAttribute('x') || '0');
        const y = parseFloat(node.getAttribute('y') || '0');
        commands.push({ type: 'line', points: [{ x, y }] });
      } else if (tag === 'quad') {
        const x1 = parseFloat(node.getAttribute('x1') || '0');
        const y1 = parseFloat(node.getAttribute('y1') || '0');
        const x2 = parseFloat(node.getAttribute('x2') || '0');
        const y2 = parseFloat(node.getAttribute('y2') || '0');
        commands.push({ type: 'quad', points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] });
      } else if (tag === 'curve') {
        const x1 = parseFloat(node.getAttribute('x1') || '0');
        const y1 = parseFloat(node.getAttribute('y1') || '0');
        const x2 = parseFloat(node.getAttribute('x2') || '0');
        const y2 = parseFloat(node.getAttribute('y2') || '0');
        const x3 = parseFloat(node.getAttribute('x3') || '0');
        const y3 = parseFloat(node.getAttribute('y3') || '0');
        commands.push({
          type: 'curve',
          points: [{ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }]
        });
      } else if (tag === 'rect') {
        const x = parseFloat(node.getAttribute('x') || '0');
        const y = parseFloat(node.getAttribute('y') || '0');
        const rw = parseFloat(node.getAttribute('w') || '0');
        const rh = parseFloat(node.getAttribute('h') || '0');
        commands.push({ type: 'rect', points: [{ x, y }], w: rw, h: rh });
      } else if (tag === 'ellipse') {
        const x = parseFloat(node.getAttribute('x') || '0');
        const y = parseFloat(node.getAttribute('y') || '0');
        const ew = parseFloat(node.getAttribute('w') || '0');
        const eh = parseFloat(node.getAttribute('h') || '0');
        commands.push({ type: 'ellipse', points: [{ x, y }], w: ew, h: eh });
      } else if (tag === 'close') {
        commands.push({ type: 'close', points: [] });
      }
    }

    return { w, h, commands };
  } catch {
    return null;
  }
}

/**
 * Converts a StencilDefinition into Visio OpenXML <Section N="Geometry" IX="0"> rows.
 * Inverts Y coordinates to match Visio's bottom-left origin.
 */
export function stencilToVisioGeometry(
  stencil: StencilDefinition,
  widthIn: number,
  heightIn: number
): string {
  const sw = stencil.w || 100;
  const sh = stencil.h || 100;

  const rows: string[] = [];
  let rowIndex = 1;
  let startX = 0;
  let startY = 0;

  for (const cmd of stencil.commands) {
    if (cmd.type === 'move') {
      const nx = cmd.points[0].x / sw;
      const ny = 1 - cmd.points[0].y / sh;
      const vx = nx * widthIn;
      const vy = ny * heightIn;
      startX = vx;
      startY = vy;

      rows.push(`        <Row T="MoveTo" IX="${rowIndex++}">
          <Cell N="X" V="${vx.toFixed(4)}" F="Width*${nx.toFixed(4)}"/>
          <Cell N="Y" V="${vy.toFixed(4)}" F="Height*${ny.toFixed(4)}"/>
        </Row>`);
    } else if (cmd.type === 'line') {
      const nx = cmd.points[0].x / sw;
      const ny = 1 - cmd.points[0].y / sh;
      const vx = nx * widthIn;
      const vy = ny * heightIn;

      rows.push(`        <Row T="LineTo" IX="${rowIndex++}">
          <Cell N="X" V="${vx.toFixed(4)}" F="Width*${nx.toFixed(4)}"/>
          <Cell N="Y" V="${vy.toFixed(4)}" F="Height*${ny.toFixed(4)}"/>
        </Row>`);
    } else if (cmd.type === 'quad' || cmd.type === 'curve') {
      // Approximate curves with destination LineTo (or multi-segment) for maximum Visio stability
      const endPt = cmd.points[cmd.points.length - 1];
      const nx = endPt.x / sw;
      const ny = 1 - endPt.y / sh;
      const vx = nx * widthIn;
      const vy = ny * heightIn;

      rows.push(`        <Row T="LineTo" IX="${rowIndex++}">
          <Cell N="X" V="${vx.toFixed(4)}" F="Width*${nx.toFixed(4)}"/>
          <Cell N="Y" V="${vy.toFixed(4)}" F="Height*${ny.toFixed(4)}"/>
        </Row>`);
    } else if (cmd.type === 'rect') {
      const rx = cmd.points[0].x;
      const ry = cmd.points[0].y;
      const rw = cmd.w || 0;
      const rh = cmd.h || 0;

      // 4 lines of rectangle
      const p1 = { nx: rx / sw, ny: 1 - ry / sh };
      const p2 = { nx: (rx + rw) / sw, ny: 1 - ry / sh };
      const p3 = { nx: (rx + rw) / sw, ny: 1 - (ry + rh) / sh };
      const p4 = { nx: rx / sw, ny: 1 - (ry + rh) / sh };

      rows.push(`        <Row T="MoveTo" IX="${rowIndex++}"><Cell N="X" V="${(p1.nx * widthIn).toFixed(4)}" F="Width*${p1.nx.toFixed(4)}"/><Cell N="Y" V="${(p1.ny * heightIn).toFixed(4)}" F="Height*${p1.ny.toFixed(4)}"/></Row>`);
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}"><Cell N="X" V="${(p2.nx * widthIn).toFixed(4)}" F="Width*${p2.nx.toFixed(4)}"/><Cell N="Y" V="${(p2.ny * heightIn).toFixed(4)}" F="Height*${p2.ny.toFixed(4)}"/></Row>`);
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}"><Cell N="X" V="${(p3.nx * widthIn).toFixed(4)}" F="Width*${p3.nx.toFixed(4)}"/><Cell N="Y" V="${(p3.ny * heightIn).toFixed(4)}" F="Height*${p3.ny.toFixed(4)}"/></Row>`);
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}"><Cell N="X" V="${(p4.nx * widthIn).toFixed(4)}" F="Width*${p4.nx.toFixed(4)}"/><Cell N="Y" V="${(p4.ny * heightIn).toFixed(4)}" F="Height*${p4.ny.toFixed(4)}"/></Row>`);
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}"><Cell N="X" V="${(p1.nx * widthIn).toFixed(4)}" F="Width*${p1.nx.toFixed(4)}"/><Cell N="Y" V="${(p1.ny * heightIn).toFixed(4)}" F="Height*${p1.ny.toFixed(4)}"/></Row>`);
    } else if (cmd.type === 'ellipse') {
      const cx = (cmd.points[0].x + (cmd.w || 0) / 2) / sw;
      const cy = 1 - (cmd.points[0].y + (cmd.h || 0) / 2) / sh;
      const ew = (cmd.w || 0) / sw;
      const eh = (cmd.h || 0) / sh;

      rows.push(`        <Row T="Ellipse" IX="${rowIndex++}">
          <Cell N="X" V="${(cx * widthIn).toFixed(4)}" F="Width*${cx.toFixed(4)}"/>
          <Cell N="Y" V="${(cy * heightIn).toFixed(4)}" F="Height*${cy.toFixed(4)}"/>
          <Cell N="A" V="${((cx + ew / 2) * widthIn).toFixed(4)}" F="Width*${(cx + ew / 2).toFixed(4)}"/>
          <Cell N="B" V="${(cy * heightIn).toFixed(4)}" F="Height*${cy.toFixed(4)}"/>
          <Cell N="C" V="${(cx * widthIn).toFixed(4)}" F="Width*${cx.toFixed(4)}"/>
          <Cell N="D" V="${((cy + eh / 2) * heightIn).toFixed(4)}" F="Height*${(cy + eh / 2).toFixed(4)}"/>
        </Row>`);
    } else if (cmd.type === 'close') {
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}">
          <Cell N="X" V="${startX.toFixed(4)}"/>
          <Cell N="Y" V="${startY.toFixed(4)}"/>
        </Row>`);
    }
  }

  if (rows.length === 0) {
    // Fallback: standard rectangle
    return `      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="0"/>
        <Cell N="NoLine" V="0"/>
        <Row T="MoveTo" IX="1"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${widthIn.toFixed(4)}" F="Width*1"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="3"><Cell N="X" V="${widthIn.toFixed(4)}" F="Width*1"/><Cell N="Y" V="${heightIn.toFixed(4)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="4"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="${heightIn.toFixed(4)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="5"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>
      </Section>`;
  }

  return `      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="0"/>
        <Cell N="NoLine" V="0"/>
${rows.join('\n')}
      </Section>`;
}

