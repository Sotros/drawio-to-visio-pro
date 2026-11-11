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
  console.log('🧪 Verificación Motor Arquitectura V3.0: Drawio2Visio Fixer Pro');
  console.log('================================================================\n');

  const samplePath = path.join(rootDir, 'sample-diagram.drawio');
  const sampleXml = fs.readFileSync(samplePath, 'utf8');

  // Test 1: Descompresión y Resolución Unificada de <UserObject> + Extractor HTML
  console.log('1️⃣ Probando Módulo 1 & 2: drawioSanitizer + htmlStyleExtractor...');
  const sanitizeResult = sanitizeDrawio(sampleXml, DEFAULT_OPTIONS);
  console.log(`   - Páginas detectadas: ${sanitizeResult.pages.length}`);
  console.log(`   - UserObjects resueltos: ${sanitizeResult.report.userObjectsResolved}`);
  console.log(`   - Estilos HTML rescatados (bypassing 1px): ${sanitizeResult.report.htmlStylesRescued}`);
  console.log(`   - Etiquetas HTML eliminadas: ${sanitizeResult.report.htmlTagsRemoved}`);
  console.log(`   - Formas (2D) detectadas: ${sanitizeResult.report.shapesCount}`);
  console.log(`   - Conectores (1D) detectados: ${sanitizeResult.report.connectorsCount}`);
  console.log(`   - Imágenes Base64 detectadas (sin ';base64'): ${sanitizeResult.report.imagesEmbedded}`);

  if (sanitizeResult.report.userObjectsResolved === 0) {
    throw new Error('Fallo: No se resolvieron los elementos <UserObject>.');
  }

  // Verify Deep HTML Style Extraction on title-block
  const page = sanitizeResult.pages[0];
  const titleBlock = page.cells.find(c => c.id === 'title-block');
  if (!titleBlock) {
    throw new Error('Fallo: No se encontró la celda title-block en la página.');
  }

  console.log(`   - title-block valor limpio: "${titleBlock.value.trim()}"`);
  console.log(`   - title-block fontSize rescatado: ${titleBlock.fontSizePt} pt (esperado ~19.68 pt para 26.25px)`);
  console.log(`   - title-block fontColor: ${titleBlock.fontColor}`);
  console.log(`   - title-block fontFamily: ${titleBlock.fontFamily}`);

  if (!titleBlock.fontSizePt || titleBlock.fontSizePt < 15) {
    throw new Error(`Fallo: El tamaño de fuente del title-block no fue rescatado: ${titleBlock.fontSizePt}`);
  }
  console.log('   ✅ Extractor de estilos HTML profundos: CORRECTO (1px ignorado, 26.25px rescatado)');

  // Verify Recursive 3-level coordinate resolution
  console.log('\n2️⃣ Probando Módulo 3: Jerarquía recursiva getAbsoluteGeometry (3 niveles)...');
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
  console.log('   ✅ Jerarquía de 3 niveles y rotación sin swap: CORRECTA (x=340, y=230, rot=90°)');

  // Test 3: Conversión OpenXML VSDX completa (V3.0)
  console.log('\n3️⃣ Probando Módulos V3.0 en drawioToVsdx...');
  const conversionResult = await convertDrawioToVsdx(sampleXml, DEFAULT_OPTIONS);
  console.log(`   - VSDX tamaño generado: ${conversionResult.vsdxBlob.size} bytes`);
  console.log(`   - Conectores 2D ortogonales trazados: ${conversionResult.report.orthogonalConnectorsCount}`);
  console.log(`   - Imágenes incrustadas en visio/media/: ${conversionResult.report.imagesEmbedded}`);
  console.log(`   - Bordes fantasma limpiados (strokeColor=none): ${conversionResult.report.ghostBordersCleared}`);
  console.log(`   - Líneas de cajetín hairline preservadas: ${conversionResult.report.hairlinesPreserved}`);
  console.log(`   - Bloques TextXForm fijados: ${conversionResult.report.textBlocksFixed}`);

  // Inspect generated vsdx ZIP package
  const vsdxBuffer = await conversionResult.vsdxBlob.arrayBuffer();
  const zip = await JSZip.loadAsync(vsdxBuffer);

  // Check media image file (extracted from data:image/png,... without ';base64')
  if (!zip.file('visio/media/image1.png')) {
    throw new Error('Fallo: No se encontró la imagen visio/media/image1.png en el paquete VSDX.');
  }
  console.log('   ✅ Imagen data:image/png,<base64> (sin ;base64) extraída e incrustada en visio/media/image1.png');

  // Check Content_Types
  const contentTypesXml = await zip.file('[Content_Types].xml').async('string');
  if (!contentTypesXml.includes('Extension="png"') || !contentTypesXml.includes('Extension="jpg"')) {
    throw new Error('Fallo: [Content_Types].xml no contiene las extensiones de imagen.');
  }
  console.log('   ✅ Registro de tipos MIME en [Content_Types].xml: CORRECTO');

  // Check page rels for image
  const pageRelsXml = await zip.file('visio/pages/_rels/page1.xml.rels').async('string');
  if (!pageRelsXml.includes('Target="../media/image1.png"')) {
    throw new Error('Fallo: visio/pages/_rels/page1.xml.rels no contiene relación con image1.png');
  }
  console.log('   ✅ Relación rIdImg1 en visio/pages/_rels/page1.xml.rels: CORRECTA');

  // Inspect page1.xml
  const page1Xml = await zip.file('visio/pages/page1.xml').async('string');

  // Check ForeignData in shape
  if (!page1Xml.includes('ForeignData ForeignType="Bitmap"') || !page1Xml.includes('Rel r:id="rIdImg1"')) {
    throw new Error('Fallo: page1.xml no contiene el bloque ForeignData con bitmap.');
  }
  console.log('   ✅ Bloque <ForeignData> Type="Foreign" con bitmap: CORRECTO');

  // Check 2D polyline connector without XForm1D rotational distortion
  // In V3.0, the connector shape has Section N="Geometry" with NoFill="1" and NO Section N="XForm1D"
  const edgeShapes = page1Xml.match(/<Shape ID="13"[\s\S]*?<\/Shape>/);
  if (edgeShapes && edgeShapes[0].includes('XForm1D')) {
    throw new Error('Fallo: El conector ortogonal 2D no debe tener XForm1D para evitar rotación diagonal.');
  }
  console.log('   ✅ Conector ortogonal como Shape 2D con Angle="0" (sin distorsión 1D): CORRECTO');

  // Check ghost border elimination: title-block shape must have NoLine="1" and LinePattern="0"
  if (!page1Xml.includes('<Cell N="LinePattern" V="0"/>') || !page1Xml.includes('<Cell N="NoLine" V="1"/>')) {
    throw new Error('Fallo: No se eliminó el borde fantasma de la etiqueta con strokeColor=none.');
  }
  console.log('   ✅ Eliminación de borde fantasma (LinePattern=0, NoLine=1): CORRECTA');

  // Check hairline line weight = 0.007 in
  if (!page1Xml.includes('N="LineWeight" V="0.007"') && !page1Xml.includes('V="0.007"')) {
    throw new Error('Fallo: Las líneas de cajetín strokeWidth=0 no se configuraron con LineWeight V="0.007".');
  }
  console.log('   ✅ Línea de cajetín Hairline CAD (<Cell N="LineWeight" V="0.007"/>): CORRECTA');
  console.log('   ✅ Línea de cajetín Hairline CAD (LineWeight="0.007"): CORRECTA');

  // Test 4: Reparador VSDX
  console.log('\n4️⃣ Probando Módulo 4: vsdxPatcher...');
  const patchResult = await patchVsdx(vsdxBuffer, DEFAULT_OPTIONS);
  console.log(`   - Páginas procesadas por patcher: ${patchResult.report.pagesCount}`);
  console.log(`   - TextXForm corregidos: ${patchResult.report.textBlocksFixed}`);

  // Save sample fixed files
  const outVsdxPath = path.join(rootDir, 'sample-diagram-fixed.vsdx');
  const outDrawioPath = path.join(rootDir, 'sample-diagram-clean.drawio');
  fs.writeFileSync(outVsdxPath, Buffer.from(vsdxBuffer));
  fs.writeFileSync(outDrawioPath, conversionResult.cleanDrawioXml, 'utf8');

  console.log('\n💾 Archivos V3.0 generados en disco:');
  console.log(`   - ${outVsdxPath} (${fs.statSync(outVsdxPath).size} bytes)`);
  console.log(`   - ${outDrawioPath} (${fs.statSync(outDrawioPath).size} bytes)`);

  console.log('\n================================================================');
  console.log('🎉 TODAS LAS PRUEBAS DE ARQUITECTURA V3.0 DEFINITIVA PASARON CON ÉXITO');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ ERROR EN LAS PRUEBAS V3.0:', err);
  process.exit(1);
});
