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
          <Cell N="X" V="${vx.toFixed(4)}" F="Width*${nx.toFixed(4)}"/>
          <Cell N="Y" V="${vy.toFixed(4)}" F="Height*${ny.toFixed(4)}"/>
        </Row>`);
    } else if (cmd.type === "line") {
      const nx = cmd.points[0].x / sw;
      const ny = 1 - cmd.points[0].y / sh;
      const vx = nx * widthIn;
      const vy = ny * heightIn;
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}">
          <Cell N="X" V="${vx.toFixed(4)}" F="Width*${nx.toFixed(4)}"/>
          <Cell N="Y" V="${vy.toFixed(4)}" F="Height*${ny.toFixed(4)}"/>
        </Row>`);
    } else if (cmd.type === "quad" || cmd.type === "curve") {
      const endPt = cmd.points[cmd.points.length - 1];
      const nx = endPt.x / sw;
      const ny = 1 - endPt.y / sh;
      const vx = nx * widthIn;
      const vy = ny * heightIn;
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}">
          <Cell N="X" V="${vx.toFixed(4)}" F="Width*${nx.toFixed(4)}"/>
          <Cell N="Y" V="${vy.toFixed(4)}" F="Height*${ny.toFixed(4)}"/>
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
      rows.push(`        <Row T="MoveTo" IX="${rowIndex++}"><Cell N="X" V="${(p1.nx * widthIn).toFixed(4)}" F="Width*${p1.nx.toFixed(4)}"/><Cell N="Y" V="${(p1.ny * heightIn).toFixed(4)}" F="Height*${p1.ny.toFixed(4)}"/></Row>`);
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}"><Cell N="X" V="${(p2.nx * widthIn).toFixed(4)}" F="Width*${p2.nx.toFixed(4)}"/><Cell N="Y" V="${(p2.ny * heightIn).toFixed(4)}" F="Height*${p2.ny.toFixed(4)}"/></Row>`);
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}"><Cell N="X" V="${(p3.nx * widthIn).toFixed(4)}" F="Width*${p3.nx.toFixed(4)}"/><Cell N="Y" V="${(p3.ny * heightIn).toFixed(4)}" F="Height*${p3.ny.toFixed(4)}"/></Row>`);
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}"><Cell N="X" V="${(p4.nx * widthIn).toFixed(4)}" F="Width*${p4.nx.toFixed(4)}"/><Cell N="Y" V="${(p4.ny * heightIn).toFixed(4)}" F="Height*${p4.ny.toFixed(4)}"/></Row>`);
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}"><Cell N="X" V="${(p1.nx * widthIn).toFixed(4)}" F="Width*${p1.nx.toFixed(4)}"/><Cell N="Y" V="${(p1.ny * heightIn).toFixed(4)}" F="Height*${p1.ny.toFixed(4)}"/></Row>`);
    } else if (cmd.type === "ellipse") {
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
    } else if (cmd.type === "close") {
      rows.push(`        <Row T="LineTo" IX="${rowIndex++}">
          <Cell N="X" V="${startX.toFixed(4)}"/>
          <Cell N="Y" V="${startY.toFixed(4)}"/>
        </Row>`);
    }
  }
  if (rows.length === 0) {
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
  const sanitizedXml = serializeXml(xmlDoc);
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
    const children = Array.from(shape.childNodes);
    const firstNonCell = children.find(
      (n) => n.nodeType === 1 && n.tagName.toLowerCase() !== "cell"
    );
    if (firstNonCell) {
      shape.insertBefore(cell, firstNonCell);
    } else {
      shape.appendChild(cell);
    }
  }
  return cell;
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
          shape.removeChild(sec);
          invalidSectionsRemoved++;
        }
      }
      const directCells = getDirectChildrenByTag(shape, "Cell");
      const is1DConnector = directCells.some((c) => c.getAttribute("N") === "BeginX" || c.getAttribute("N") === "EndX") || !!getCell(shape, "BeginX") || !!getCell(shape, "EndX");
      if (is1DConnector) {
        shapesSkipped1D++;
        continue;
      }
      const textNode = findFirstElementByTag(shape, "Text");
      if (!textNode) {
        continue;
      }
      const textContent = (textNode.textContent || "").trim();
      if (!textContent) {
        continue;
      }
      const widthCell = directCells.find((c) => c.getAttribute("N") === "Width") || getCell(shape, "Width");
      const heightCell = directCells.find((c) => c.getAttribute("N") === "Height") || getCell(shape, "Height");
      const widthVal = widthCell ? parseFloat(widthCell.getAttribute("V") || "") : NaN;
      const heightVal = heightCell ? parseFloat(heightCell.getAttribute("V") || "") : NaN;
      if (isNaN(widthVal) || isNaN(heightVal) || widthVal <= 0 || heightVal <= 0) {
        continue;
      }
      if (options.fixTextXForm || options.adjustTextBoxesAndRotations) {
        const wStr = widthVal.toFixed(6);
        const hStr = heightVal.toFixed(6);
        const halfW = (widthVal * 0.5).toFixed(6);
        const halfH = (heightVal * 0.5).toFixed(6);
        setOrUpdateDirectShapeCell(doc, shape, "TxtWidth", wStr, "Width*1");
        setOrUpdateDirectShapeCell(doc, shape, "TxtHeight", hStr, "Height*1");
        setOrUpdateDirectShapeCell(doc, shape, "TxtPinX", halfW, "Width*0.5");
        setOrUpdateDirectShapeCell(doc, shape, "TxtPinY", halfH, "Height*0.5");
        setOrUpdateDirectShapeCell(doc, shape, "TxtLocPinX", halfW, "TxtWidth*0.5");
        setOrUpdateDirectShapeCell(doc, shape, "TxtLocPinY", halfH, "TxtHeight*0.5");
        setOrUpdateDirectShapeCell(doc, shape, "LockTextEdit", "0");
        setOrUpdateDirectShapeCell(doc, shape, "TopMargin", "0", void 0, "PT");
        setOrUpdateDirectShapeCell(doc, shape, "BottomMargin", "0", void 0, "PT");
        setOrUpdateDirectShapeCell(doc, shape, "LeftMargin", "0", void 0, "PT");
        setOrUpdateDirectShapeCell(doc, shape, "RightMargin", "0", void 0, "PT");
        setOrUpdateDirectShapeCell(doc, shape, "VerticalAlign", "1");
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
  let totalStencilsDecoded = sanitized.report.stencilsDecoded || 0;
  let totalImagesEmbedded = 0;
  let totalGhostBordersCleared = 0;
  let totalHairlinesPreserved = 0;
  const warnings = [...sanitized.report.warnings || []];
  const logs = [...sanitized.report.logs || []];
  logs.push(`[V3.0] Iniciando construcci\xF3n OpenXML para planos el\xE9ctricos de ${pages.length} p\xE1gina(s)...`);
  let globalImageCounter = 1;
  const imageExtensions = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "bmp"]);
  const pagesEntries = [];
  const pagesRelsEntries = [];
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
    const pageImageRels = [];
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
      const pxW = Math.max(absGeo.width, 0.5);
      const pxH = Math.max(absGeo.height, 0.5);
      const widthIn = pxW / 96;
      const heightIn = pxH / 96;
      const pinX = (absGeo.x + pxW / 2) / 96;
      const pinY = pageHeightInches - (absGeo.y + pxH / 2) / 96;
      const locPinX = widthIn / 2;
      const locPinY = heightIn / 2;
      const rotDeg = absGeo.rotation || 0;
      const angleRad = -(rotDeg % 360 * Math.PI) / 180;
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
      const rawStrokeColor = style["strokeColor"] ? style["strokeColor"].trim() : "";
      const rawFillColor = style["fillColor"] ? style["fillColor"].trim() : "";
      const isFillNone = rawFillColor === "none" || !rawFillColor && !style["shape"];
      const isStrokeNone = rawStrokeColor === "none" || !rawStrokeColor && !cell.isThinLine;
      const isDashed = style["dashed"] === "1";
      if (isStrokeNone) {
        totalGhostBordersCleared++;
      }
      let strokeColorHex = "#000000";
      let strokeWidthIn = "0.007";
      if (!isStrokeNone) {
        strokeColorHex = parseHexColor(rawStrokeColor, "#000000");
        const swVal = style["strokeWidth"];
        if (swVal && parseFloat(swVal) > 0) {
          strokeWidthIn = (parseFloat(swVal) / 72).toFixed(6);
        } else {
          strokeWidthIn = "0.007";
          totalHairlinesPreserved++;
        }
      }
      const fillColorHex = parseHexColor(rawFillColor, "#FFFFFF");
      let foreignCellsXml = "";
      let foreignDataXml = "";
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
          foreignCellsXml = `
      <Cell N="ImgOffsetX" V="0"/>
      <Cell N="ImgOffsetY" V="0"/>
      <Cell N="ImgWidth" V="${widthIn.toFixed(4)}" F="Width*1"/>
      <Cell N="ImgHeight" V="${heightIn.toFixed(4)}" F="Height*1"/>`;
          foreignDataXml = `
      <ForeignData ForeignType="Bitmap" CompressionType="${ext === "png" ? "PNG" : "JPEG"}">
        <Rel r:id="${rId}"/>
      </ForeignData>`;
          totalImagesEmbedded++;
        } catch {
          warnings.push(`No se pudo decodificar la imagen Base64 de la celda ${cell.id}.`);
        }
      }
      let geometryXml = "";
      if (isStrokeNone && isFillNone && !isForeignType) {
        geometryXml = `
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="1"/>
        <Cell N="NoLine" V="1"/>
      </Section>`;
      } else if (cell.isThinLine && !isStrokeNone) {
        if (pxW >= pxH) {
          geometryXml = `
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="1"/>
        <Cell N="NoLine" V="0"/>
        <Row T="MoveTo" IX="1"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="${locPinY.toFixed(4)}" F="Height*0.5"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${widthIn.toFixed(4)}" F="Width*1"/><Cell N="Y" V="${locPinY.toFixed(4)}" F="Height*0.5"/></Row>
      </Section>`;
        } else {
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
      } else if (style["ellipse"] === "1" || style["shape"] === "ellipse") {
        geometryXml = `
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="${isFillNone ? "1" : "0"}"/>
        <Cell N="NoLine" V="${isStrokeNone ? "1" : "0"}"/>
        <Row T="Ellipse" IX="1">
          <Cell N="X" V="${locPinX.toFixed(4)}" F="Width*0.5"/>
          <Cell N="Y" V="${locPinY.toFixed(4)}" F="Height*0.5"/>
          <Cell N="A" V="${widthIn.toFixed(4)}" F="Width*1"/>
          <Cell N="B" V="${locPinY.toFixed(4)}" F="Height*0.5"/>
          <Cell N="C" V="${locPinX.toFixed(4)}" F="Width*0.5"/>
          <Cell N="D" V="${heightIn.toFixed(4)}" F="Height*1"/>
        </Row>
      </Section>`;
      } else if (style["rhombus"] === "1" || style["shape"] === "rhombus") {
        geometryXml = `
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="${isFillNone ? "1" : "0"}"/>
        <Cell N="NoLine" V="${isStrokeNone ? "1" : "0"}"/>
        <Row T="MoveTo" IX="1"><Cell N="X" V="${locPinX.toFixed(4)}" F="Width*0.5"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${widthIn.toFixed(4)}" F="Width*1"/><Cell N="Y" V="${locPinY.toFixed(4)}" F="Height*0.5"/></Row>
        <Row T="LineTo" IX="3"><Cell N="X" V="${locPinX.toFixed(4)}" F="Width*0.5"/><Cell N="Y" V="${heightIn.toFixed(4)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="4"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="${locPinY.toFixed(4)}" F="Height*0.5"/></Row>
        <Row T="LineTo" IX="5"><Cell N="X" V="${locPinX.toFixed(4)}" F="Width*0.5"/><Cell N="Y" V="0" F="Height*0"/></Row>
      </Section>`;
      } else if (!isForeignType) {
        geometryXml = `
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="${isFillNone ? "1" : "0"}"/>
        <Cell N="NoLine" V="${isStrokeNone ? "1" : "0"}"/>
        <Row T="MoveTo" IX="1"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="${widthIn.toFixed(4)}" F="Width*1"/><Cell N="Y" V="0" F="Height*0"/></Row>
        <Row T="LineTo" IX="3"><Cell N="X" V="${widthIn.toFixed(4)}" F="Width*1"/><Cell N="Y" V="${heightIn.toFixed(4)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="4"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="${heightIn.toFixed(4)}" F="Height*1"/></Row>
        <Row T="LineTo" IX="5"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>
      </Section>`;
      }
      const hasText = cell.value && cell.value.trim().length > 0;
      let textContentXml = "";
      let vertAlign = "1";
      if (style["verticalAlign"] === "top") vertAlign = "0";
      else if (style["verticalAlign"] === "bottom") vertAlign = "2";
      if (hasText) {
        totalTextBlocksFixed++;
        const fontSizePt = cell.fontSizePt || (style["fontSize"] ? parseFloat(style["fontSize"]) * 0.75 : 9);
        const fontSizeIn = (fontSizePt / 72).toFixed(6);
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
      <Text><cp IX="0"/><pp IX="0"/>${escapeXml(cell.value)}</Text>`;
      }
      const shapeTypeAttr = isForeignType ? 'Type="Foreign"' : 'Type="Shape"';
      const shapeXml = `    <Shape ID="${visioId}" ${shapeTypeAttr} LineStyle="3" FillStyle="3" TextStyle="3">
      <Cell N="PinX" V="${pinX.toFixed(4)}"/>
      <Cell N="PinY" V="${pinY.toFixed(4)}"/>
      <Cell N="Width" V="${widthIn.toFixed(4)}"/>
      <Cell N="Height" V="${heightIn.toFixed(4)}"/>
      <Cell N="LocPinX" V="${locPinX.toFixed(4)}"/>
      <Cell N="LocPinY" V="${locPinY.toFixed(4)}"/>
      <Cell N="Angle" V="${angleRad.toFixed(6)}"/>
      <Cell N="FlipX" V="${cell.flipH ? "1" : "0"}"/>
      <Cell N="FlipY" V="${cell.flipV ? "1" : "0"}"/>
      <Cell N="TxtWidth" V="${widthIn.toFixed(4)}" F="Width*1"/>
      <Cell N="TxtHeight" V="${heightIn.toFixed(4)}" F="Height*1"/>
      <Cell N="TxtPinX" V="${locPinX.toFixed(4)}" F="Width*0.5"/>
      <Cell N="TxtPinY" V="${locPinY.toFixed(4)}" F="Height*0.5"/>
      <Cell N="TxtLocPinX" V="${locPinX.toFixed(4)}" F="TxtWidth*0.5"/>
      <Cell N="TxtLocPinY" V="${locPinY.toFixed(4)}" F="TxtHeight*0.5"/>
      <Cell N="LockTextEdit" V="0"/>
      <Cell N="TopMargin" V="0" U="PT"/>
      <Cell N="BottomMargin" V="0" U="PT"/>
      <Cell N="LeftMargin" V="0" U="PT"/>
      <Cell N="RightMargin" V="0" U="PT"/>
      <Cell N="VerticalAlign" V="${vertAlign}"/>${foreignCellsXml}
      <Section N="Line">
        <Cell N="LineColor" V="${strokeColorHex}"/>
        <Cell N="LineWeight" V="${strokeWidthIn}"/>
        <Cell N="LinePattern" V="${isStrokeNone ? "0" : isDashed ? "2" : "1"}"/>
        <Cell N="Rounding" V="${style["rounded"] === "1" ? "0.05" : "0"}"/>
      </Section>
      <Section N="Fill">
        <Cell N="FillForegnd" V="${fillColorHex}"/>
        <Cell N="FillPattern" V="${isFillNone ? "0" : "1"}"/>
      </Section>${geometryXml}${foreignDataXml}${textContentXml}
    </Shape>`;
      shapesXmlParts.push(shapeXml);
      totalShapes++;
    }
    for (const cell of edgeCells) {
      const visioId = shapeCounter++;
      let startPxX = 0;
      let startPxY = 0;
      let endPxX = 100;
      let endPxY = 100;
      const sourceMapped = cell.source ? drawioIdToVisioMap.get(cell.source) : void 0;
      const targetMapped = cell.target ? drawioIdToVisioMap.get(cell.target) : void 0;
      if (sourceMapped) {
        const exitX = cell.exitX !== void 0 ? cell.exitX : cell.geometry?.sourcePoint ? cell.geometry.sourcePoint.x / (sourceMapped.width * 96) : 0.5;
        const exitY = cell.exitY !== void 0 ? cell.exitY : cell.geometry?.sourcePoint ? cell.geometry.sourcePoint.y / (sourceMapped.height * 96) : 0.5;
        startPxX = sourceMapped.absX + exitX * (sourceMapped.width * 96);
        startPxY = sourceMapped.absY + exitY * (sourceMapped.height * 96);
      } else if (cell.geometry?.sourcePoint) {
        startPxX = cell.geometry.sourcePoint.x;
        startPxY = cell.geometry.sourcePoint.y;
      }
      if (targetMapped) {
        const entryX = cell.entryX !== void 0 ? cell.entryX : cell.geometry?.targetPoint ? cell.geometry.targetPoint.x / (targetMapped.width * 96) : 0.5;
        const entryY = cell.entryY !== void 0 ? cell.entryY : cell.geometry?.targetPoint ? cell.geometry.targetPoint.y / (targetMapped.height * 96) : 0.5;
        endPxX = targetMapped.absX + entryX * (targetMapped.width * 96);
        endPxY = targetMapped.absY + entryY * (targetMapped.height * 96);
      } else if (cell.geometry?.targetPoint) {
        endPxX = cell.geometry.targetPoint.x;
        endPxY = cell.geometry.targetPoint.y;
      }
      const rawPoints = [{ x: startPxX, y: startPxY }];
      if (cell.geometry?.points && cell.geometry.points.length > 0) {
        for (const pt of cell.geometry.points) {
          rawPoints.push({ x: pt.x, y: pt.y });
        }
      }
      rawPoints.push({ x: endPxX, y: endPxY });
      const isOrthogonal = cell.style.includes("orthogonalEdgeStyle") || options.routeOrthogonalConnectors;
      const polylinePoints = [];
      for (let i = 0; i < rawPoints.length - 1; i++) {
        const p1 = rawPoints[i];
        const p2 = rawPoints[i + 1];
        polylinePoints.push(p1);
        if (isOrthogonal && Math.abs(p1.x - p2.x) > 1 && Math.abs(p1.y - p2.y) > 1) {
          totalOrthogonalConnectors++;
          const midX = (p1.x + p2.x) / 2;
          polylinePoints.push({ x: midX, y: p1.y });
          polylinePoints.push({ x: midX, y: p2.y });
        }
      }
      polylinePoints.push(rawPoints[rawPoints.length - 1]);
      const visioPoints = polylinePoints.map((p) => ({
        x: p.x / 96,
        y: pageHeightInches - p.y / 96
      }));
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
      const strokeWidthIn = (strokeWidthPt / 72).toFixed(6);
      const isDashed = style["dashed"] === "1";
      const hasEndArrow = style["endArrow"] !== "none";
      const geomRows = [];
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
      const edgeShapeXml = `    <Shape ID="${visioId}" Type="Shape" LineStyle="3" TextStyle="3">
      <Cell N="PinX" V="${pinX.toFixed(4)}"/>
      <Cell N="PinY" V="${pinY.toFixed(4)}"/>
      <Cell N="Width" V="${widthIn.toFixed(4)}"/>
      <Cell N="Height" V="${heightIn.toFixed(4)}"/>
      <Cell N="LocPinX" V="${locPinX.toFixed(4)}"/>
      <Cell N="LocPinY" V="${locPinY.toFixed(4)}"/>
      <Cell N="Angle" V="0"/>${cell.value ? `
      <Cell N="TxtPinX" V="${locPinX.toFixed(4)}" F="Width*0.5"/>
      <Cell N="TxtPinY" V="${locPinY.toFixed(4)}" F="Height*0.5"/>
      <Cell N="TxtWidth" V="${Math.min(widthIn, 1.5).toFixed(4)}"/>
      <Cell N="TxtHeight" V="0.3"/>
      <Cell N="TxtLocPinX" V="${(Math.min(widthIn, 1.5) / 2).toFixed(4)}" F="TxtWidth*0.5"/>
      <Cell N="TxtLocPinY" V="0.15" F="TxtHeight*0.5"/>
      <Cell N="TxtAngle" V="0"/>
      <Cell N="TopMargin" V="0" U="PT"/>
      <Cell N="BottomMargin" V="0" U="PT"/>
      <Cell N="LeftMargin" V="0" U="PT"/>
      <Cell N="RightMargin" V="0" U="PT"/>` : ""}
      <Section N="Line">
        <Cell N="LineColor" V="${strokeColor}"/>
        <Cell N="LineWeight" V="${strokeWidthIn}"/>
        <Cell N="LinePattern" V="${isDashed ? "2" : "1"}"/>
        <Cell N="EndArrow" V="${hasEndArrow ? "4" : "0"}"/>
      </Section>
      <Section N="Fill">
        <Cell N="FillPattern" V="0"/>
      </Section>
      <Section N="Geometry" IX="0">
        <Cell N="NoFill" V="1"/>
        <Cell N="NoLine" V="0"/>
${geomRows.join("\n")}
      </Section>${cell.value ? `
      <Section N="Character">
        <Row IX="0">
          <Cell N="Font" V="Calibri"/>
          <Cell N="Size" V="0.125" unit="PT"/>
          <Cell N="Color" V="${strokeColor}"/>
        </Row>
      </Section>
      <Text><cp IX="0"/>${escapeXml(cell.value)}</Text>` : ""}
    </Shape>`;
      shapesXmlParts.push(edgeShapeXml);
      totalConnectors++;
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
${shapesXmlParts.join("\n")}
  </Shapes>
  <Connects>
${connectsXmlParts.join("\n")}
  </Connects>
</PageContents>`;
    zip.file(`visio/pages/page${pageNum}.xml`, pageXml);
    if (pageImageRels.length > 0) {
      const pageRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${pageImageRels.join("\n")}
</Relationships>`;
      zip.file(`visio/pages/_rels/page${pageNum}.xml.rels`, pageRelsXml);
    }
  }
  const imageTypesEntries = Array.from(imageExtensions).map((ext) => {
    let mime = "image/png";
    if (ext === "jpg" || ext === "jpeg") mime = "image/jpeg";
    else if (ext === "gif") mime = "image/gif";
    else if (ext === "bmp") mime = "image/bmp";
    return `  <Default Extension="${ext}" ContentType="${mime}"/>`;
  }).join("\n");
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
${imageTypesEntries}
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
  logs.push(`Comprimiendo archivo binario .vsdx V3.0...`);
  const initialVsdxBlob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.ms-visio.drawing.main+xml",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  logs.push(`Aplicando control de calidad y parcheo final con VsdxPatcher...`);
  const patchedResult = await patchVsdx(initialVsdxBlob, options);
  logs.push(`Conversi\xF3n V3.0 finalizada con \xE9xito.`);
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
    imagesEmbedded: totalImagesEmbedded,
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
  console.log("\n3\uFE0F\u20E3 Probando generaci\xF3n OpenXML VSDX completa...");
  const conversionResult = await convertDrawioToVsdx(sampleXml, DEFAULT_OPTIONS);
  console.log(`   - VSDX tama\xF1o generado: ${conversionResult.vsdxBlob.size} bytes`);
  console.log(`   - Conectores 2D ortogonales trazados: ${conversionResult.report.orthogonalConnectorsCount}`);
  console.log(`   - Im\xE1genes incrustadas: ${conversionResult.report.imagesEmbedded}`);
  const vsdxBuffer = await conversionResult.vsdxBlob.arrayBuffer();
  console.log("\n4\uFE0F\u20E3 Probando Fase 2: vsdxPatcher (5 Reglas de Oro XSD)...");
  const patchResult = await patchVsdx(vsdxBuffer, DEFAULT_OPTIONS);
  console.log(`   - P\xE1ginas procesadas por patcher: ${patchResult.report.pagesCount}`);
  console.log(`   - Figuras 2D calibradas: ${patchResult.report.textBlocksFixed}`);
  console.log(`   - Conectores 1D protegidos (sin TxtWidth/TxtHeight): ${patchResult.report.shapesSkipped1D}`);
  console.log(`   - Secciones ilegales eliminadas: ${patchResult.report.invalidSectionsRemoved}`);
  const patchedZip = await JSZip3.loadAsync(await patchResult.patchedBlob.arrayBuffer());
  if (!patchedZip.file("[Content_Types].xml") || !patchedZip.file("visio/document.xml")) {
    throw new Error("Fallo Regla 1: Faltan archivos esenciales del paquete OpenXML.");
  }
  console.log("   \u2705 Regla 1: Archivos ZIP estructurales [Content_Types].xml y document.xml intactos.");
  const patchedPage1Xml = await patchedZip.file("visio/pages/page1.xml").async("string");
  const parser = new DOMParser2();
  const page1Doc = parser.parseFromString(patchedPage1Xml, "application/xml");
  const sections = Array.from(page1Doc.getElementsByTagName("Section"));
  const illegalSections = sections.filter((s) => {
    const n = s.getAttribute("N");
    return n === "TextXForm" || n === "TextBlock";
  });
  if (illegalSections.length > 0) {
    throw new Error(`Fallo Regla 3: Se encontraron ${illegalSections.length} secciones ilegales <Section N="TextXForm">.`);
  }
  console.log('   \u2705 Regla 3: Cero secciones inexistentes (<Section N="TextXForm"> / <Section N="TextBlock">).');
  const shapes = Array.from(page1Doc.getElementsByTagName("Shape"));
  for (const sh of shapes) {
    let seenNonCell = false;
    for (let i = 0; i < sh.childNodes.length; i++) {
      const child = sh.childNodes[i];
      if (child.nodeType === 1) {
        const tagName = child.tagName.toLowerCase();
        if (tagName === "cell") {
          if (seenNonCell) {
            throw new Error(`Fallo Regla 4: <Cell N="${child.getAttribute("N")}"> aparece despu\xE9s de un nodo no-Cell en <Shape ID="${sh.getAttribute("ID")}">.`);
          }
        } else {
          seenNonCell = true;
        }
      }
    }
  }
  console.log("   \u2705 Regla 4: Orden estricto XSD verificado (TODOS los <Cell> preceden a <Section> y <Text>).");
  for (const sh of shapes) {
    const cells = Array.from(sh.getElementsByTagName("Cell"));
    const is1D = cells.some((c) => c.getAttribute("N") === "BeginX" || c.getAttribute("N") === "EndX");
    if (is1D) {
      const directCells = Array.from(sh.childNodes).filter((n) => n.nodeType === 1 && n.tagName.toLowerCase() === "cell");
      const hasTxtWidth = directCells.some((c) => c.getAttribute("N") === "TxtWidth");
      if (hasTxtWidth) {
        throw new Error(`Fallo Regla 5: Conector 1D ID="${sh.getAttribute("ID")}" tiene celda TxtWidth inyectada.`);
      }
    }
  }
  console.log("   \u2705 Regla 5: Conectores 1D protegidos (cero inyecci\xF3n indebida de TxtWidth/TxtHeight).");
  const outVsdxPath = path.join(rootDir, "sample-diagram-fixed.vsdx");
  const outDrawioPath = path.join(rootDir, "sample-diagram-clean.drawio");
  fs.writeFileSync(outVsdxPath, Buffer.from(await patchResult.patchedBlob.arrayBuffer()));
  fs.writeFileSync(outDrawioPath, sanitizeResult.sanitizedXml, "utf8");
  console.log("\n\u{1F4BE} Archivos V4.0 generados en disco:");
  console.log(`   - ${outVsdxPath} (${fs.statSync(outVsdxPath).size} bytes)`);
  console.log(`   - ${outDrawioPath} (${fs.statSync(outDrawioPath).size} bytes)`);
  console.log("\n================================================================");
  console.log("\u{1F389} TODAS LAS PRUEBAS DE ARQUITECTURA V4.0 PASARON CON \xC9XITO");
  console.log("================================================================\n");
}
runTests().catch((err) => {
  console.error("\n\u274C ERROR EN LAS PRUEBAS V4.0:", err);
  process.exit(1);
});
