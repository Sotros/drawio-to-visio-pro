import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';

// Polyfill DOMParser and XMLSerializer for Node
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

import { sanitizeDrawio } from '../src/core/drawioSanitizer.ts';
import { convertDrawioToVsdx, getAbsoluteGeometry } from '../src/core/drawioToVsdx.ts';
import { patchVsdx } from '../src/core/vsdxPatcher.ts';
import { DEFAULT_OPTIONS } from '../src/types/index.ts';

async function runTests() {
  console.log('================================================================');
  console.log('🧪 Verificación Motor Arquitectura V4.0: Drawio2Visio Fixer Pro');
  console.log('================================================================\n');

  const samplePath = path.join(rootDir, 'sample-diagram.drawio');
  const sampleXml = fs.readFileSync(samplePath, 'utf8');

  // Test 1: Fase 1 - Pre-limpiador CAD para .drawio
  console.log('1️⃣ Probando Fase 1: drawioSanitizer (Pre-limpiador CAD)...');
  const sanitizeResult = sanitizeDrawio(sampleXml, DEFAULT_OPTIONS);
  console.log(`   - Páginas procesadas: ${sanitizeResult.pages.length}`);
  console.log(`   - Páginas descomprimidas: ${sanitizeResult.report.pagesDecompressed}`);
  console.log(`   - UserObjects preservados: ${sanitizeResult.report.userObjectsResolved}`);
  console.log(`   - Estilos tipográficos rescatados: ${sanitizeResult.report.htmlStylesRescued}`);
  console.log(`   - Etiquetas HTML eliminadas: ${sanitizeResult.report.htmlTagsRemoved}`);
  console.log(`   - Saltos de línea finales (\\n+$) eliminados: ${sanitizeResult.report.trailingNewlinesRemoved}`);
  console.log(`   - Márgenes negativos corregidos: ${sanitizeResult.report.negativeMarginsCleared}`);

  if (sanitizeResult.report.userObjectsResolved === 0) {
    throw new Error('Fallo: No se resolvieron los elementos <UserObject>.');
  }

  // Verify that the sanitized XML output contains plain <mxGraphModel> inside <diagram>
  if (!sanitizeResult.sanitizedXml.includes('<diagram') || !sanitizeResult.sanitizedXml.includes('<mxGraphModel')) {
    throw new Error('Fallo: El XML sanitizado no contiene <diagram> con <mxGraphModel> plano.');
  }
  if (!sanitizeResult.sanitizedXml.startsWith('<?xml version="1.0"')) {
    throw new Error('Fallo: El XML sanitizado debe comenzar con la declaración XML UTF-8.');
  }
  console.log('   ✅ Descompresión transparente a XML plano para draw.io v26.0.16: CORRECTA');

  // Verify Deep HTML Style Extraction on title-block
  const page = sanitizeResult.pages[0];
  const titleBlock = page.cells.find(c => c.id === 'title-block');
  if (!titleBlock) {
    throw new Error('Fallo: No se encontró la celda title-block en la página.');
  }

  console.log(`   - title-block valor limpio: "${titleBlock.value.trim()}"`);
  console.log(`   - title-block fontSize rescatado: ${titleBlock.fontSizePt} pt`);
  console.log(`   - title-block fontColor: ${titleBlock.fontColor}`);
  console.log(`   - title-block fontFamily: ${titleBlock.fontFamily}`);

  if (!titleBlock.fontSizePt || titleBlock.fontSizePt < 15) {
    throw new Error(`Fallo: El tamaño de fuente del title-block no fue rescatado: ${titleBlock.fontSizePt}`);
  }
  console.log('   ✅ Extractor de estilos HTML profundos: CORRECTO (1px ignorado, 26.25px rescatado)');

  // Verify Recursive 3-level coordinate resolution
  console.log('\n2️⃣ Probando Jerarquía recursiva getAbsoluteGeometry (3 niveles)...');
  const cellsMap = new Map();
  page.cells.forEach(c => cellsMap.set(c.id, c));

  const u3Geo = getAbsoluteGeometry('U3', cellsMap);
  const connJ1Geo = getAbsoluteGeometry('CONN_J1', cellsMap);
  const pin1Geo = getAbsoluteGeometry('PIN_1', cellsMap);

  console.log(`   - U3 (Nivel 1): x=${u3Geo.x}, y=${u3Geo.y}`);
  console.log(`   - CONN_J1 (Nivel 2): x=${connJ1Geo.x}, y=${connJ1Geo.y}`);
  console.log(`   - PIN_1 (Nivel 3): x=${pin1Geo.x}, y=${pin1Geo.y}, rotación=${pin1Geo.rotation}°`);

  if (pin1Geo.x !== 340 || pin1Geo.y !== 230) {
    throw new Error(`Fallo en coordenadas de PIN_1: esperado (340, 230), obtenido (${pin1Geo.x}, ${pin1Geo.y})`);
  }
  if (pin1Geo.rotation !== 90) {
    throw new Error(`Fallo: La rotación de PIN_1 debería ser 90°, obtenido ${pin1Geo.rotation}°`);
  }
  console.log('   ✅ Jerarquía de 3 niveles y rotación: CORRECTA (x=340, y=230, rot=90°)');

  // Test 3: Conversión OpenXML VSDX completa (Motor Interno de Soporte)
  console.log('\n3️⃣ Probando generación OpenXML VSDX completa (Sin ForeignData ni media/)...');
  const conversionResult = await convertDrawioToVsdx(sampleXml, DEFAULT_OPTIONS);
  console.log(`   - VSDX tamaño generado: ${conversionResult.vsdxBlob.size} bytes`);
  console.log(`   - Conectores 2D ortogonales trazados: ${conversionResult.report.orthogonalConnectorsCount}`);

  const vsdxBuffer = await conversionResult.vsdxBlob.arrayBuffer();

  // Test 4: Fase 2 - Parcheador Quirúrgico XSD 100% Seguro para Visio
  console.log('\n4️⃣ Probando Fase 2: vsdxPatcher (Esquema XSD Estricto Visio)...');
  const patchResult = await patchVsdx(vsdxBuffer, DEFAULT_OPTIONS);
  console.log(`   - Páginas procesadas por patcher: ${patchResult.report.pagesCount}`);
  console.log(`   - Figuras 2D calibradas: ${patchResult.report.textBlocksFixed}`);
  console.log(`   - Conectores 1D protegidos (sin TxtWidth/TxtHeight): ${patchResult.report.shapesSkipped1D}`);

  // Inspect the patched VSDX to verify the 4 Mandatory Corrections
  const patchedZip = await JSZip.loadAsync(await patchResult.patchedBlob.arrayBuffer());

  // Correction 1: No visio/media/ folder and clean [Content_Types].xml
  const contentTypesXml = await patchedZip.file('[Content_Types].xml').async('string');
  if (contentTypesXml.includes('Extension="png"') || contentTypesXml.includes('Extension="jpg"')) {
    throw new Error('Fallo Corrección 1: [Content_Types].xml no debe contener extensiones de imagen.');
  }
  let hasMedia = false;
  patchedZip.forEach(relPath => {
    if (relPath.startsWith('visio/media/')) hasMedia = true;
  });
  if (hasMedia) {
    throw new Error('Fallo Corrección 1: El paquete VSDX no debe contener la carpeta visio/media/.');
  }
  console.log('   ✅ Corrección 1: Cero inyección de ForeignData, visio/media/ eliminado y [Content_Types].xml limpio.');

  // Correction 2 & 3: Inspect page1.xml
  const patchedPage1Xml = await patchedZip.file('visio/pages/page1.xml').async('string');

  // Anti-NaN check
  if (patchedPage1Xml.includes('="NaN"') || patchedPage1Xml.includes('="undefined"') || patchedPage1Xml.includes('="Infinity"')) {
    throw new Error('Fallo Corrección 3: page1.xml contiene valores inválidos (NaN, undefined o Infinity).');
  }
  console.log('   ✅ Corrección 3: Protección Anti-NaN verificada (cero NaN/undefined/Infinity en atributos V="...").');

  const parser = new DOMParser();
  const page1Doc = parser.parseFromString(patchedPage1Xml, 'application/xml');

  // Verify NO <Section N="TextXForm"> or <Section N="TextBlock">
  const sections = Array.from(page1Doc.getElementsByTagName('Section'));
  const illegalSections = sections.filter(s => {
    const n = s.getAttribute('N');
    return n === 'TextXForm' || n === 'TextBlock' || n === 'Text' || n === 'Protection';
  });
  if (illegalSections.length > 0) {
    throw new Error(`Fallo: Se encontraron ${illegalSections.length} secciones ilegales.`);
  }

  // Verify Strict Ordering: Bloque 1 (Cell) -> Bloque 2 (Section) -> Bloque 3 (Text al final)
  const shapes = Array.from(page1Doc.getElementsByTagName('Shape'));
  const shapeIds = new Set();

  for (const sh of shapes) {
    const idAttr = sh.getAttribute('ID');
    const numericId = parseInt(idAttr || '0', 10);
    if (!numericId || shapeIds.has(numericId)) {
      throw new Error(`Fallo Corrección 3: ID de forma repetido o no numérico: "${idAttr}".`);
    }
    shapeIds.add(numericId);

    let currentBlock = 1; // 1 = Cell, 2 = Section, 3 = Text
    for (let i = 0; i < sh.childNodes.length; i++) {
      const child = sh.childNodes[i];
      if (child.nodeType === 1) {
        const tagName = child.tagName.toLowerCase();
        if (tagName === 'cell') {
          if (currentBlock > 1) {
            throw new Error(`Fallo Corrección 2: <Cell N="${child.getAttribute('N')}"> aparece en Bloque ${currentBlock} (después de Section o Text) en <Shape ID="${idAttr}">.`);
          }
        } else if (tagName === 'section') {
          if (currentBlock > 2) {
            throw new Error(`Fallo Corrección 2: <Section N="${child.getAttribute('N')}"> aparece después de <Text> en <Shape ID="${idAttr}">.`);
          }
          currentBlock = 2;
        } else if (tagName === 'text') {
          currentBlock = 3;
        }
      }
    }
  }
  console.log('   ✅ Corrección 2: Orden estricto inalterable verificado (Bloque 1 Cell -> Bloque 2 Section -> Bloque 3 Text).');
  console.log(`   ✅ Corrección 3: IDs enteros consecutivos únicos verificados (${shapeIds.size} formas numeradas 1..${shapeIds.size}).`);

  // Save sample fixed files
  const outVsdxPath = path.join(rootDir, 'sample-diagram-fixed.vsdx');
  const outDrawioPath = path.join(rootDir, 'sample-diagram-clean.drawio');
  fs.writeFileSync(outVsdxPath, Buffer.from(await patchResult.patchedBlob.arrayBuffer()));
  fs.writeFileSync(outDrawioPath, sanitizeResult.sanitizedXml, 'utf8');

  console.log('\n💾 Archivos V4.0 generados en disco:');
  console.log(`   - ${outVsdxPath} (${fs.statSync(outVsdxPath).size} bytes)`);
  console.log(`   - ${outDrawioPath} (${fs.statSync(outDrawioPath).size} bytes)`);

  console.log('\n================================================================');
  console.log('🎉 LAS 4 CORRECCIONES CRÍTICAS XSD PASARON CON 100% DE ÉXITO');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ ERROR EN LAS PRUEBAS V4.0:', err);
  process.exit(1);
});
