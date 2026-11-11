import { useState, useRef } from 'react';
import {
  Upload,
  Download,
  CheckCircle2,
  RefreshCw,
  Sliders,
  Sparkles,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Trash2,
  Terminal,
  Layers,
  Cpu,
  ExternalLink,
  Zap,
  AlignLeft,
  FileCheck,
  Check
} from 'lucide-react';
import { ConversionOptions, DEFAULT_OPTIONS, ProcessedFileItem } from './types';
import { sanitizeDrawio } from './core/drawioSanitizer';
import { patchVsdx } from './core/vsdxPatcher';
import { convertDrawioToVsdx } from './core/drawioToVsdx';
import { SAMPLE_DRAWIO_XML } from './data/sampleDiagram';

export default function App() {
  const [options, setOptions] = useState<ConversionOptions>(DEFAULT_OPTIONS);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);

  // Step 1: Sanitized Drawio state
  const [drawioFile, setDrawioFile] = useState<ProcessedFileItem | null>(null);
  const [isProcessingDrawio, setIsProcessingDrawio] = useState(false);

  // Step 3: VSDX Patcher state
  const [vsdxFile, setVsdxFile] = useState<ProcessedFileItem | null>(null);
  const [isProcessingVsdx, setIsProcessingVsdx] = useState(false);

  // Drag states
  const [isDraggingDrawio, setIsDraggingDrawio] = useState(false);
  const [isDraggingVsdx, setIsDraggingVsdx] = useState(false);

  // Expanded log toggles
  const [showDrawioLogs, setShowDrawioLogs] = useState(false);
  const [showVsdxLogs, setShowVsdxLogs] = useState(false);

  const drawioInputRef = useRef<HTMLInputElement>(null);
  const vsdxInputRef = useRef<HTMLInputElement>(null);

  // ==========================================
  // STEP 1: Process .drawio / .xml file
  // ==========================================
  const handleProcessDrawio = async (file: File | { name: string; size: number; text: () => Promise<string> }) => {
    setIsProcessingDrawio(true);
    const fileId = `drawio-${Date.now()}`;

    try {
      const textContent = await file.text();
      const sanitizeResult = sanitizeDrawio(textContent, options);
      const cleanBlob = new Blob([sanitizeResult.sanitizedXml], { type: 'application/xml' });

      setDrawioFile({
        id: fileId,
        file: file as File,
        name: file.name,
        size: file.size,
        type: 'drawio',
        status: 'success',
        cleanDrawioBlob: cleanBlob,
        cleanDrawioXml: sanitizeResult.sanitizedXml,
        report: {
          fileName: file.name,
          fileType: 'drawio',
          pagesCount: sanitizeResult.report.pagesCount || 1,
          pagesDecompressed: sanitizeResult.report.pagesDecompressed || 0,
          userObjectsResolved: sanitizeResult.report.userObjectsResolved || 0,
          htmlStylesRescued: sanitizeResult.report.htmlStylesRescued || 0,
          htmlTagsRemoved: sanitizeResult.report.htmlTagsRemoved || 0,
          trailingNewlinesRemoved: sanitizeResult.report.trailingNewlinesRemoved || 0,
          negativeMarginsCleared: sanitizeResult.report.negativeMarginsCleared || 0,
          shapesCount: sanitizeResult.report.shapesCount || 0,
          connectorsCount: sanitizeResult.report.connectorsCount || 0,
          orthogonalConnectorsCount: 0,
          stencilsDecoded: sanitizeResult.report.stencilsDecoded || 0,
          imagesEmbedded: sanitizeResult.report.imagesEmbedded || 0,
          ghostBordersCleared: 0,
          hairlinesPreserved: 0,
          textBlocksFixed: 0,
          nestedResolvedCount: 0,
          warnings: sanitizeResult.report.warnings || [],
          logs: sanitizeResult.report.logs || [],
          status: 'success',
          outputDrawioSize: cleanBlob.size
        }
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Error al procesar el archivo .drawio';
      setDrawioFile({
        id: fileId,
        file: file as File,
        name: file.name,
        size: file.size,
        type: 'drawio',
        status: 'error',
        error: errMsg,
        report: {
          fileName: file.name,
          fileType: 'drawio',
          pagesCount: 0,
          userObjectsResolved: 0,
          htmlStylesRescued: 0,
          htmlTagsRemoved: 0,
          shapesCount: 0,
          connectorsCount: 0,
          orthogonalConnectorsCount: 0,
          stencilsDecoded: 0,
          imagesEmbedded: 0,
          ghostBordersCleared: 0,
          hairlinesPreserved: 0,
          textBlocksFixed: 0,
          nestedResolvedCount: 0,
          warnings: [errMsg],
          logs: [`[ERROR] ${errMsg}`],
          status: 'error',
          errorMessage: errMsg
        }
      });
    } finally {
      setIsProcessingDrawio(false);
    }
  };

  // Optional direct internal conversion
  const handleDirectInternalConversion = async () => {
    if (!drawioFile || !drawioFile.cleanDrawioXml) return;
    setIsProcessingDrawio(true);
    try {
      const directResult = await convertDrawioToVsdx(drawioFile.cleanDrawioXml, options);
      setDrawioFile(prev => prev ? {
        ...prev,
        vsdxBlob: directResult.vsdxBlob,
        report: {
          ...prev.report!,
          ...directResult.report,
          outputVsdxSize: directResult.vsdxBlob.size
        }
      } : null);
    } catch (err: unknown) {
      alert(`Error en conversión directa: ${err instanceof Error ? err.message : 'Error desconocido'}`);
    } finally {
      setIsProcessingDrawio(false);
    }
  };

  // ==========================================
  // STEP 3: Process .vsdx file
  // ==========================================
  const handleProcessVsdx = async (file: File | { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }) => {
    setIsProcessingVsdx(true);
    const fileId = `vsdx-${Date.now()}`;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const patchResult = await patchVsdx(arrayBuffer, options);

      setVsdxFile({
        id: fileId,
        file: file as File,
        name: file.name,
        size: file.size,
        type: 'vsdx',
        status: 'success',
        vsdxBlob: patchResult.patchedBlob,
        report: {
          fileName: file.name,
          fileType: 'vsdx',
          pagesCount: patchResult.report.pagesCount || 1,
          userObjectsResolved: 0,
          htmlStylesRescued: 0,
          htmlTagsRemoved: 0,
          shapesCount: patchResult.report.shapesCount || 0,
          connectorsCount: 0,
          orthogonalConnectorsCount: 0,
          stencilsDecoded: 0,
          imagesEmbedded: 0,
          ghostBordersCleared: 0,
          hairlinesPreserved: 0,
          textBlocksFixed: patchResult.report.textBlocksFixed || 0,
          shapesSkipped1D: patchResult.report.shapesSkipped1D || 0,
          invalidSectionsRemoved: patchResult.report.invalidSectionsRemoved || 0,
          nestedResolvedCount: 0,
          warnings: patchResult.report.warnings || [],
          logs: patchResult.report.logs || [],
          status: 'success',
          outputVsdxSize: patchResult.patchedBlob.size
        }
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Error al parchear el archivo .vsdx';
      setVsdxFile({
        id: fileId,
        file: file as File,
        name: file.name,
        size: file.size,
        type: 'vsdx',
        status: 'error',
        error: errMsg,
        report: {
          fileName: file.name,
          fileType: 'vsdx',
          pagesCount: 0,
          userObjectsResolved: 0,
          htmlStylesRescued: 0,
          htmlTagsRemoved: 0,
          shapesCount: 0,
          connectorsCount: 0,
          orthogonalConnectorsCount: 0,
          stencilsDecoded: 0,
          imagesEmbedded: 0,
          ghostBordersCleared: 0,
          hairlinesPreserved: 0,
          textBlocksFixed: 0,
          nestedResolvedCount: 0,
          warnings: [errMsg],
          logs: [`[ERROR] ${errMsg}`],
          status: 'error',
          errorMessage: errMsg
        }
      });
    } finally {
      setIsProcessingVsdx(false);
    }
  };

  // Helper download trigger
  const triggerDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Load sample diagram
  const loadSample = () => {
    const blob = new Blob([SAMPLE_DRAWIO_XML], { type: 'application/xml' });
    const sampleFile = {
      name: 'plano-electrico-cad-sample.drawio',
      size: blob.size,
      text: async () => SAMPLE_DRAWIO_XML
    };
    handleProcessDrawio(sampleFile);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-gradient-to-tr from-cyan-500 to-blue-600 p-2 rounded-xl shadow-lg shadow-cyan-500/20">
              <Cpu className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                  Drawio2Visio Fixer Pro
                </h1>
                <span className="bg-cyan-500/20 text-cyan-400 text-xs px-2.5 py-0.5 rounded-full font-semibold border border-cyan-500/30">
                  v4.0 Híbrida
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Flujo de 2 Fases + Puente draw.io v26.0.16 para planos eléctricos y CAD
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                showAdvancedOptions
                  ? 'bg-slate-800 border-slate-600 text-white'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Opciones Avanzadas</span>
            </button>

            <button
              onClick={loadSample}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-medium transition"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Cargar Plano CAD de Ejemplo</span>
            </button>
          </div>
        </div>
      </header>

      {/* Advanced Options Drawer */}
      {showAdvancedOptions && (
        <section className="bg-slate-900 border-b border-slate-800 py-4 px-4 sm:px-6 lg:px-8 animate-fadeIn">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="space-y-2">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <AlignLeft className="w-4 h-4 text-cyan-400" /> Pre-limpieza .drawio (Fase 1)
              </span>
              <label className="flex items-center space-x-2 text-slate-300">
                <input
                  type="checkbox"
                  checked={options.rescueHtmlStyles}
                  onChange={e => setOptions({ ...options, rescueHtmlStyles: e.target.checked })}
                  className="rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0"
                />
                <span>Rescatar fontSize (&gt;2px) y colores desde &lt;font&gt; / &lt;span&gt;</span>
              </label>
              <label className="flex items-center space-x-2 text-slate-300">
                <input
                  type="checkbox"
                  checked={options.adjustTextBoxesAndRotations}
                  onChange={e => setOptions({ ...options, adjustTextBoxesAndRotations: e.target.checked })}
                  className="rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0"
                />
                <span>Eliminar márgenes negativos (-3px) y saltos de línea sobrantes (\n+$)</span>
              </label>
            </div>

            <div className="space-y-2">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" /> Parcheador Quirúrgico XSD (Fase 2)
              </span>
              <label className="flex items-center space-x-2 text-slate-300">
                <input
                  type="checkbox"
                  checked={options.fixTextXForm}
                  onChange={e => setOptions({ ...options, fixTextXForm: e.target.checked })}
                  className="rounded bg-slate-950 border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span>TxtWidth, TxtHeight y márgenes a cero como hijos directos de &lt;Shape&gt;</span>
              </label>
              <label className="flex items-center space-x-2 text-slate-300">
                <input
                  type="checkbox"
                  checked={options.normalizeFont}
                  onChange={e => setOptions({ ...options, normalizeFont: e.target.checked })}
                  className="rounded bg-slate-950 border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span>Normalizar familia de fuente tipográfica a Calibri</span>
              </label>
            </div>

            <div className="space-y-2">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-amber-400" /> Seguridad OpenXML
              </span>
              <p className="text-slate-400 leading-relaxed">
                El motor cumple al 100% las 5 Reglas de Oro XSD: celdas antes de &lt;Section&gt;, sin secciones ilegales, [Content_Types] intacto y conectores 1D protegidos.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Architecture V4.0 Banner: Guided 3-Step Pipeline */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl -z-10 pointer-events-none" />
          
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6 mb-6">
            <div>
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-semibold mb-2">
                <Zap className="w-3.5 h-3.5" />
                <span>Flujo de Máxima Fidelidad CAD Garantizada</span>
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">
                Conversión Híbrida en 2 Fases (Sin páginas en blanco en Visio)
              </h2>
              <p className="text-sm text-slate-400 mt-1 max-w-3xl">
                Unimos la precisión de nuestro pre-limpiador CAD con el exportador oficial de draw.io v26.0.16 y nuestro parcheador OpenXML para lograr una fidelidad milimétrica en esquemas de 8+ páginas.
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Esquema XSD 100% Estricto</span>
            </div>
          </div>

          {/* Step Progression Indicators */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-950/80 border border-cyan-500/30 rounded-xl p-4 flex items-start space-x-3 shadow-lg shadow-cyan-500/5">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-sm shrink-0 border border-cyan-500/30">
                1
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Pre-limpiar .drawio</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Rescata fuentes reales, elimina HTML contaminante y descomprime XML manteniendo intactos los stencils y grupos.
                </p>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-blue-500/30 rounded-xl p-4 flex items-start space-x-3 shadow-lg shadow-blue-500/5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-sm shrink-0 border border-blue-500/30">
                2
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Exportar en v26.0.16</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Abre draw.io v26.0.16 para traducir stencils vectoriales, conectores e imágenes a .vsdx con el motor nativo oficial.
                </p>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-emerald-500/30 rounded-xl p-4 flex items-start space-x-3 shadow-lg shadow-emerald-500/5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm shrink-0 border border-emerald-500/30">
                3
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Parcheador Quirúrgico</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Corrige los TextXForm y márgenes directamente en el .vsdx sin romper jamás el esquema XSD de Visio.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* WORKFLOW CARDS CONTAINER */}
        <div className="space-y-8">

          {/* ======================================================== */}
          {/* PASO 1: Subir .drawio original -> Obtener .drawio limpio */}
          {/* ======================================================== */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center space-x-3">
                <span className="w-8 h-8 rounded-full bg-cyan-500 text-slate-950 font-extrabold flex items-center justify-center text-sm shadow-md shadow-cyan-500/30">
                  1
                </span>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    Paso 1: Subir plano original .drawio o .xml
                  </h3>
                  <p className="text-xs text-slate-400">
                    Descompresión transparente, rescate profundo de estilos HTML y calibración de márgenes negativos.
                  </p>
                </div>
              </div>

              {drawioFile && (
                <button
                  onClick={() => setDrawioFile(null)}
                  className="text-xs text-slate-400 hover:text-red-400 flex items-center gap-1 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Limpiar
                </button>
              )}
            </div>

            {/* Dropzone for Drawio */}
            <div
              onDragOver={e => { e.preventDefault(); setIsDraggingDrawio(true); }}
              onDragLeave={() => setIsDraggingDrawio(false)}
              onDrop={e => {
                e.preventDefault();
                setIsDraggingDrawio(false);
                if (e.dataTransfer.files.length > 0) {
                  const f = e.dataTransfer.files[0];
                  if (f.name.endsWith('.drawio') || f.name.endsWith('.xml')) {
                    handleProcessDrawio(f);
                  } else {
                    alert('Por favor, arrastra un archivo .drawio o .xml en el Paso 1.');
                  }
                }
              }}
              onClick={() => drawioInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
                isDraggingDrawio
                  ? 'border-cyan-400 bg-cyan-950/20 shadow-lg shadow-cyan-500/10'
                  : 'border-slate-800 hover:border-slate-700 bg-slate-950/50 hover:bg-slate-950'
              }`}
            >
              <input
                ref={drawioInputRef}
                type="file"
                accept=".drawio,.xml"
                className="hidden"
                onChange={e => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleProcessDrawio(e.target.files[0]);
                  }
                }}
              />

              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="p-3 bg-cyan-500/10 rounded-2xl text-cyan-400 border border-cyan-500/20">
                  <Upload className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-200">
                    Arrastra tu archivo <span className="text-cyan-400">.drawio</span> o <span className="text-cyan-400">.xml</span> aquí
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Soporta planos eléctricos complejos de 8+ páginas con UserObjects, stencils e imágenes
                  </p>
                </div>
              </div>
            </div>

            {/* Processing indicator */}
            {isProcessingDrawio && (
              <div className="flex items-center justify-center space-x-2 py-4 text-cyan-400 text-sm">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Descomprimiendo páginas y rescatando tipografías CAD...</span>
              </div>
            )}

            {/* Diagnostics & Download for Drawio */}
            {drawioFile && drawioFile.status === 'success' && drawioFile.report && (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4 animate-fadeIn">
                <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-3">
                  <div className="flex items-center space-x-2">
                    <FileCheck className="w-5 h-5 text-cyan-400" />
                    <div>
                      <h4 className="text-sm font-bold text-white">{drawioFile.name}</h4>
                      <p className="text-xs text-slate-400">
                        {drawioFile.report.pagesCount} página(s) procesadas ({drawioFile.report.pagesDecompressed || 0} descomprimidas de Raw Deflate)
                      </p>
                    </div>
                  </div>

                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Listo para exportar
                  </span>
                </div>

                {/* 5 Real-world CAD Diagnostic Indicators */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <div className="bg-slate-900 border border-slate-800/80 p-3 rounded-lg">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider block font-semibold">Páginas Descomprimidas</span>
                    <span className="text-base font-bold text-cyan-400 mt-1 block">
                      {drawioFile.report.pagesDecompressed || 0} / {drawioFile.report.pagesCount}
                    </span>
                  </div>

                  <div className="bg-slate-900 border border-slate-800/80 p-3 rounded-lg">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider block font-semibold">Fuentes Rescatadas</span>
                    <span className="text-base font-bold text-cyan-400 mt-1 block">
                      {drawioFile.report.htmlStylesRescued}
                    </span>
                  </div>

                  <div className="bg-slate-900 border border-slate-800/80 p-3 rounded-lg">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider block font-semibold">HTML Limpiado</span>
                    <span className="text-base font-bold text-cyan-400 mt-1 block">
                      {drawioFile.report.htmlTagsRemoved} tags
                    </span>
                  </div>

                  <div className="bg-slate-900 border border-slate-800/80 p-3 rounded-lg">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider block font-semibold">&lt;br&gt; Finales Eliminados</span>
                    <span className="text-base font-bold text-cyan-400 mt-1 block">
                      {drawioFile.report.trailingNewlinesRemoved || 0}
                    </span>
                  </div>

                  <div className="bg-slate-900 border border-slate-800/80 p-3 rounded-lg">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider block font-semibold">Márgenes Corregidos</span>
                    <span className="text-base font-bold text-cyan-400 mt-1 block">
                      {drawioFile.report.negativeMarginsCleared || 0}
                    </span>
                  </div>
                </div>

                {/* Main Action Buttons */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
                  <button
                    onClick={() => {
                      if (drawioFile.cleanDrawioBlob) {
                        const baseName = drawioFile.name.replace(/\.(drawio|xml)$/i, '');
                        triggerDownload(drawioFile.cleanDrawioBlob, `${baseName}-limpio.drawio`);
                      }
                    }}
                    className="flex-1 flex items-center justify-center space-x-2 px-5 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl shadow-lg shadow-cyan-500/20 transition text-sm"
                  >
                    <Download className="w-4 h-4" />
                    <span>1. Descargar .drawio Limpio (Listo para exportar)</span>
                  </button>

                  <button
                    onClick={handleDirectInternalConversion}
                    className="flex items-center justify-center space-x-2 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-xl border border-slate-700 transition text-xs"
                    title="Genera un archivo .vsdx directamente con el motor interno"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Generar .VSDX con Motor Interno</span>
                  </button>
                </div>

                {/* If internal VSDX was generated */}
                {drawioFile.vsdxBlob && (
                  <div className="bg-blue-950/30 border border-blue-500/30 rounded-xl p-4 flex items-center justify-between">
                    <div className="text-xs text-blue-300">
                      <span className="font-semibold block text-white">.VSDX generado internamente con éxito</span>
                      Tamaño: {(drawioFile.vsdxBlob.size / 1024).toFixed(1)} KB • {drawioFile.report.shapesCount} formas • {drawioFile.report.connectorsCount} conectores
                    </div>
                    <button
                      onClick={() => {
                        const baseName = drawioFile.name.replace(/\.(drawio|xml)$/i, '');
                        triggerDownload(drawioFile.vsdxBlob!, `${baseName}-directo.vsdx`);
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg text-xs flex items-center gap-1.5 transition"
                    >
                      <Download className="w-3.5 h-3.5" /> Descargar .VSDX Interno
                    </button>
                  </div>
                )}

                {/* Toggle Logs */}
                <div>
                  <button
                    onClick={() => setShowDrawioLogs(!showDrawioLogs)}
                    className="text-xs text-slate-400 hover:text-slate-200 flex items-center space-x-1"
                  >
                    <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{showDrawioLogs ? 'Ocultar bitácora de sanitización' : 'Ver bitácora detallada de sanitización'}</span>
                    {showDrawioLogs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>

                  {showDrawioLogs && (
                    <div className="mt-2 bg-slate-950 p-3 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300 max-h-48 overflow-y-auto space-y-1">
                      {drawioFile.report.logs.map((log, idx) => (
                        <div key={idx} className="leading-relaxed">{log}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>


          {/* ======================================================== */}
          {/* PASO 2: Exportar a .vsdx en draw.io v26.0.16             */}
          {/* ======================================================== */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex items-center space-x-3">
              <span className="w-8 h-8 rounded-full bg-blue-500 text-white font-extrabold flex items-center justify-center text-sm shadow-md shadow-blue-500/30">
                2
              </span>
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  Paso 2: Exportar a .VSDX con draw.io v26.0.16
                </h3>
                <p className="text-xs text-slate-400">
                  Abre el editor oficial para convertir stencils vectoriales, imágenes y conectores sin defectos.
                </p>
              </div>
            </div>

            <div className="bg-slate-950 border border-blue-500/20 rounded-xl p-5 space-y-4">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-blue-400" />
                    Puente Directo con draw.io v26.0.16
                  </h4>
                  <p className="text-xs text-slate-400 max-w-xl">
                    Abre el editor web oficial o tu aplicación de escritorio v26.0.16, abre el archivo limpio obtenido en el Paso 1 y expórtalo a formato Visio (.vsdx).
                  </p>
                </div>

                <a
                  href="https://mattie47.github.io/drawio/src/main/webapp/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-2 px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-600/20 transition text-sm shrink-0"
                >
                  <span>Abrir Editor Web draw.io v26.0.16</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>

              {/* Instructions steps */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-slate-900">
                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 text-xs space-y-1">
                  <span className="text-blue-400 font-bold block">1. Abrir Editor</span>
                  <p className="text-slate-400 leading-relaxed">
                    Pulsa el botón azul superior para abrir draw.io v26.0.16 en una nueva pestaña (o usa la app instalada).
                  </p>
                </div>

                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 text-xs space-y-1">
                  <span className="text-blue-400 font-bold block">2. Cargar .drawio Limpio</span>
                  <p className="text-slate-400 leading-relaxed">
                    Abre en draw.io el archivo descargado en el Paso 1 (con fuentes y textos ya calibrados).
                  </p>
                </div>

                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 text-xs space-y-1">
                  <span className="text-blue-400 font-bold block">3. Exportar a VSDX</span>
                  <p className="text-slate-400 leading-relaxed">
                    En el menú de draw.io, selecciona <strong className="text-white">Archivo &gt; Exportar como &gt; VSDX (beta)</strong> y guárdalo.
                  </p>
                </div>
              </div>
            </div>
          </section>


          {/* ======================================================== */}
          {/* PASO 3: Parcheador Quirúrgico de .vsdx                    */}
          {/* ======================================================== */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center space-x-3">
                <span className="w-8 h-8 rounded-full bg-emerald-500 text-slate-950 font-extrabold flex items-center justify-center text-sm shadow-md shadow-emerald-500/30">
                  3
                </span>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    Paso 3 (Opcional): Parcheador Quirúrgico OpenXML (.vsdx)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Ajusta la alineación milimétrica de cajas de texto cumpliendo el esquema XSD estricto de Microsoft Visio.
                  </p>
                </div>
              </div>

              {vsdxFile && (
                <button
                  onClick={() => setVsdxFile(null)}
                  className="text-xs text-slate-400 hover:text-red-400 flex items-center gap-1 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Limpiar
                </button>
              )}
            </div>

            {/* Dropzone for VSDX */}
            <div
              onDragOver={e => { e.preventDefault(); setIsDraggingVsdx(true); }}
              onDragLeave={() => setIsDraggingVsdx(false)}
              onDrop={e => {
                e.preventDefault();
                setIsDraggingVsdx(false);
                if (e.dataTransfer.files.length > 0) {
                  const f = e.dataTransfer.files[0];
                  if (f.name.endsWith('.vsdx')) {
                    handleProcessVsdx(f);
                  } else {
                    alert('Por favor, arrastra un archivo .vsdx en el Paso 3.');
                  }
                }
              }}
              onClick={() => vsdxInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
                isDraggingVsdx
                  ? 'border-emerald-400 bg-emerald-950/20 shadow-lg shadow-emerald-500/10'
                  : 'border-slate-800 hover:border-slate-700 bg-slate-950/50 hover:bg-slate-950'
              }`}
            >
              <input
                ref={vsdxInputRef}
                type="file"
                accept=".vsdx"
                className="hidden"
                onChange={e => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleProcessVsdx(e.target.files[0]);
                  }
                }}
              />

              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="p-3 bg-emerald-500/10 rounded-2xl text-emerald-400 border border-emerald-500/20">
                  <ShieldCheck className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-200">
                    Arrastra el archivo <span className="text-emerald-400">.vsdx</span> exportado de draw.io aquí
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Aplica las 5 Reglas de Oro XSD: sin crear secciones ilegales y orden estricto de celdas antes de &lt;Section&gt;
                  </p>
                </div>
              </div>
            </div>

            {/* Processing indicator */}
            {isProcessingVsdx && (
              <div className="flex items-center justify-center space-x-2 py-4 text-emerald-400 text-sm">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Analizando paquete ZIP y aplicando parcheo XSD seguro...</span>
              </div>
            )}

            {/* Diagnostics & Download for VSDX */}
            {vsdxFile && vsdxFile.status === 'success' && vsdxFile.report && (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4 animate-fadeIn">
                <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-3">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <div>
                      <h4 className="text-sm font-bold text-white">{vsdxFile.name}</h4>
                      <p className="text-xs text-slate-400">
                        {vsdxFile.report.pagesCount} página(s) parcheadas con éxito • {(vsdxFile.report.outputVsdxSize! / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>

                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full font-medium">
                    <Check className="w-3.5 h-3.5" /> 100% Seguro para Visio
                  </span>
                </div>

                {/* 4 Surgical Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-slate-900 border border-slate-800/80 p-3 rounded-lg">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider block font-semibold">Páginas Verificadas</span>
                    <span className="text-base font-bold text-emerald-400 mt-1 block">
                      {vsdxFile.report.pagesCount}
                    </span>
                  </div>

                  <div className="bg-slate-900 border border-slate-800/80 p-3 rounded-lg">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider block font-semibold">Figuras 2D Calibradas</span>
                    <span className="text-base font-bold text-emerald-400 mt-1 block">
                      {vsdxFile.report.textBlocksFixed}
                    </span>
                  </div>

                  <div className="bg-slate-900 border border-slate-800/80 p-3 rounded-lg">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider block font-semibold">Conectores 1D Protegidos</span>
                    <span className="text-base font-bold text-emerald-400 mt-1 block">
                      {vsdxFile.report.shapesSkipped1D || 0}
                    </span>
                  </div>

                  <div className="bg-slate-900 border border-slate-800/80 p-3 rounded-lg">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider block font-semibold">Secciones Ilegales Removidas</span>
                    <span className="text-base font-bold text-emerald-400 mt-1 block">
                      {vsdxFile.report.invalidSectionsRemoved || 0}
                    </span>
                  </div>
                </div>

                {/* Main Action Button */}
                <div className="pt-2">
                  <button
                    onClick={() => {
                      if (vsdxFile.vsdxBlob) {
                        const baseName = vsdxFile.name.replace(/\.vsdx$/i, '');
                        triggerDownload(vsdxFile.vsdxBlob, `${baseName}-reparado.vsdx`);
                      }
                    }}
                    className="w-full flex items-center justify-center space-x-2 px-5 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/20 transition text-sm"
                  >
                    <Download className="w-4 h-4" />
                    <span>3. Descargar .VSDX Reparado (100% Seguro para Visio)</span>
                  </button>
                </div>

                {/* Toggle Logs */}
                <div>
                  <button
                    onClick={() => setShowVsdxLogs(!showVsdxLogs)}
                    className="text-xs text-slate-400 hover:text-slate-200 flex items-center space-x-1"
                  >
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{showVsdxLogs ? 'Ocultar bitácora de parcheo' : 'Ver bitácora detallada de parcheo'}</span>
                    {showVsdxLogs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>

                  {showVsdxLogs && (
                    <div className="mt-2 bg-slate-950 p-3 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300 max-h-48 overflow-y-auto space-y-1">
                      {vsdxFile.report.logs.map((log, idx) => (
                        <div key={idx} className="leading-relaxed">{log}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 bg-slate-950 text-slate-500 text-xs text-center">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Motor Local en Navegador (Privacidad Total • Tus planos no viajan a ningún servidor)</span>
          </div>
          <div>
            <span>Drawio2Visio Fixer Pro • Versión 4.0 Definitiva Híbrida</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
