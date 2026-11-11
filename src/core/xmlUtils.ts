/**
 * Robust XML helper utilities compatible with both browser DOM and DOM Level 2 implementations.
 */

export function parseXml(xmlString: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(xmlString, 'application/xml');
}

export function serializeXml(node: Node): string {
  const serializer = new XMLSerializer();
  return serializer.serializeToString(node);
}

export function getParserError(doc: Document): string | null {
  const errors = doc.getElementsByTagName('parsererror');
  if (errors.length > 0) {
    return errors[0].textContent || 'Unknown XML parse error';
  }
  return null;
}

export function findFirstElementByTag(parent: Document | Element, tagName: string): Element | null {
  const elements = parent.getElementsByTagName(tagName);
  return elements.length > 0 ? elements[0] : null;
}

export function findElementsByTag(parent: Document | Element, tagName: string): Element[] {
  return Array.from(parent.getElementsByTagName(tagName));
}

export function getDirectChildrenByTag(parent: Element, tagName: string): Element[] {
  const result: Element[] = [];
  const nodes = parent.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.nodeType === 1 && (node as Element).tagName.toLowerCase() === tagName.toLowerCase()) {
      result.push(node as Element);
    }
  }
  return result;
}

export function getFirstDirectChildByTag(parent: Element, tagName: string): Element | null {
  const nodes = parent.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.nodeType === 1 && (node as Element).tagName.toLowerCase() === tagName.toLowerCase()) {
      return node as Element;
    }
  }
  return null;
}

/**
 * Strict numeric sanitizer for Visio OpenXML attributes.
 * Prevents "NaN", "Infinity", "undefined" from ever reaching Visio XML attributes.
 */
export function safeNum(val: number | string | undefined | null, fallback = 0): string {
  if (val === undefined || val === null || val === '') {
    return fallback.toString();
  }
  const n = typeof val === 'number' ? val : parseFloat(val);
  if (Number.isFinite(n)) {
    return Number(n.toFixed(4)).toString();
  }
  return fallback.toString();
}

