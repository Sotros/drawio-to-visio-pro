# Drawio2Visio Fixer Pro 🚀 (Versión 4.0 Híbrida)

Aplicación web 100% local en el navegador construida con **Vite + React + TypeScript + Tailwind CSS** para convertir y reparar diagramas de **draw.io (`.drawio`, `.xml`)** a **Microsoft Visio (`.vsdx`)** evitando páginas en blanco y descolocación de textos en planos eléctricos y esquemáticos CAD complejos.

---

## 🌟 Arquitectura V4.0: Flujo Híbrido de 2 Fases + Esquema XSD Estricto

1. **Fase 1: Pre-Limpiador CAD para `.drawio` ([`drawioSanitizer.ts`](./src/core/drawioSanitizer.ts)):**
   - **Descompresión transparente a XML plano:** Infla páginas comprimidas (`Base64 + Raw Deflate + URI Encoded`) mediante `pako.inflateRaw` y exporta `<mxGraphModel>` en XML plano UTF-8 directo.
   - **Preservación total de la estructura CAD:** Mantiene intactos los nodos `<UserObject>` / `<object>`, identificadores `vsdxID`, stencils vectoriales `shape=stencil(...)`, imágenes y jerarquías padre-hijo.
   - **Rescate tipográfico profundo ([`htmlStyleExtractor.ts`](./src/core/htmlStyleExtractor.ts)):** Ignora envoltorios `<div style="font-size: 1px">`, extrae tamaños de fuente reales (`fontSize`), colores RGB/#HEX, familia tipográfica y bitmask `fontStyle` (negrita/cursiva), limpia HTML, elimina saltos de línea finales sobrantes (`.replace(/\n+$/, '')`) y fija `html=0;` con márgenes en cero (`spacingTop=0;...`).

2. **Puente Directo con draw.io v26.0.16:**
   - Permite abrir directamente el archivo `.drawio` pre-limpiado en el editor oficial de **draw.io v26.0.16** para traducir con total fidelidad stencils complejos, imágenes y conectores a `.vsdx` (`Archivo -> Exportar como -> VSDX (beta)`).

3. **Fase 2: Parcheador Quirúrgico XSD Seguro ([`vsdxPatcher.ts`](./src/core/vsdxPatcher.ts)):**
   - **Cumplimiento estricto de las 5 Reglas de Oro OpenXML de Visio:**
     1. Mantiene intactos `[Content_Types].xml`, `_rels/.rels`, `visio/document.xml` y `visio/pages/pages.xml`.
     2. Parsea XML exclusivamente con `DOMParser(..., "application/xml")` verificando ausencia de `<parsererror>`.
     3. Elimina y prohíbe secciones ilegales inexistentes en Visio (`<Section N="TextXForm">`, `<Section N="TextBlock">`).
     4. Garantiza mediante `reorderShapeChildrenStrict` el orden inalterable dentro de cada `<Shape>`:
        - **Bloque 1:** Exclusivamente celdas directas `<Cell>` (`PinX`, `PinY`, `Width`, `Height`, `Txt*`, márgenes y `LockTextEdit`).
        - **Bloque 2:** Exclusivamente secciones `<Section>` (`Character`, `Paragraph`, `Geometry`).
        - **Bloque 3:** Etiqueta `<Text>` siempre al final del `<Shape>`.
     5. Protege conectores 1D (`BeginX` / `EndX`) evitando inyectar celdas de texto 2D.

4. **Generador Directo Compatible XSD + Anti-`NaN` ([`drawioToVsdx.ts`](./src/core/drawioToVsdx.ts) & [`xmlUtils.ts`](./src/core/xmlUtils.ts)):**
   - Función auxiliar `safeNum()` aplicada en absolutamente todas las coordenadas y geometrías para impedir atributos `V="NaN"`, `V="Infinity"` o `V="undefined"`.
   - Numeración entera consecutiva única de formas (`ID="1"`, `ID="2"`, ...).
   - Sin inyección de `<ForeignData>` ni alteración de `[Content_Types].xml`.

---

## 🏗️ Módulos Principales (`src/core/`)

- [`drawioSanitizer.ts`](./src/core/drawioSanitizer.ts): Descompresión dual con `pako.inflateRaw`, preservación de `<UserObject>`, rescate de estilos y limpieza de HTML.
- [`vsdxPatcher.ts`](./src/core/vsdxPatcher.ts): Parcheador quirúrgico de `.vsdx` respetando el orden estricto XSD de 3 bloques por figura.
- [`drawioToVsdx.ts`](./src/core/drawioToVsdx.ts): Motor interno alternativo de generación directa OpenXML compatible XSD y libre de `NaN`.
- [`htmlStyleExtractor.ts`](./src/core/htmlStyleExtractor.ts): Extractor profundo de tamaños, colores RGB/Hex, negritas y tipografías desde HTML interno.
- [`stencilParser.ts`](./src/core/stencilParser.ts): Decodificador e inversor cartesiano de primitivas vectoriales de stencils XML.
- [`xmlUtils.ts`](./src/core/xmlUtils.ts): Utilidades XML seguras y sanitizador numérico `safeNum()`.

---

## 🚀 Puesta en Marcha

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar servidor de desarrollo
npm run dev

# 3. Ejecutar banco de pruebas automatizado (incluye verificación XSD)
npm test

# 4. Compilar para producción
npm run build
```

El servidor local se ejecuta en [http://localhost:5173/](http://localhost:5173/).
