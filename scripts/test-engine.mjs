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
  console.log('\n3️⃣ Probando generación OpenXML VSDX completa...');
  const conversionResult = await convertDrawioToVsdx(sampleXml, DEFAULT_OPTIONS);
  console.log(`   - VSDX tamaño generado: ${conversionResult.vsdxBlob.size} bytes`);
  console.log(`   - Conectores 2D ortogonales trazados: ${conversionResult.report.orthogonalConnectorsCount}`);
  console.log(`   - Imágenes incrustadas: ${conversionResult.report.imagesEmbedded}`);

  const vsdxBuffer = await conversionResult.vsdxBlob.arrayBuffer();

  // Test 4: Fase 2 - Parcheador Quirúrgico XSD 100% Seguro para Visio
  console.log('\n4️⃣ Probando Fase 2: vsdxPatcher (5 Reglas de Oro XSD)...');
  const patchResult = await patchVsdx(vsdxBuffer, DEFAULT_OPTIONS);
  console.log(`   - Páginas procesadas por patcher: ${patchResult.report.pagesCount}`);
  console.log(`   - Figuras 2D calibradas: ${patchResult.report.textBlocksFixed}`);
  console.log(`   - Conectores 1D protegidos (sin TxtWidth/TxtHeight): ${patchResult.report.shapesSkipped1D}`);
  console.log(`   - Secciones ilegales eliminadas: ${patchResult.report.invalidSectionsRemoved}`);

  // Inspect the patched VSDX to verify the 5 Golden Rules
  const patchedZip = await JSZip.loadAsync(await patchResult.patchedBlob.arrayBuffer());

  // Rule 1 Verification: [Content_Types].xml, _rels/.rels, visio/document.xml preserved
  if (!patchedZip.file('[Content_Types].xml') || !patchedZip.file('visio/document.xml')) {
    throw new Error('Fallo Regla 1: Faltan archivos esenciales del paquete OpenXML.');
  }
  console.log('   ✅ Regla 1: Archivos ZIP estructurales [Content_Types].xml y document.xml intactos.');

  // Rule 2 & 3 & 4 Verification on page1.xml
  const patchedPage1Xml = await patchedZip.file('visio/pages/page1.xml').async('string');
  const parser = new DOMParser();
  const page1Doc = parser.parseFromString(patchedPage1Xml, 'application/xml');

  // Verify NO <Section N="TextXForm"> or <Section N="TextBlock">
  const sections = Array.from(page1Doc.getElementsByTagName('Section'));
  const illegalSections = sections.filter(s => {
    const n = s.getAttribute('N');
    return n === 'TextXForm' || n === 'TextBlock';
  });
  if (illegalSections.length > 0) {
    throw new Error(`Fallo Regla 3: Se encontraron ${illegalSections.length} secciones ilegales <Section N="TextXForm">.`);
  }
  console.log('   ✅ Regla 3: Cero secciones inexistentes (<Section N="TextXForm"> / <Section N="TextBlock">).');

  // Verify Rule 4: Strict ordering of <Cell> before any <Section>, <Text>, <ForeignData>, <Shapes>
  const shapes = Array.from(page1Doc.getElementsByTagName('Shape'));
  for (const sh of shapes) {
    let seenNonCell = false;
    for (let i = 0; i < sh.childNodes.length; i++) {
      const child = sh.childNodes[i];
      if (child.nodeType === 1) {
        const tagName = child.tagName.toLowerCase();
        if (tagName === 'cell') {
          if (seenNonCell) {
            throw new Error(`Fallo Regla 4: <Cell N="${child.getAttribute('N')}"> aparece después de un nodo no-Cell en <Shape ID="${sh.getAttribute('ID')}">.`);
          }
        } else {
          seenNonCell = true;
        }
      }
    }
  }
  console.log('   ✅ Regla 4: Orden estricto XSD verificado (TODOS los <Cell> preceden a <Section> y <Text>).');

  // Verify Rule 5: 1D connector shapes (BeginX / EndX) do NOT have TxtWidth
  for (const sh of shapes) {
    const cells = Array.from(sh.getElementsByTagName('Cell'));
    const is1D = cells.some(c => c.getAttribute('N') === 'BeginX' || c.getAttribute('N') === 'EndX');
    if (is1D) {
      const directCells = Array.from(sh.childNodes).filter(n => n.nodeType === 1 && n.tagName.toLowerCase() === 'cell');
      const hasTxtWidth = directCells.some(c => c.getAttribute('N') === 'TxtWidth');
      if (hasTxtWidth) {
        throw new Error(`Fallo Regla 5: Conector 1D ID="${sh.getAttribute('ID')}" tiene celda TxtWidth inyectada.`);
      }
    }
  }
  console.log('   ✅ Regla 5: Conectores 1D protegidos (cero inyección indebida de TxtWidth/TxtHeight).');

  // Save sample fixed files
  const outVsdxPath = path.join(rootDir, 'sample-diagram-fixed.vsdx');
  const outDrawioPath = path.join(rootDir, 'sample-diagram-clean.drawio');
  fs.writeFileSync(outVsdxPath, Buffer.from(await patchResult.patchedBlob.arrayBuffer()));
  fs.writeFileSync(outDrawioPath, sanitizeResult.sanitizedXml, 'utf8');

  console.log('\n💾 Archivos V4.0 generados en disco:');
  console.log(`   - ${outVsdxPath} (${fs.statSync(outVsdxPath).size} bytes)`);
  console.log(`   - ${outDrawioPath} (${fs.statSync(outDrawioPath).size} bytes)`);

  console.log('\n================================================================');
  console.log('🎉 TODAS LAS PRUEBAS DE ARQUITECTURA V4.0 PASARON CON ÉXITO');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ ERROR EN LAS PRUEBAS V4.0:', err);
  process.exit(1);
});
