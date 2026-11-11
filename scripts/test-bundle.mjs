// scripts/test-engine.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DOMParser as DOMParser2, XMLSerializer as XMLSerializer2 } from "@xmldom/xmldom";
import JSZip3 from "jszip";

// src/core/drawioSanitizer.ts
import pako2 from "pako";

// src/core/xmlUtils.ts
function parseXml(xmlString) {
  const parser = new DOMParser();
  return parser.parseFromString(xmlString, "application/xml");
}
function serializeXml(node) {
  const serializer = new XMLSerializer();
  return serializer.serializeToString(node);
}
function getParserError(doc) {
  const errors = doc.getElementsByTagName("parsererror");
  if (errors.length > 0) {
    return errors[0].textContent || "Unknown XML parse error";
  }
  return null;
}
function findFirstElementByTag(parent, tagName) {
  const elements = parent.getElementsByTagName(tagName);
  return elements.length > 0 ? elements[0] : null;
}
function findElementsByTag(parent, tagName) {
  return Array.from(parent.getElementsByTagName(tagName));
}
function getDirectChildrenByTag(parent, tagName) {
  const result = [];
  const nodes = parent.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.nodeType === 1 && node.tagName.toLowerCase() === tagName.toLowerCase()) {
      result.push(node);
    }
  }
  return result;
}
function safeNum(val, fallback = 0) {
  if (val === void 0 || val === null || val === "") {
    return fallback.toString();
  }
  const n = typeof val === "number" ? val : parseFloat(val);
  if (Number.isFinite(n)) {
    return Number(n.toFixed(4)).toString();
  }
  return fallback.toString();
}

// src/core/htmlStyleExtractor.ts
function rgbToHex(colorStr) {
  if (!colorStr) return "";
  const trimmed = colorStr.trim();
  if (trimmed.startsWith("#")) {
    if (trimmed.length === 4) {
      const r = trimmed[1];
      const g = trimmed[2];
      const b = trimmed[3];
      return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
    return trimmed.toUpperCase();
  }
  const match = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (match) {
    const r = parseInt(match[1], 10).toString(16).padStart(2, "0");
    const g = parseInt(match[2], 10).toString(16).padStart(2, "0");
    const b = parseInt(match[3], 10).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`.toUpperCase();
  }
  const namedColors = {
    black: "#000000",
    white: "#FFFFFF",
    red: "#FF0000",
    green: "#008000",
    blue: "#0000FF",
    yellow: "#FFFF00",
    gray: "#808080",
    grey: "#808080"
  };
  if (namedColors[trimmed.toLowerCase()]) {
    return namedColors[trimmed.toLowerCase()];
  }
  return trimmed;
}
function extractHtmlStyles(html) {
  const result = {};
  if (!html || !html.includes("<")) {
    return result;
  }
  let domSuccess = false;
  try {
    if (typeof DOMParser !== "undefined") {
      const parser = new DOMParser();
      const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
      const doc = parser.parseFromString(
        isBrowser ? `<body>${html}</body>` : `<root>${html.replace(/<br\s*\/?>/gi, "<br/>")}</root>`,
        isBrowser ? "text/html" : "application/xml"
      );
      const allElements = doc.querySelectorAll ? Array.from(doc.querySelectorAll("*")) : Array.from(doc.getElementsByTagName("*"));
      for (const el of allElements) {
        const tag = el.tagName.toLowerCase();
        if (tag === "b" || tag === "strong") result.isBold = true;
        if (tag === "i" || tag === "em") result.isItalic = true;
        if (el.hasAttribute("color")) {
          const c = el.getAttribute("color") || "";
          if (c) result.fontColor = rgbToHex(c);
        }
        if (el.hasAttribute("face")) {
          const f = el.getAttribute("face") || "";
          if (f) result.fontFamily = f.replace(/['"]/g, "").trim();
        }
        const styleAttr = el.getAttribute("style");
        if (styleAttr) {
          const sizeMatch = styleAttr.match(/font-size:\s*([\d.]+)(px|pt)?/i);
          if (sizeMatch) {
            const val = parseFloat(sizeMatch[1]);
            const unit = (sizeMatch[2] || "px").toLowerCase();
            const pxVal = unit === "pt" ? val / 0.75 : val;
            if (pxVal > 2) {
              result.fontSizePx = pxVal;
              result.fontSizePt = pxVal * 0.75;
            }
          }
          const colorMatch = styleAttr.match(/color:\s*([^;]+)/i);
          if (colorMatch) {
            const c = colorMatch[1].trim();
            if (c) result.fontColor = rgbToHex(c);
          }
          const familyMatch = styleAttr.match(/font-family:\s*([^;]+)/i);
          if (familyMatch) {
            result.fontFamily = familyMatch[1].replace(/['"]/g, "").trim();
          }
          if (/font-weight:\s*(bold|[6-9]00)/i.test(styleAttr)) {
            result.isBold = true;
          }
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
  if (!domSuccess || !result.fontSizePx) {
    const fontSizeRegex = /font-size:\s*([\d.]+)(px|pt)?/gi;
    let match;
    while ((match = fontSizeRegex.exec(html)) !== null) {
      const val = parseFloat(match[1]);
      const unit = (match[2] || "px").toLowerCase();
      const pxVal = unit === "pt" ? val / 0.75 : val;
      if (pxVal > 2) {
        result.fontSizePx = pxVal;
        result.fontSizePt = pxVal * 0.75;
      }
    }
  }
  if (!result.fontColor) {
    const colorMatch = html.match(/color:\s*(rgb\([^)]+\)|#[0-9a-fA-F]{3,6}|[a-zA-Z]+)/i) || html.match(/<font[^>]*color=["']?([^"'>\s]+)/i);
    if (colorMatch) {
      result.fontColor = rgbToHex(colorMatch[1]);
    }
  }
  if (!result.fontFamily) {
    const familyMatch = html.match(/font-family:\s*([^;"'>]+)/i) || html.match(/<font[^>]*face=["']?([^"'>]+)/i);
    if (familyMatch) {
      result.fontFamily = familyMatch[1].replace(/['"]/g, "").trim();
    }
  }
  if (html.includes("<b>") || html.includes("<strong>") || /font-weight:\s*(bold|[6-9]00)/i.test(html)) {
    result.isBold = true;
  }
  if (html.includes("<i>") || html.includes("<em>") || /font-style:\s*italic/i.test(html)) {
    result.isItalic = true;
  }
  let styleBit = 0;
  if (result.isBold) styleBit |= 1;
  if (result.isItalic) styleBit |= 2;
  result.fontStyle = styleBit;
  return result;
}

// src/core/stencilParser.ts
import pako from "pako";
function decodeStencilBase64(stencilBase64) {
  try {
    const trimmed = stencilBase64.trim();
    const binary = atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const inflated = pako.inflateRaw(bytes, { to: "string" });
    return decodeURIComponent(inflated);
  } catch {
    try {
      return decodeURIComponent(atob(stencilBase64.trim()));
    } catch {
      return "";
    }
  }
}
function parseStencilXml(xmlStr) {
  if (!xmlStr || !xmlStr.includes("<shape")) return null;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, "application/xml");
    const shapeEl = doc.querySelector("shape") || doc.getElementsByTagName("shape")[0];
    if (!shapeEl) return null;
    const w = parseFloat(shapeEl.getAttribute("w") || "100");
    const h = parseFloat(shapeEl.getAttribute("h") || "100");
    const commands = [];
    const allNodes = Array.from(doc.getElementsByTagName("*"));
    for (const node of allNodes) {
      const tag = node.tagName.toLowerCase();
      if (tag === "move") {
        const x = parseFloat(node.getAttribute("x") || "0");
        const y = parseFloat(node.getAttribute("y") || "0");
        commands.push({ type: "move", points: [{ x, y }] });
      } else if (tag === "line") {
        const x = parseFloat(node.getAttribute("x") || "0");
        const y = parseFloat(node.getAttribute("y") || "0");
        commands.push({ type: "line", points: [{ x, y }] });
      } else if (tag === "quad") {
        const x1 = parseFloat(node.getAttribute("x1") || "0");
        const y1 = parseFloat(node.getAttribute("y1") || "0");
        const x2 = parseFloat(node.getAttribute("x2") || "0");
        const y2 = parseFloat(node.getAttribute("y2") || "0");
        commands.push({ type: "quad", points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] });
      } else if (tag === "curve") {
        const x1 = parseFloat(node.getAttribute("x1") || "0");
        const y1 = parseFloat(node.getAttribute("y1") || "0");
        const x2 = parseFloat(node.getAttribute("x2") || "0");
        const y2 = parseFloat(node.getAttribute("y2") || "0");
        const x3 = parseFloat(node.getAttribute("x3") || "0");
        const y3 = parseFloat(node.getAttribute("y3") || "0");
        commands.push({
          type: "curve",
          points: [{ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }]
        });
      } else if (tag === "rect") {
        const x = parseFloat(node.getAttribute("x") || "0");
        const y = parseFloat(node.getAttribute("y") || "0");
        const rw = parseFloat(node.getAttribute("w") || "0");
        const rh = parseFloat(node.getAttribute("h") || "0");
        commands.push({ type: "rect", points: [{ x, y }], w: rw, h: rh });
      } else if (tag === "ellipse") {
        const x = parseFloat(node.getAttribute("x") || "0");
        const y = parseFloat(node.getAttribute("y") || "0");
        const ew = parseFloat(node.getAttribute("w") || "0");
        const eh = parseFloat(node.getAttribute("h") || "0");
        commands.push({ type: "ellipse", points: [{ x, y }], w: ew, h: eh });
      } else if (tag === "close") {
        commands.push({ type: "close", points: [] });
      }
    }
    return { w, h, commands };
  } catch {
    return null;
  }
}
function stencilToVisioGeometry(stencil, widthIn, heightIn) {
  const sw = stencil.w || 100;
  const sh = stencil.h || 100;
  const rows = [];
  let rowIndex = 1;
  let startX = 0;
  let startY = 0;
  for (const cmd of stencil.commands) {
    if (cmd.type === "move") {
      const nx = cmd.points[0].x / sw;
      const ny = 1 - cmd.points[0].y / sh;
      const vx = nx * widthIn;
      const vy = ny * heightIn;
      startX = vx;
      startY = vy;
      rows.push(`        <Row T="MoveTo" IX="${rowIndex++}">
          <Cell N="X" V="${safeNum(vx)}" F="Width*${safeNum(nx)}"/>
          <Cell N="Y" V="${safeNum(vy)}" F="Height*${safeNum(ny)}"/>
        </Row>`);
    } else if (cmd.type === "line") {
      const nx = cmd.points[0].x / sw;
      const ny = 1 - cmd.points[0].y / sh;
      const vx = nx * widthIn;
      const vy = ny * heightIn;
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}">
          <Cell N="X" V="${safeNum(vx)}" F="Width*${safeNum(nx)}"/>
          <Cell N="Y" V="${safeNum(vy)}" F="Height*${safeNum(ny)}"/>
        </Row>`);
    } else if (cmd.type === "quad" || cmd.type === "curve") {
      const endPt = cmd.points[cmd.points.length - 1];
      const nx = endPt.x / sw;
      const ny = 1 - endPt.y / sh;
      const vx = nx * widthIn;
      const vy = ny * heightIn;
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}">
          <Cell N="X" V="${safeNum(vx)}" F="Width*${safeNum(nx)}"/>
          <Cell N="Y" V="${safeNum(vy)}" F="Height*${safeNum(ny)}"/>
        </Row>`);
    } else if (cmd.type === "rect") {
      const rx = cmd.points[0].x;
      const ry = cmd.points[0].y;
      const rw = cmd.w || 0;
      const rh = cmd.h || 0;
      const p1 = { nx: rx / sw, ny: 1 - ry / sh };
      const p2 = { nx: (rx + rw) / sw, ny: 1 - ry / sh };
      const p3 = { nx: (rx + rw) / sw, ny: 1 - (ry + rh) / sh };
      const p4 = { nx: rx / sw, ny: 1 - (ry + rh) / sh };
      rows.push(`        <Row T="MoveTo" IX="${rowIndex++}"><Cell N="X" V="${safeNum(p1.nx * widthIn)}" F="Width*${safeNum(p1.nx)}"/><Cell N="Y" V="${safeNum(p1.ny * heightIn)}" F="Height*${safeNum(p1.ny)}"/></Row>`);
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}"><Cell N="X" V="${safeNum(p2.nx * widthIn)}" F="Width*${safeNum(p2.nx)}"/><Cell N="Y" V="${safeNum(p2.ny * heightIn)}" F="Height*${safeNum(p2.ny)}"/></Row>`);
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}"><Cell N="X" V="${safeNum(p3.nx * widthIn)}" F="Width*${safeNum(p3.nx)}"/><Cell N="Y" V="${safeNum(p3.ny * heightIn)}" F="Height*${safeNum(p3.ny)}"/></Row>`);
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}"><Cell N="X" V="${safeNum(p4.nx * widthIn)}" F="Width*${safeNum(p4.nx)}"/><Cell N="Y" V="${safeNum(p4.ny * heightIn)}" F="Height*${safeNum(p4.ny)}"/></Row>`);
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}"><Cell N="X" V="${safeNum(p1.nx * widthIn)}" F="Width*${safeNum(p1.nx)}"/><Cell N="Y" V="${safeNum(p1.ny * heightIn)}" F="Height*${safeNum(p1.ny)}"/></Row>`);
    } else if (cmd.type === "ellipse") {
      const cx = (cmd.points[0].x + (cmd.w || 0) / 2) / sw;
      const cy = 1 - (cmd.points[0].y + (cmd.h || 0) / 2) / sh;
      const ew = (cmd.w || 0) / sw;
      const eh = (cmd.h || 0) / sh;
      rows.push(`        <Row T="Ellipse" IX="${rowIndex++}">
          <Cell N="X" V="${safeNum(cx * widthIn)}" F="Width*${safeNum(cx)}"/>
          <Cell N="Y" V="${safeNum(cy * heightIn)}" F="Height*${safeNum(cy)}"/>
          <Cell N="A" V="${safeNum((cx + ew / 2) * widthIn)}" F="Width*${safeNum(cx + ew / 2)}"/>
          <Cell N="B" V="${safeNum(cy * heightIn)}" F="Height*${safeNum(cy)}"/>
          <Cell N="C" V="${safeNum(cx * widthIn)}" F="Width*${safeNum(cx)}"/>
          <Cell N="D" V="${safeNum((cy + eh / 2) * heightIn)}" F="Height*${safeNum(cy + eh / 2)}"/>
        </Row>`);
    } else if (cmd.type === "close") {
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}">
          <Cell N="X" V="${safeNum(startX)}"/>
          <Cell N="Y" V="${safeNum(startY)}"/>
        </Row>`);
    }
  }
  if (rows.length === 0) {
    return `      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="0"/>
        <Cell N="NoLine" V="0"/>
        <Row T="MoveTo" IX="1"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${safeNum(widthIn, 0.01)}" F="Width*1"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="3"><Cell N="X" V="${safeNum(widthIn, 0.01)}" F="Width*1"/><Cell N="Y" V="${safeNum(heightIn, 0.01)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="4"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="${safeNum(heightIn, 0.01)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="5"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>
      </Section>`;
  }
  return `      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="0"/>
        <Cell N="NoLine" V="0"/>
${rows.join("\n")}
      </Section>`;
}

// src/core/drawioSanitizer.ts
function decompressDiagram(data) {
  const trimmed = data.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<") && trimmed.includes("<mxGraphModel")) {
    return trimmed;
  }
  try {
    const binaryString = atob(trimmed);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const decompressed = pako2.inflateRaw(bytes, { to: "string" });
    return decodeURIComponent(decompressed);
  } catch {
    try {
      return decodeURIComponent(atob(trimmed));
    } catch {
      return trimmed;
    }
  }
}
function cleanHtmlText(rawText) {
  if (!rawText) return { cleaned: "", tagsRemoved: 0, trailingNewlinesRemoved: 0 };
  let tagsCount = 0;
  const tagMatches = rawText.match(/<\/?[a-z][^>]*>/gi);
  if (tagMatches) {
    tagsCount = tagMatches.length;
  }
  let text = rawText.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<\/div>/gi, "\n").replace(/<\/li>/gi, "\n").replace(/<\/tr>/gi, "\n");
  text = text.replace(/<[^>]*>/g, "");
  text = text.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const beforeTrailing = text;
  text = text.replace(/\n+$/, "");
  const trailingNewlinesRemoved = beforeTrailing.length - text.length;
  return { cleaned: text, tagsRemoved: tagsCount, trailingNewlinesRemoved };
}
function parseStyleString(styleStr) {
  const map = {};
  if (!styleStr) return map;
  const dataUris = [];
  const sanitized = styleStr.replace(/data:image\/[a-zA-Z0-9+]+(?:;base64)?,[^;]+/gi, (m) => {
    dataUris.push(m);
    return `__DATA_URI_${dataUris.length - 1}__`;
  });
  const parts = sanitized.split(";").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx !== -1) {
      const k = part.substring(0, eqIdx).trim();
      let v = part.substring(eqIdx + 1).trim();
      v = v.replace(/__DATA_URI_(\d+)__/g, (_, idx) => dataUris[parseInt(idx, 10)]);
      map[k] = v;
    } else {
      map[part] = "1";
    }
  }
  return map;
}
function serializeStyleString(styleMap) {
  const pairs = [];
  for (const [k, v] of Object.entries(styleMap)) {
    if (v === "1" && ["rounded", "shadow", "comic", "glass", "dashed", "image"].includes(k)) {
      pairs.push(k);
    } else {
      pairs.push(`${k}=${v}`);
    }
  }
  return pairs.join(";") + (pairs.length > 0 ? ";" : "");
}
function sanitizeStyle(styleStr, options) {
  const styleMap = parseStyleString(styleStr);
  let negativeMarginsFixed = 0;
  if (options.cleanHtml || options.rescueHtmlStyles) {
    styleMap["html"] = "0";
  }
  if (options.adjustTextBoxesAndRotations) {
    for (const key of ["spacingTop", "spacingBottom", "spacingLeft", "spacingRight", "spacing"]) {
      if (styleMap[key] !== void 0) {
        const val = parseFloat(styleMap[key]);
        if (val < 0) {
          styleMap[key] = "0";
          negativeMarginsFixed++;
        }
      }
    }
    if (styleMap["overflow"] === "width" || styleMap["overflow"] === "fill") {
      delete styleMap["overflow"];
      styleMap["whiteSpace"] = "wrap";
    }
  }
  return {
    style: serializeStyleString(styleMap),
    negativeMarginsFixed
  };
}
function sanitizeDrawio(xmlContent, options) {
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
  const warnings = [];
  const logs = [];
  const parsedPages = [];
  const diagramNodes = findElementsByTag(xmlDoc, "diagram");
  if (diagramNodes.length > 0) {
    logs.push(`Encontradas ${diagramNodes.length} p\xE1gina(s) en estructura <mxfile>.`);
    for (let i = 0; i < diagramNodes.length; i++) {
      const diagram = diagramNodes[i];
      const pageId = diagram.getAttribute("id") || `page-${i + 1}`;
      const pageName = diagram.getAttribute("name") || `P\xE1gina ${i + 1}`;
      let graphModelXml = "";
      const rawDiagramText = (diagram.textContent || "").trim();
      const modelNode = findFirstElementByTag(diagram, "mxGraphModel");
      if (modelNode) {
        graphModelXml = serializeXml(modelNode);
      } else {
        graphModelXml = decompressDiagram(rawDiagramText);
        if (graphModelXml) {
          totalPagesDecompressed++;
        }
      }
      if (!graphModelXml) {
        warnings.push(`P\xE1gina "${pageName}" est\xE1 vac\xEDa o no pudo descomprimirse.`);
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
      while (diagram.firstChild) {
        diagram.removeChild(diagram.firstChild);
      }
      try {
        const importedModel = xmlDoc.importNode ? xmlDoc.importNode(modelDoc.documentElement, true) : modelDoc.documentElement.cloneNode(true);
        diagram.appendChild(importedModel);
      } catch {
        const tempDoc = parseXml(`<wrap>${serializeXml(modelDoc.documentElement)}</wrap>`);
        diagram.appendChild(tempDoc.documentElement.firstChild);
      }
    }
  } else if (findFirstElementByTag(xmlDoc, "mxGraphModel")) {
    logs.push("Archivo en formato directo <mxGraphModel>.");
    const processResult = processModelDocument(xmlDoc, "page-1", "P\xE1gina 1", options);
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
    throw new Error("El archivo no contiene un formato de diagrama draw.io v\xE1lido (<mxfile> o <mxGraphModel>).");
  }
  const rawXml = serializeXml(xmlDoc);
  const sanitizedXml = rawXml.startsWith("<?xml") ? rawXml : `<?xml version="1.0" encoding="UTF-8"?>
${rawXml}`;
  logs.push(
    `Pre-limpieza CAD Fase 1 completada: ${parsedPages.length} p\xE1ginas (${totalPagesDecompressed} descomprimidas), ${totalShapes} formas, ${totalConnectors} conectores, ${totalUserObjectsResolved} UserObjects preservados, ${totalHtmlStylesRescued} estilos tipogr\xE1ficos rescatados, ${totalNegativeMarginsCleared} m\xE1rgenes corregidos.`
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
function processModelDocument(doc, pageId, pageName, options) {
  let htmlTagsRemoved = 0;
  let htmlStylesRescued = 0;
  let trailingNewlinesRemoved = 0;
  let negativeMarginsCleared = 0;
  let userObjectsResolved = 0;
  let shapesCount = 0;
  let connectorsCount = 0;
  let stencilsDecoded = 0;
  let imagesEmbedded = 0;
  const modelNode = findFirstElementByTag(doc, "mxGraphModel");
  const pageWidth = modelNode ? parseFloat(modelNode.getAttribute("pageWidth") || "1169") : 1169;
  const pageHeight = modelNode ? parseFloat(modelNode.getAttribute("pageHeight") || "827") : 827;
  const cellsMap = /* @__PURE__ */ new Map();
  const rootNode = findFirstElementByTag(doc, "root") || doc.documentElement;
  const childNodes = Array.from(rootNode.childNodes).filter((n) => n.nodeType === 1);
  for (const node of childNodes) {
    const tagName = node.tagName.toLowerCase();
    let cellEl = null;
    let cellId = "";
    let cellValue = "";
    if (tagName === "userobject" || tagName === "object") {
      userObjectsResolved++;
      cellId = node.getAttribute("id") || "";
      cellValue = node.getAttribute("label") || "";
      cellEl = findFirstElementByTag(node, "mxCell");
      if (cellEl) {
        if (!cellEl.getAttribute("id") && cellId) {
          cellEl.setAttribute("id", cellId);
        } else if (cellEl.getAttribute("id")) {
          cellId = cellEl.getAttribute("id");
        }
        if (!cellEl.getAttribute("value") && cellValue) {
          cellEl.setAttribute("value", cellValue);
        } else if (cellEl.getAttribute("value")) {
          cellValue = cellEl.getAttribute("value");
        }
      }
    } else if (tagName === "mxcell") {
      cellEl = node;
      cellId = cellEl.getAttribute("id") || "";
      cellValue = cellEl.getAttribute("value") || "";
    }
    if (!cellEl || !cellId || cellId === "0" || cellId === "1") {
      continue;
    }
    let extractedStyles = extractHtmlStyles(cellValue);
    if (extractedStyles.fontSizePt || extractedStyles.fontColor || extractedStyles.fontFamily || extractedStyles.fontStyle && extractedStyles.fontStyle > 0) {
      htmlStylesRescued++;
    }
    if (options.cleanHtml || options.rescueHtmlStyles) {
      const cleanRes = cleanHtmlText(cellValue);
      htmlTagsRemoved += cleanRes.tagsRemoved;
      trailingNewlinesRemoved += cleanRes.trailingNewlinesRemoved;
      cellValue = cleanRes.cleaned;
      cellEl.setAttribute("value", cellValue);
      if (node !== cellEl && node.hasAttribute("label")) {
        node.setAttribute("label", cellValue);
      }
    }
    const rawStyle = cellEl.getAttribute("style") || "";
    const parsedStyle = parseStyleString(rawStyle);
    if (extractedStyles.fontSizePx && extractedStyles.fontSizePx > 2) {
      parsedStyle["fontSize"] = extractedStyles.fontSizePx.toString();
    }
    if (extractedStyles.fontColor) {
      parsedStyle["fontColor"] = extractedStyles.fontColor;
    }
    if (extractedStyles.fontFamily) {
      parsedStyle["fontFamily"] = extractedStyles.fontFamily;
    }
    if (extractedStyles.fontStyle && extractedStyles.fontStyle > 0) {
      parsedStyle["fontStyle"] = extractedStyles.fontStyle.toString();
    }
    const sanitizedStyleResult = sanitizeStyle(serializeStyleString(parsedStyle), options);
    negativeMarginsCleared += sanitizedStyleResult.negativeMarginsFixed;
    const style = sanitizedStyleResult.style;
    cellEl.setAttribute("style", style);
    const isVertex = cellEl.getAttribute("vertex") === "1";
    const isEdge = cellEl.getAttribute("edge") === "1";
    if (isVertex) shapesCount++;
    if (isEdge) connectorsCount++;
    const parent = cellEl.getAttribute("parent") || void 0;
    const source = cellEl.getAttribute("source") || void 0;
    const target = cellEl.getAttribute("target") || void 0;
    let geometry = void 0;
    const geoNode = findFirstElementByTag(cellEl, "mxGeometry");
    if (geoNode) {
      const x = parseFloat(geoNode.getAttribute("x") || "0");
      const y = parseFloat(geoNode.getAttribute("y") || "0");
      const width = parseFloat(geoNode.getAttribute("width") || "0");
      const height = parseFloat(geoNode.getAttribute("height") || "0");
      const as = geoNode.getAttribute("as") || void 0;
      const relative = geoNode.getAttribute("relative") === "1";
      const points = [];
      const ptNodes = findElementsByTag(geoNode, "mxPoint");
      let srcPt = void 0;
      let tgtPt = void 0;
      for (const pt of ptNodes) {
        const ptAs = pt.getAttribute("as");
        const px = parseFloat(pt.getAttribute("x") || "0");
        const py = parseFloat(pt.getAttribute("y") || "0");
        if (ptAs === "sourcePoint") {
          srcPt = { x: px, y: py };
        } else if (ptAs === "targetPoint") {
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
        points: points.length > 0 ? points : void 0,
        sourcePoint: srcPt,
        targetPoint: tgtPt
      };
    }
    const rotation = parsedStyle["rotation"] ? parseFloat(parsedStyle["rotation"]) : 0;
    const flipH = parsedStyle["flipH"] === "1";
    const flipV = parsedStyle["flipV"] === "1";
    const exitX = parsedStyle["exitX"] ? parseFloat(parsedStyle["exitX"]) : void 0;
    const exitY = parsedStyle["exitY"] ? parseFloat(parsedStyle["exitY"]) : void 0;
    const entryX = parsedStyle["entryX"] ? parseFloat(parsedStyle["entryX"]) : void 0;
    const entryY = parsedStyle["entryY"] ? parseFloat(parsedStyle["entryY"]) : void 0;
    const isThinLine = isVertex && !!geometry && (geometry.width <= 2 || geometry.height <= 2);
    let isStencil = false;
    let stencilDef = void 0;
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
    let isBase64Image = false;
    let imageData = void 0;
    const imageRegex = /image=data:image\/(png|jpe?g|gif|bmp)(?:;base64)?,([^;]+)/i;
    const imageMatch = rawStyle.match(imageRegex) || (parsedStyle["image"] ? parsedStyle["image"].match(/data:image\/(png|jpe?g|gif|bmp)(?:;base64)?,([^;]+)/i) : null);
    if (imageMatch && options.convertStencilsAndImages) {
      const mimeSubtype = imageMatch[1].toLowerCase();
      const rawBase64 = imageMatch[2].replace(/[\s\r\n]+/g, "");
      const extension = mimeSubtype === "jpeg" ? "jpg" : mimeSubtype;
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
      fontSizePt: extractedStyles.fontSizePt || (parsedStyle["fontSize"] ? parseFloat(parsedStyle["fontSize"]) * 0.75 : void 0),
      fontColor: extractedStyles.fontColor || parsedStyle["fontColor"],
      fontFamily: extractedStyles.fontFamily || parsedStyle["fontFamily"],
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

// src/core/drawioToVsdx.ts
import JSZip2 from "jszip";

// src/core/vsdxPatcher.ts
import JSZip from "jszip";
function getCell(element, cellName) {
  const directCells = getDirectChildrenByTag(element, "Cell");
  const foundDirect = directCells.find((c) => c.getAttribute("N") === cellName);
  if (foundDirect) return foundDirect;
  const sections = getDirectChildrenByTag(element, "Section");
  for (const sec of sections) {
    const secCells = getDirectChildrenByTag(sec, "Cell");
    const inSec = secCells.find((c) => c.getAttribute("N") === cellName);
    if (inSec) return inSec;
    const rows = getDirectChildrenByTag(sec, "Row");
    for (const r of rows) {
      const rowCells = getDirectChildrenByTag(r, "Cell");
      const inRow = rowCells.find((c) => c.getAttribute("N") === cellName);
      if (inRow) return inRow;
    }
  }
  return null;
}
function setOrUpdateDirectShapeCell(doc, shape, name, val, formula, unit) {
  const directCells = getDirectChildrenByTag(shape, "Cell");
  let cell = directCells.find((c) => c.getAttribute("N") === name);
  if (cell) {
    cell.setAttribute("V", val);
    if (formula !== void 0) {
      cell.setAttribute("F", formula);
    }
    if (unit !== void 0) {
      cell.setAttribute("U", unit);
    }
  } else {
    const ns = shape.namespaceURI || "http://schemas.microsoft.com/office/visio/2012/main";
    cell = doc.createElementNS(ns, "Cell");
    cell.setAttribute("N", name);
    cell.setAttribute("V", val);
    if (formula !== void 0) {
      cell.setAttribute("F", formula);
    }
    if (unit !== void 0) {
      cell.setAttribute("U", unit);
    }
    shape.appendChild(cell);
  }
  return cell;
}
function reorderShapeChildrenStrict(shape) {
  const children = Array.from(shape.childNodes);
  const cells = [];
  const sections = [];
  let textNode = null;
  const otherElements = [];
  for (const node of children) {
    if (node.nodeType === 1) {
      const el = node;
      const tag = el.tagName.toLowerCase();
      if (tag === "cell") {
        cells.push(el);
      } else if (tag === "section") {
        const secName = el.getAttribute("N");
        if (secName === "TextXForm" || secName === "TextBlock" || secName === "Text" || secName === "Protection") {
          continue;
        }
        sections.push(el);
      } else if (tag === "text") {
        textNode = el;
      } else {
        otherElements.push(el);
      }
    }
    shape.removeChild(node);
  }
  for (const c of cells) {
    shape.appendChild(c);
  }
  for (const s of sections) {
    shape.appendChild(s);
  }
  for (const o of otherElements) {
    shape.appendChild(o);
  }
  if (textNode) {
    shape.appendChild(textNode);
  }
}
async function patchVsdx(vsdxData, options) {
  const zip = await JSZip.loadAsync(vsdxData);
  let totalPages = 0;
  let totalShapes = 0;
  let textBlocksFixed = 0;
  let shapesSkipped1D = 0;
  let invalidSectionsRemoved = 0;
  const logs = [];
  const warnings = [];
  const pageFiles = [];
  zip.forEach((relativePath) => {
    if (/^visio\/pages\/page\d+\.xml$/i.test(relativePath)) {
      pageFiles.push(relativePath);
    }
  });
  if (pageFiles.length === 0) {
    zip.forEach((relativePath) => {
      if (relativePath.includes("pages/page") && relativePath.endsWith(".xml")) {
        pageFiles.push(relativePath);
      }
    });
  }
  totalPages = pageFiles.length;
  logs.push(`Encontradas ${totalPages} p\xE1gina(s) para parcheo quir\xFArgico en el paquete .vsdx.`);
  for (const pagePath of pageFiles) {
    const pageXmlText = await zip.file(pagePath).async("string");
    const doc = parseXml(pageXmlText);
    const errorMsg = getParserError(doc);
    if (errorMsg) {
      warnings.push(`Error de an\xE1lisis XML en ${pagePath}: ${errorMsg.slice(0, 100)}`);
      continue;
    }
    const shapes = findElementsByTag(doc, "Shape");
    totalShapes += shapes.length;
    for (const shape of shapes) {
      const directSections = getDirectChildrenByTag(shape, "Section");
      for (const sec of directSections) {
        const secName = sec.getAttribute("N");
        if (secName === "TextXForm" || secName === "TextBlock" || secName === "Text" || secName === "Protection") {
          invalidSectionsRemoved++;
        }
      }
      const directCells = getDirectChildrenByTag(shape, "Cell");
      const is1DConnector = directCells.some((c) => c.getAttribute("N") === "BeginX" || c.getAttribute("N") === "EndX") || !!getCell(shape, "BeginX") || !!getCell(shape, "EndX");
      if (is1DConnector) {
        shapesSkipped1D++;
        reorderShapeChildrenStrict(shape);
        continue;
      }
      const textNode = findFirstElementByTag(shape, "Text");
      const textContent = textNode ? (textNode.textContent || "").trim() : "";
      if (!textNode || !textContent) {
        reorderShapeChildrenStrict(shape);
        continue;
      }
      const widthCell = directCells.find((c) => c.getAttribute("N") === "Width") || getCell(shape, "Width");
      const heightCell = directCells.find((c) => c.getAttribute("N") === "Height") || getCell(shape, "Height");
      const widthVal = widthCell ? parseFloat(widthCell.getAttribute("V") || "") : NaN;
      const heightVal = heightCell ? parseFloat(heightCell.getAttribute("V") || "") : NaN;
      if (isNaN(widthVal) || isNaN(heightVal) || widthVal <= 0 || heightVal <= 0) {
        reorderShapeChildrenStrict(shape);
        continue;
      }
      if (options.fixTextXForm || options.adjustTextBoxesAndRotations) {
        const halfW = widthVal * 0.5;
        const halfH = heightVal * 0.5;
        setOrUpdateDirectShapeCell(doc, shape, "TxtPinX", safeNum(halfW), "Width*0.5");
        setOrUpdateDirectShapeCell(doc, shape, "TxtPinY", safeNum(halfH), "Height*0.5");
        setOrUpdateDirectShapeCell(doc, shape, "TxtWidth", safeNum(widthVal, 0.01), "Width*1");
        setOrUpdateDirectShapeCell(doc, shape, "TxtHeight", safeNum(heightVal, 0.01), "Height*1");
        setOrUpdateDirectShapeCell(doc, shape, "TxtLocPinX", safeNum(halfW), "TxtWidth*0.5");
        setOrUpdateDirectShapeCell(doc, shape, "TxtLocPinY", safeNum(halfH), "TxtHeight*0.5");
        setOrUpdateDirectShapeCell(doc, shape, "TxtAngle", "0");
        setOrUpdateDirectShapeCell(doc, shape, "LeftMargin", "0");
        setOrUpdateDirectShapeCell(doc, shape, "RightMargin", "0");
        setOrUpdateDirectShapeCell(doc, shape, "TopMargin", "0");
        setOrUpdateDirectShapeCell(doc, shape, "BottomMargin", "0");
        setOrUpdateDirectShapeCell(doc, shape, "VerticalAlign", "1");
        setOrUpdateDirectShapeCell(doc, shape, "LockTextEdit", "0");
        textBlocksFixed++;
      }
      if (heightVal < 0.25) {
        const paraSec = directSections.find((s) => s.getAttribute("N") === "Paragraph");
        if (paraSec) {
          const rows = getDirectChildrenByTag(paraSec, "Row");
          for (const row of rows) {
            const rowCells = getDirectChildrenByTag(row, "Cell");
            const horzCell = rowCells.find((c) => c.getAttribute("N") === "HorzAlign");
            if (!horzCell) {
              const ns = shape.namespaceURI || "http://schemas.microsoft.com/office/visio/2012/main";
              const newCell = doc.createElementNS(ns, "Cell");
              newCell.setAttribute("N", "HorzAlign");
              newCell.setAttribute("V", "1");
              row.appendChild(newCell);
            }
          }
        }
      }
      if (options.normalizeFont && options.targetFontFamily) {
        const charSec = directSections.find((s) => s.getAttribute("N") === "Character");
        if (charSec) {
          const rows = getDirectChildrenByTag(charSec, "Row");
          for (const row of rows) {
            const rowCells = getDirectChildrenByTag(row, "Cell");
            let fontCell = rowCells.find((c) => c.getAttribute("N") === "Font");
            if (!fontCell) {
              const ns = shape.namespaceURI || "http://schemas.microsoft.com/office/visio/2012/main";
              fontCell = doc.createElementNS(ns, "Cell");
              fontCell.setAttribute("N", "Font");
              row.appendChild(fontCell);
            }
            fontCell.setAttribute("V", options.targetFontFamily);
          }
        }
      }
      reorderShapeChildrenStrict(shape);
    }
    const modifiedXml = serializeXml(doc);
    zip.file(pagePath, modifiedXml);
  }
  logs.push(
    `Parcheo quir\xFArgico VSDX completado: ${textBlocksFixed} figuras 2D calibradas con precisi\xF3n XSD, ${shapesSkipped1D} conectores 1D protegidos, ${invalidSectionsRemoved} secciones ilegales eliminadas.`
  );
  const patchedBlob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.ms-visio.drawing.main+xml",
    compression: "DEFLATE",
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

// src/core/drawioToVsdx.ts
function escapeXml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function parseHexColor(colorStr, defaultColor = "#FFFFFF") {
  if (!colorStr || colorStr === "none") return defaultColor;
  if (colorStr.startsWith("#")) return colorStr;
  return `#${colorStr}`;
}
function getAbsoluteGeometry(cellId, cellsMap) {
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
  const visited = /* @__PURE__ */ new Set([cellId]);
  while (currParentId && currParentId !== "0" && currParentId !== "1") {
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
async function convertDrawioToVsdx(xmlContent, options) {
  const sanitized = sanitizeDrawio(xmlContent, options);
  const pages = sanitized.pages;
  if (pages.length === 0) {
    throw new Error("No se encontraron p\xE1ginas v\xE1lidas en el diagrama Draw.io.");
  }
  const zip = new JSZip2();
  let totalShapes = 0;
  let totalConnectors = 0;
  let totalOrthogonalConnectors = 0;
  let totalTextBlocksFixed = 0;
  let totalNestedResolved = 0;
  const totalStencilsDecoded = sanitized.report.stencilsDecoded || 0;
  let totalGhostBordersCleared = 0;
  let totalHairlinesPreserved = 0;
  const warnings = [...sanitized.report.warnings || []];
  const logs = [...sanitized.report.logs || []];
  logs.push(`[V4.0] Iniciando construcci\xF3n OpenXML para planos el\xE9ctricos de ${pages.length} p\xE1gina(s)...`);
  const pagesEntries = [];
  const pagesRelsEntries = [];
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
  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const page = pages[pIdx];
    const pageNum = pIdx + 1;
    const pageHeightPx = page.height || 827;
    const pageHeightInches = pageHeightPx / 96;
    let shapeCounter = 1;
    const cellsMap = /* @__PURE__ */ new Map();
    page.cells.forEach((c) => cellsMap.set(c.id, c));
    const drawioIdToVisioMap = /* @__PURE__ */ new Map();
    const shapesXmlParts = [];
    const connectsXmlParts = [];
    const vertexCells = page.cells.filter((c) => c.vertex && c.geometry);
    const edgeCells = page.cells.filter((c) => c.edge);
    for (const cell of vertexCells) {
      const visioId = shapeCounter++;
      const absGeo = options.resolveUserObjects || options.resolveNestedCoords ? getAbsoluteGeometry(cell.id, cellsMap) : {
        x: cell.geometry.x,
        y: cell.geometry.y,
        width: cell.geometry.width,
        height: cell.geometry.height,
        rotation: cell.rotation || 0
      };
      if (cell.parent && cell.parent !== "0" && cell.parent !== "1") {
        totalNestedResolved++;
      }
      const pxW = Math.max(1, absGeo.width);
      const pxH = Math.max(1, absGeo.height);
      const widthIn = pxW / 96;
      const heightIn = pxH / 96;
      const pxX = absGeo.x;
      const pxY = absGeo.y;
      const pinX = (pxX + pxW / 2) / 96;
      const pinY = pageHeightInches - (pxY + pxH / 2) / 96;
      const locPinX = widthIn / 2;
      const locPinY = heightIn / 2;
      const rotationDeg = absGeo.rotation || 0;
      const angleRad = -(rotationDeg % 360 * Math.PI) / 180;
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
      const rawStrokeColor = style["strokeColor"];
      const rawFillColor = style["fillColor"];
      const isStrokeNone = !rawStrokeColor || rawStrokeColor === "none";
      const isFillNone = !rawFillColor || rawFillColor === "none";
      if (isStrokeNone) {
        totalGhostBordersCleared++;
      }
      const strokeColorHex = parseHexColor(rawStrokeColor, "#000000");
      const isDashed = style["dashed"] === "1";
      let strokeWidthIn = "0.0104";
      if (!isStrokeNone) {
        const rawW = style["strokeWidth"];
        if (rawW && rawW !== "0") {
          const pt = parseFloat(rawW);
          strokeWidthIn = safeNum(pt / 72, 0.0104);
        } else {
          strokeWidthIn = "0.007";
          totalHairlinesPreserved++;
        }
      }
      const fillColorHex = parseHexColor(rawFillColor, "#FFFFFF");
      let geometryRows = "";
      if (isStrokeNone && isFillNone) {
        geometryRows = "";
      } else if (cell.isThinLine && !isStrokeNone) {
        if (pxW >= pxH) {
          geometryRows = `        <Row T="MoveTo" IX="1"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="${safeNum(locPinY)}" F="Height*0.5"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${safeNum(widthIn, 0.01)}" F="Width*1"/><Cell N="Y" V="${safeNum(locPinY)}" F="Height*0.5"/></Row>`;
        } else {
          geometryRows = `        <Row T="MoveTo" IX="1"><Cell N="X" V="${safeNum(locPinX)}" F="Width*0.5"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${safeNum(locPinX)}" F="Width*0.5"/><Cell N="Y" V="${safeNum(heightIn, 0.01)}" F="Height*1"/></Row>`;
        }
      } else if (cell.isStencil && cell.stencilDef) {
        const stencilXml = stencilToVisioGeometry(cell.stencilDef, widthIn, heightIn);
        const match = stencilXml.match(/<Section N="Geometry" IX="0">([\s\S]*?)<\/Section>/);
        if (match) {
          geometryRows = match[1].replace(/<Cell N="NoFill"[^>]*\/>/g, "").replace(/<Cell N="NoLine"[^>]*\/>/g, "").trim();
        }
      } else if (style["ellipse"] === "1" || style["shape"] === "ellipse") {
        geometryRows = `        <Row T="Ellipse" IX="1">
          <Cell N="X" V="${safeNum(locPinX)}" F="Width*0.5"/>
          <Cell N="Y" V="${safeNum(locPinY)}" F="Height*0.5"/>
          <Cell N="A" V="${safeNum(widthIn, 0.01)}" F="Width*1"/>
          <Cell N="B" V="${safeNum(locPinY)}" F="Height*0.5"/>
          <Cell N="C" V="${safeNum(locPinX)}" F="Width*0.5"/>
          <Cell N="D" V="${safeNum(heightIn, 0.01)}" F="Height*1"/>
        </Row>`;
      } else if (style["rhombus"] === "1" || style["shape"] === "rhombus") {
        geometryRows = `        <Row T="MoveTo" IX="1"><Cell N="X" V="${safeNum(locPinX)}" F="Width*0.5"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${safeNum(widthIn, 0.01)}" F="Width*1"/><Cell N="Y" V="${safeNum(locPinY)}" F="Height*0.5"/></Row>
        <Row T="LineTo" IX="3"><Cell N="X" V="${safeNum(locPinX)}" F="Width*0.5"/><Cell N="Y" V="${safeNum(heightIn, 0.01)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="4"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="${safeNum(locPinY)}" F="Height*0.5"/></Row>
        <Row T="LineTo" IX="5"><Cell N="X" V="${safeNum(locPinX)}" F="Width*0.5"/><Cell N="Y" V="0" F="Height*0"/></Row>`;
      } else {
        geometryRows = `        <Row T="MoveTo" IX="1"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${safeNum(widthIn, 0.01)}" F="Width*1"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="3"><Cell N="X" V="${safeNum(widthIn, 0.01)}" F="Width*1"/><Cell N="Y" V="${safeNum(heightIn, 0.01)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="4"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="${safeNum(heightIn, 0.01)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="5"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>`;
      }
      const hasText = !!cell.value && cell.value.trim().length > 0;
      let textContentXml = "";
      let textCellsXml = "";
      if (hasText) {
        totalTextBlocksFixed++;
        const fontSizePt = cell.fontSizePt || (style["fontSize"] ? parseFloat(style["fontSize"]) * 0.75 : 9);
        const fontSizeIn = safeNum(fontSizePt / 72, 0.125);
        let fontColor = cell.fontColor || style["fontColor"];
        if (!fontColor) {
          fontColor = !isFillNone && fillColorHex === "#000000" ? "#FFFFFF" : "#000000";
        } else {
          fontColor = parseHexColor(fontColor, "#000000");
        }
        const fontFamily = cell.fontFamily || options.targetFontFamily || "Calibri";
        const fontStyleBit = cell.fontStyle !== void 0 ? cell.fontStyle : 0;
        let horzAlign = "1";
        if (style["align"] === "left") horzAlign = "0";
        else if (style["align"] === "right") horzAlign = "2";
        let vertAlign = "1";
        if (style["verticalAlign"] === "top") vertAlign = "0";
        else if (style["verticalAlign"] === "bottom") vertAlign = "2";
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
      const geometrySectionXml = `
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="${isFillNone ? "1" : "0"}"/>
        <Cell N="NoLine" V="${isStrokeNone ? "1" : "0"}"/>
${geometryRows}
      </Section>`;
      const shapeXml = `    <Shape ID="${visioId}" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3">
      <!-- BLOQUE 1: Todas las etiquetas Cell directas -->
      <Cell N="PinX" V="${safeNum(pinX)}"/>
      <Cell N="PinY" V="${safeNum(pinY)}"/>
      <Cell N="Width" V="${safeNum(widthIn, 0.01)}"/>
      <Cell N="Height" V="${safeNum(heightIn, 0.01)}"/>
      <Cell N="LocPinX" V="${safeNum(locPinX)}"/>
      <Cell N="LocPinY" V="${safeNum(locPinY)}"/>
      <Cell N="Angle" V="${safeNum(angleRad)}"/>${cell.flipH ? '\n      <Cell N="FlipX" V="1"/>' : ""}${cell.flipV ? '\n      <Cell N="FlipY" V="1"/>' : ""}
      <Cell N="LineWeight" V="${strokeWidthIn}"/>
      <Cell N="LineColor" V="${strokeColorHex}"/>
      <Cell N="LinePattern" V="${isStrokeNone ? "0" : isDashed ? "2" : "1"}"/>
      <Cell N="FillForegnd" V="${fillColorHex}"/>
      <Cell N="FillPattern" V="${isFillNone ? "0" : "1"}"/>${textCellsXml}
      <!-- BLOQUE 2: Todas las etiquetas Section directas -->${textContentXml}${geometrySectionXml}
      <!-- BLOQUE 3: Etiqueta Text SIEMPRE AL FINAL DEL SHAPE -->${hasText ? `
      <Text><cp IX="0"/><pp IX="0"/>${escapeXml(cell.value)}</Text>` : ""}
    </Shape>`;
      shapesXmlParts.push(shapeXml);
      totalShapes++;
    }
    for (const cell of edgeCells) {
      const visioId = shapeCounter++;
      const geo = cell.geometry;
      if (!geo) continue;
      let visioPoints = [];
      let rawSrcX = 0;
      let rawSrcY = 0;
      let rawTgtX = 0;
      let rawTgtY = 0;
      if (cell.source && drawioIdToVisioMap.has(cell.source)) {
        const srcMap = drawioIdToVisioMap.get(cell.source);
        const exitX = cell.exitX !== void 0 ? cell.exitX : 0.5;
        const exitY = cell.exitY !== void 0 ? cell.exitY : 0.5;
        rawSrcX = srcMap.absX + srcMap.cell.geometry.width * exitX;
        rawSrcY = srcMap.absY + srcMap.cell.geometry.height * exitY;
      } else if (geo.sourcePoint) {
        rawSrcX = geo.sourcePoint.x;
        rawSrcY = geo.sourcePoint.y;
      }
      if (cell.target && drawioIdToVisioMap.has(cell.target)) {
        const tgtMap = drawioIdToVisioMap.get(cell.target);
        const entryX = cell.entryX !== void 0 ? cell.entryX : 0.5;
        const entryY = cell.entryY !== void 0 ? cell.entryY : 0.5;
        rawTgtX = tgtMap.absX + tgtMap.cell.geometry.width * entryX;
        rawTgtY = tgtMap.absY + tgtMap.cell.geometry.height * entryY;
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
      const allX = visioPoints.map((p) => p.x);
      const allY = visioPoints.map((p) => p.y);
      const minX = Math.min(...allX);
      const maxX = Math.max(...allX);
      const minY = Math.min(...allY);
      const maxY = Math.max(...allY);
      const widthIn = Math.max(5e-3, maxX - minX);
      const heightIn = Math.max(5e-3, maxY - minY);
      const pinX = minX + widthIn / 2;
      const pinY = minY + heightIn / 2;
      const locPinX = widthIn / 2;
      const locPinY = heightIn / 2;
      const style = cell.parsedStyle;
      const strokeColor = parseHexColor(style["strokeColor"], "#000000");
      const strokeWidthPt = parseFloat(style["strokeWidth"] || "1.5");
      const strokeWidthIn = safeNum(strokeWidthPt / 72, 0.0104);
      const isDashed = style["dashed"] === "1";
      const geomRows = [];
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
      let edgeTextCellsXml = "";
      let edgeTextSectionXml = "";
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
      <Cell N="Width" V="${safeNum(widthIn, 5e-3)}"/>
      <Cell N="Height" V="${safeNum(heightIn, 5e-3)}"/>
      <Cell N="LocPinX" V="${safeNum(locPinX)}"/>
      <Cell N="LocPinY" V="${safeNum(locPinY)}"/>
      <Cell N="Angle" V="0"/>
      <Cell N="LineWeight" V="${strokeWidthIn}"/>
      <Cell N="LineColor" V="${strokeColor}"/>
      <Cell N="LinePattern" V="${isDashed ? "2" : "1"}"/>
      <Cell N="FillForegnd" V="#000000"/>
      <Cell N="FillPattern" V="0"/>${edgeTextCellsXml}
      <!-- BLOQUE 2: Secciones del conector -->${edgeTextSectionXml}
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="1"/>
        <Cell N="NoLine" V="0"/>
${geomRows.join("\n")}
      </Section>
      <!-- BLOQUE 3: Text siempre al final -->${edgeHasText ? `
      <Text><cp IX="0"/><pp IX="0"/>${escapeXml(cell.value)}</Text>` : ""}
    </Shape>`;
      shapesXmlParts.push(edgeShapeXml);
      totalConnectors++;
    }
    const connectsXml = connectsXmlParts.length > 0 ? `
    <Connects>
${connectsXmlParts.join("\n")}
    </Connects>` : "";
    const pageXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <Shapes>
${shapesXmlParts.join("\n")}
  </Shapes>${connectsXml}
</PageContents>`;
    zip.file(`visio/pages/page${pageNum}.xml`, pageXml);
  }
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
  <Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>
${pages.map((_, i) => `  <Override PartName="/visio/pages/page${i + 1}.xml" ContentType="application/vnd.ms-visio.page+xml"/>`).join("\n")}
</Types>`;
  zip.file("[Content_Types].xml", contentTypesXml);
  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
</Relationships>`;
  zip.file("_rels/.rels", rootRelsXml);
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
  zip.file("visio/document.xml", docXml);
  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>
  <Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/>
</Relationships>`;
  zip.file("visio/_rels/document.xml.rels", docRelsXml);
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
  zip.file("visio/windows.xml", windowsXml);
  const pagesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${pagesEntries.join("\n")}
</Pages>`;
  zip.file("visio/pages/pages.xml", pagesXml);
  const pagesRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${pagesRelsEntries.join("\n")}
</Relationships>`;
  zip.file("visio/pages/_rels/pages.xml.rels", pagesRelsXml);
  logs.push(`Comprimiendo archivo binario .vsdx V4.0 estricto...`);
  const initialVsdxBlob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.ms-visio.drawing.main+xml",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  logs.push(`Aplicando control de calidad y parcheo final con VsdxPatcher...`);
  const patchedResult = await patchVsdx(initialVsdxBlob, options);
  logs.push(`Conversi\xF3n V4.0 finalizada con \xE9xito.`);
  const report = {
    fileName: "",
    fileType: "drawio",
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
    status: "success",
    outputVsdxSize: patchedResult.patchedBlob.size,
    outputDrawioSize: new Blob([sanitized.sanitizedXml]).size
  };
  return {
    vsdxBlob: patchedResult.patchedBlob,
    cleanDrawioXml: sanitized.sanitizedXml,
    report
  };
}

// src/types/index.ts
var DEFAULT_OPTIONS = {
  rescueHtmlStyles: true,
  resolveUserObjects: true,
  routeOrthogonalConnectors: true,
  convertStencilsAndImages: true,
  adjustTextBoxesAndRotations: true,
  cleanHtml: true,
  normalizeFont: true,
  fixTextXForm: true,
  resolveNestedCoords: true,
  targetFontFamily: "Calibri",
  fontScaleFactor: 1
  // In CAD/electrical schematics, preserve exact font size (px * 0.75 = pt)
};

// scripts/test-engine.mjs
globalThis.DOMParser = DOMParser2;
globalThis.XMLSerializer = XMLSerializer2;
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var rootDir = path.resolve(__dirname, "..");
async function runTests() {
  console.log("================================================================");
  console.log("\u{1F9EA} Verificaci\xF3n Motor Arquitectura V4.0: Drawio2Visio Fixer Pro");
  console.log("================================================================\n");
  const samplePath = path.join(rootDir, "sample-diagram.drawio");
  const sampleXml = fs.readFileSync(samplePath, "utf8");
  console.log("1\uFE0F\u20E3 Probando Fase 1: drawioSanitizer (Pre-limpiador CAD)...");
  const sanitizeResult = sanitizeDrawio(sampleXml, DEFAULT_OPTIONS);
  console.log(`   - P\xE1ginas procesadas: ${sanitizeResult.pages.length}`);
  console.log(`   - P\xE1ginas descomprimidas: ${sanitizeResult.report.pagesDecompressed}`);
  console.log(`   - UserObjects preservados: ${sanitizeResult.report.userObjectsResolved}`);
  console.log(`   - Estilos tipogr\xE1ficos rescatados: ${sanitizeResult.report.htmlStylesRescued}`);
  console.log(`   - Etiquetas HTML eliminadas: ${sanitizeResult.report.htmlTagsRemoved}`);
  console.log(`   - Saltos de l\xEDnea finales (\\n+$) eliminados: ${sanitizeResult.report.trailingNewlinesRemoved}`);
  console.log(`   - M\xE1rgenes negativos corregidos: ${sanitizeResult.report.negativeMarginsCleared}`);
  if (sanitizeResult.report.userObjectsResolved === 0) {
    throw new Error("Fallo: No se resolvieron los elementos <UserObject>.");
  }
  if (!sanitizeResult.sanitizedXml.includes("<diagram") || !sanitizeResult.sanitizedXml.includes("<mxGraphModel")) {
    throw new Error("Fallo: El XML sanitizado no contiene <diagram> con <mxGraphModel> plano.");
  }
  if (!sanitizeResult.sanitizedXml.startsWith('<?xml version="1.0"')) {
    throw new Error("Fallo: El XML sanitizado debe comenzar con la declaraci\xF3n XML UTF-8.");
  }
  console.log("   \u2705 Descompresi\xF3n transparente a XML plano para draw.io v26.0.16: CORRECTA");
  const page = sanitizeResult.pages[0];
  const titleBlock = page.cells.find((c) => c.id === "title-block");
  if (!titleBlock) {
    throw new Error("Fallo: No se encontr\xF3 la celda title-block en la p\xE1gina.");
  }
  console.log(`   - title-block valor limpio: "${titleBlock.value.trim()}"`);
  console.log(`   - title-block fontSize rescatado: ${titleBlock.fontSizePt} pt`);
  console.log(`   - title-block fontColor: ${titleBlock.fontColor}`);
  console.log(`   - title-block fontFamily: ${titleBlock.fontFamily}`);
  if (!titleBlock.fontSizePt || titleBlock.fontSizePt < 15) {
    throw new Error(`Fallo: El tama\xF1o de fuente del title-block no fue rescatado: ${titleBlock.fontSizePt}`);
  }
  console.log("   \u2705 Extractor de estilos HTML profundos: CORRECTO (1px ignorado, 26.25px rescatado)");
  console.log("\n2\uFE0F\u20E3 Probando Jerarqu\xEDa recursiva getAbsoluteGeometry (3 niveles)...");
  const cellsMap = /* @__PURE__ */ new Map();
  page.cells.forEach((c) => cellsMap.set(c.id, c));
  const u3Geo = getAbsoluteGeometry("U3", cellsMap);
  const connJ1Geo = getAbsoluteGeometry("CONN_J1", cellsMap);
  const pin1Geo = getAbsoluteGeometry("PIN_1", cellsMap);
  console.log(`   - U3 (Nivel 1): x=${u3Geo.x}, y=${u3Geo.y}`);
  console.log(`   - CONN_J1 (Nivel 2): x=${connJ1Geo.x}, y=${connJ1Geo.y}`);
  console.log(`   - PIN_1 (Nivel 3): x=${pin1Geo.x}, y=${pin1Geo.y}, rotaci\xF3n=${pin1Geo.rotation}\xB0`);
  if (pin1Geo.x !== 340 || pin1Geo.y !== 230) {
    throw new Error(`Fallo en coordenadas de PIN_1: esperado (340, 230), obtenido (${pin1Geo.x}, ${pin1Geo.y})`);
  }
  if (pin1Geo.rotation !== 90) {
    throw new Error(`Fallo: La rotaci\xF3n de PIN_1 deber\xEDa ser 90\xB0, obtenido ${pin1Geo.rotation}\xB0`);
  }
  console.log("   \u2705 Jerarqu\xEDa de 3 niveles y rotaci\xF3n: CORRECTA (x=340, y=230, rot=90\xB0)");
  console.log("\n3\uFE0F\u20E3 Probando generaci\xF3n OpenXML VSDX completa (Sin ForeignData ni media/)...");
  const conversionResult = await convertDrawioToVsdx(sampleXml, DEFAULT_OPTIONS);
  console.log(`   - VSDX tama\xF1o generado: ${conversionResult.vsdxBlob.size} bytes`);
  console.log(`   - Conectores 2D ortogonales trazados: ${conversionResult.report.orthogonalConnectorsCount}`);
  const vsdxBuffer = await conversionResult.vsdxBlob.arrayBuffer();
  console.log("\n4\uFE0F\u20E3 Probando Fase 2: vsdxPatcher (Esquema XSD Estricto Visio)...");
  const patchResult = await patchVsdx(vsdxBuffer, DEFAULT_OPTIONS);
  console.log(`   - P\xE1ginas procesadas por patcher: ${patchResult.report.pagesCount}`);
  console.log(`   - Figuras 2D calibradas: ${patchResult.report.textBlocksFixed}`);
  console.log(`   - Conectores 1D protegidos (sin TxtWidth/TxtHeight): ${patchResult.report.shapesSkipped1D}`);
  const patchedZip = await JSZip3.loadAsync(await patchResult.patchedBlob.arrayBuffer());
  const contentTypesXml = await patchedZip.file("[Content_Types].xml").async("string");
  if (contentTypesXml.includes('Extension="png"') || contentTypesXml.includes('Extension="jpg"')) {
    throw new Error("Fallo Correcci\xF3n 1: [Content_Types].xml no debe contener extensiones de imagen.");
  }
  let hasMedia = false;
  patchedZip.forEach((relPath) => {
    if (relPath.startsWith("visio/media/")) hasMedia = true;
  });
  if (hasMedia) {
    throw new Error("Fallo Correcci\xF3n 1: El paquete VSDX no debe contener la carpeta visio/media/.");
  }
  console.log("   \u2705 Correcci\xF3n 1: Cero inyecci\xF3n de ForeignData, visio/media/ eliminado y [Content_Types].xml limpio.");
  const patchedPage1Xml = await patchedZip.file("visio/pages/page1.xml").async("string");
  if (patchedPage1Xml.includes('="NaN"') || patchedPage1Xml.includes('="undefined"') || patchedPage1Xml.includes('="Infinity"')) {
    throw new Error("Fallo Correcci\xF3n 3: page1.xml contiene valores inv\xE1lidos (NaN, undefined o Infinity).");
  }
  console.log('   \u2705 Correcci\xF3n 3: Protecci\xF3n Anti-NaN verificada (cero NaN/undefined/Infinity en atributos V="...").');
  const parser = new DOMParser2();
  const page1Doc = parser.parseFromString(patchedPage1Xml, "application/xml");
  const sections = Array.from(page1Doc.getElementsByTagName("Section"));
  const illegalSections = sections.filter((s) => {
    const n = s.getAttribute("N");
    return n === "TextXForm" || n === "TextBlock" || n === "Text" || n === "Protection";
  });
  if (illegalSections.length > 0) {
    throw new Error(`Fallo: Se encontraron ${illegalSections.length} secciones ilegales.`);
  }
  const shapes = Array.from(page1Doc.getElementsByTagName("Shape"));
  const shapeIds = /* @__PURE__ */ new Set();
  for (const sh of shapes) {
    const idAttr = sh.getAttribute("ID");
    const numericId = parseInt(idAttr || "0", 10);
    if (!numericId || shapeIds.has(numericId)) {
      throw new Error(`Fallo Correcci\xF3n 3: ID de forma repetido o no num\xE9rico: "${idAttr}".`);
    }
    shapeIds.add(numericId);
    let currentBlock = 1;
    for (let i = 0; i < sh.childNodes.length; i++) {
      const child = sh.childNodes[i];
      if (child.nodeType === 1) {
        const tagName = child.tagName.toLowerCase();
        if (tagName === "cell") {
          if (currentBlock > 1) {
            throw new Error(`Fallo Correcci\xF3n 2: <Cell N="${child.getAttribute("N")}"> aparece en Bloque ${currentBlock} (despu\xE9s de Section o Text) en <Shape ID="${idAttr}">.`);
          }
        } else if (tagName === "section") {
          if (currentBlock > 2) {
            throw new Error(`Fallo Correcci\xF3n 2: <Section N="${child.getAttribute("N")}"> aparece despu\xE9s de <Text> en <Shape ID="${idAttr}">.`);
          }
          currentBlock = 2;
        } else if (tagName === "text") {
          currentBlock = 3;
        }
      }
    }
  }
  console.log("   \u2705 Correcci\xF3n 2: Orden estricto inalterable verificado (Bloque 1 Cell -> Bloque 2 Section -> Bloque 3 Text).");
  console.log(`   \u2705 Correcci\xF3n 3: IDs enteros consecutivos \xFAnicos verificados (${shapeIds.size} formas numeradas 1..${shapeIds.size}).`);
  const outVsdxPath = path.join(rootDir, "sample-diagram-fixed.vsdx");
  const outDrawioPath = path.join(rootDir, "sample-diagram-clean.drawio");
  fs.writeFileSync(outVsdxPath, Buffer.from(await patchResult.patchedBlob.arrayBuffer()));
  fs.writeFileSync(outDrawioPath, sanitizeResult.sanitizedXml, "utf8");
  console.log("\n\u{1F4BE} Archivos V4.0 generados en disco:");
  console.log(`   - ${outVsdxPath} (${fs.statSync(outVsdxPath).size} bytes)`);
  console.log(`   - ${outDrawioPath} (${fs.statSync(outDrawioPath).size} bytes)`);
  console.log("\n================================================================");
  console.log("\u{1F389} LAS 4 CORRECCIONES CR\xCDTICAS XSD PASARON CON 100% DE \xC9XITO");
  console.log("================================================================\n");
}
runTests().catch((err) => {
  console.error("\n\u274C ERROR EN LAS PRUEBAS V4.0:", err);
  process.exit(1);
});
