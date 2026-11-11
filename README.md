# Drawio2Visio Fixer Pro 🚀 (Versión 3.0 Definitiva)

Aplicación web 100% local en el navegador construida con **Vite + React + TypeScript + Tailwind CSS** para convertir y reparar diagramas de **draw.io (`.drawio`, `.xml`)** a **Microsoft Visio (`.vsdx`)** con fidelidad milimétrica para planos eléctricos y esquemáticos CAD de múltiples páginas.

---

## 🌟 Novedades y Correcciones Arquitectura V3.0

1. **Parser de Imágenes Base64 sin `;base64`:**
   - Soporte para formatos `data:image/png,<base64>`, `data:image/jpg,...` y `data:image/png;base64,...`.
   - Extracción directa e incrustación en el paquete ZIP en `visio/media/imageX.png` / `.jpg`.
   - Relaciones automáticas en `visio/pages/_rels/pageX.xml.rels` y bloques `<ForeignData ForeignType="Bitmap">` con `Type="Foreign"` en Visio OpenXML.
2. **Conectores Ortogonales como Polilíneas 2D (Sin Distorsión Rotacional 1D):**
   - Elimina la distorsión diagonal provocada por `<XForm1D>`.
   - Genera formas 2D con `Angle="0"`, `NoFill="1"`, `NoLine="0"` y coordenadas locales sin rotación (`MoveTo` y múltiples `LineTo` con codos a 90° exactos).
3. **Eliminación de Bordes Fantasma vs Hairlines de CAD:**
   - Si `strokeColor === "none"` o es texto puro: `LinePattern="0"` y `NoLine="1"` (nunca dibuja recuadros negros alrededor de etiquetas).
   - Si `strokeColor` es válido pero `strokeWidth === "0"` o no está definido: preserva la línea de cajetín con grosor fino CAD (`LineWeight="0.007"` ~0.5pt).
4. **Coordenadas de Grupos Anidados (3+ Niveles) y Rotación sin Swap:**
   - Suma acumulativa recursiva de `(x, y)` hasta llegar a `parent="1"` o `"0"`.
   - Preserva `Width` y `Height` sin intercambiarlos al rotar, aplicando únicamente `Angle = -((rotationDeg % 360) * Math.PI) / 180` para que los pines y componentes rotados encajen exactamente en sus placas.
5. **Inversión del Eje Y en Stencils:**
   - Traduce primitivas de `shape=stencil(base64)` invirtiendo el eje Y: `visioLocalY = heightIn - ((sy / sh) * heightIn)`.
   - Cajas de texto invisibles tipo stencil `UzV2...` se configuran con `NoFill=1` y `NoLine=1`.
6. **Extractor Profundo de Estilos HTML y Prevención de Saltos de Línea:**
   - Extrae tamaños reales de fuente (`26.25px`, `17.5px`, `8.47px`, etc.) ignorando el wrapper de 1px.
   - Aplica `WrapText="0"` y márgenes cero (`TopMargin=0, BottomMargin=0, LeftMargin=0, RightMargin=0`) para que las etiquetas cortas de cajetín y pines nunca partan palabras a la mitad.

---

## 🏗️ Arquitectura de Módulos (`src/core/`)

- [`drawioSanitizer.ts`](file:///c:/Users/jpadilla/Desktop/Proyectos/drawio-to-visio-pro/src/core/drawioSanitizer.ts): Descompresión dual con `pako.inflateRaw`, herencia completa de `<UserObject>` / `<object>` en `cellsMap`, parser seguro de estilos con URLs Base64.
- [`drawioToVsdx.ts`](file:///c:/Users/jpadilla/Desktop/Proyectos/drawio-to-visio-pro/src/core/drawioToVsdx.ts): Construcción de paquete OpenXML, polilíneas ortogonales 2D sin rotación, incrustación de imágenes en `visio/media/`, eliminación de bordes fantasma y hairlines de cajetín.
- [`vsdxPatcher.ts`](file:///c:/Users/jpadilla/Desktop/Proyectos/drawio-to-visio-pro/src/core/vsdxPatcher.ts): Parcheo en caliente de archivos `.vsdx` con `WrapText="0"`, márgenes en 0 y `TextXForm` paramétrico con `TxtAngle="0"`.
- [`htmlStyleExtractor.ts`](file:///c:/Users/jpadilla/Desktop/Proyectos/drawio-to-visio-pro/src/core/htmlStyleExtractor.ts): Extractor profundo de tamaños, colores RGB/Hex, negritas y tipografías desde HTML interno.
- [`stencilParser.ts`](file:///c:/Users/jpadilla/Desktop/Proyectos/drawio-to-visio-pro/src/core/stencilParser.ts): Decodificador e inversor cartesiano de primitivas vectoriales de stencils XML.

---

## 🚀 Puesta en Marcha

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar servidor de desarrollo
npm run dev

# 3. Ejecutar banco de pruebas automatizado
npm test

# 4. Compilar para producción
npm run build
```

El servidor local se ejecuta en [http://localhost:5173/](http://localhost:5173/).
