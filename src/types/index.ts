export interface ConversionOptions {
  // 1. Rescatar tamaños, colores y estilos desde etiquetas HTML internas
  rescueHtmlStyles: boolean;
  // 2. Resolver UserObjects y coordenadas de grupos anidados (3+ niveles)
  resolveUserObjects: boolean;
  // 3. Trazar conectores ortogonales y puntos de codo (<Array as='points'>)
  routeOrthogonalConnectors: boolean;
  // 4. Convertir stencils, líneas de cajetín e incrustar imágenes Base64
  convertStencilsAndImages: boolean;
  // 5. Ajustar cajas de texto sin márgenes negativos y aplicar rotaciones (90°/270°)
  adjustTextBoxesAndRotations: boolean;

  // Additional settings
  cleanHtml: boolean;
  normalizeFont: boolean;
  fixTextXForm: boolean;
  resolveNestedCoords: boolean;
  targetFontFamily: string;
  fontScaleFactor: number;
}

export const DEFAULT_OPTIONS: ConversionOptions = {
  rescueHtmlStyles: true,
  resolveUserObjects: true,
  routeOrthogonalConnectors: true,
  convertStencilsAndImages: true,
  adjustTextBoxesAndRotations: true,

  cleanHtml: true,
  normalizeFont: true,
  fixTextXForm: true,
  resolveNestedCoords: true,
  targetFontFamily: 'Calibri',
  fontScaleFactor: 1.0, // In CAD/electrical schematics, preserve exact font size (px * 0.75 = pt)
};

export interface DiagnosticReport {
  fileName: string;
  fileType: 'drawio' | 'vsdx' | 'xml';
  pagesCount: number;
  userObjectsResolved: number;
  htmlStylesRescued: number;
  htmlTagsRemoved: number;
  shapesCount: number;
  connectorsCount: number;
  orthogonalConnectorsCount: number;
  stencilsDecoded: number;
  imagesEmbedded: number;
  ghostBordersCleared: number;
  hairlinesPreserved: number;
  textBlocksFixed: number;
  nestedResolvedCount: number;
  warnings: string[];
  logs: string[];
  status: 'idle' | 'processing' | 'success' | 'error';
  errorMessage?: string;
  outputVsdxSize?: number;
  outputDrawioSize?: number;
}

export interface ProcessedFileItem {
  id: string;
  file: File;
  name: string;
  size: number;
  type: 'drawio' | 'vsdx' | 'xml';
  status: 'pending' | 'processing' | 'success' | 'error';
  report?: DiagnosticReport;
  cleanDrawioBlob?: Blob;
  vsdxBlob?: Blob;
  error?: string;
}

export interface DrawioCellGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  as?: string;
  relative?: boolean;
  points?: Array<{ x: number; y: number }>;
  sourcePoint?: { x: number; y: number };
  targetPoint?: { x: number; y: number };
}

export interface StencilPathCommand {
  type: 'move' | 'line' | 'quad' | 'curve' | 'rect' | 'ellipse' | 'close';
  points: Array<{ x: number; y: number }>;
  w?: number;
  h?: number;
}

export interface StencilDefinition {
  w: number;
  h: number;
  commands: StencilPathCommand[];
}

export interface DrawioParsedCell {
  id: string;
  value: string;
  style: string;
  vertex: boolean;
  edge: boolean;
  parent?: string;
  source?: string;
  target?: string;
  geometry?: DrawioCellGeometry;

  // Computed absolute geometry
  absX?: number;
  absY?: number;
  absWidth?: number;
  absHeight?: number;
  parsedStyle: Record<string, string>;

  // Electrical & CAD specific properties
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  exitX?: number;
  exitY?: number;
  entryX?: number;
  entryY?: number;
  fontSizePt?: number;
  fontColor?: string;
  fontFamily?: string;
  fontStyle?: number; // 0=normal, 1=bold, 2=italic, 3=bold+italic
  isThinLine?: boolean;
  isStencil?: boolean;
  stencilDef?: StencilDefinition;
  isBase64Image?: boolean;
  imageData?: {
    mimeType: string;
    base64: string;
    extension: string;
  };
}

export interface DrawioPage {
  id: string;
  name: string;
  width?: number;
  height?: number;
  cells: DrawioParsedCell[];
  xmlDoc?: Document;
}
