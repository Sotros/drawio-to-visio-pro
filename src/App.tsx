import React, { useState, useRef, useCallback } from 'react';
import {
  FileCode,
  Upload,
  Download,
  CheckCircle2,
  AlertTriangle,
  Info,
  RefreshCw,
  Sliders,
  Sparkles,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  Trash2,
  Terminal,
  Layers,
  Cpu,
  Image as ImageIcon,
  GitBranch,
  Type,
  Box
} from 'lucide-react';
import { ConversionOptions, DEFAULT_OPTIONS, ProcessedFileItem } from './types';
import { convertDrawioToVsdx } from './core/drawioToVsdx';
import { patchVsdx } from './core/vsdxPatcher';
import { SAMPLE_DRAWIO_XML } from './data/sampleDiagram';

export default function App() {
  const [options, setOptions] = useState<ConversionOptions>(DEFAULT_OPTIONS);
  const [files, setFiles] = useState<ProcessedFileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Toggle log expansion
  const toggleLog = (id: string) => {
    setExpandedLogs(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Process a single file
  const processFile = async (
    file: File | { name: string; size: number; text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> },
    currentOptions: ConversionOptions
  ): Promise<ProcessedFileItem> => {
    const isVsdx = file.name.toLowerCase().endsWith('.vsdx');
    const isDrawio = file.name.toLowerCase().endsWith('.drawio') || file.name.toLowerCase().endsWith('.xml');
    const fileId = `${file.name}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const item: ProcessedFileItem = {
      id: fileId,
      file: file as File,
      name: file.name,
      size: file.size,
      type: isVsdx ? 'vsdx' : 'drawio',
      status: 'processing'
    };

    try {
      if (isVsdx) {
        // Mode 2: Direct VSDX Patcher
        const arrayBuffer = await file.arrayBuffer();
        const patchResult = await patchVsdx(arrayBuffer, currentOptions);

        return {
          ...item,
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
            nestedResolvedCount: 0,
            warnings: patchResult.report.warnings || [],
            logs: patchResult.report.logs || [],
            status: 'success',
            outputVsdxSize: patchResult.patchedBlob.size
          }
        };
      } else if (isDrawio) {
        // Mode 1: Full CAD/Electrical Draw.io to VSDX Pipeline
        const textContent = await file.text();
        const conversionResult = await convertDrawioToVsdx(textContent, currentOptions);

        const cleanBlob = new Blob([conversionResult.cleanDrawioXml], { type: 'application/xml' });

        return {
          ...item,
          status: 'success',
          vsdxBlob: conversionResult.vsdxBlob,
          cleanDrawioBlob: cleanBlob,
          report: {
            ...conversionResult.report,
            fileName: file.name,
            outputVsdxSize: conversionResult.vsdxBlob.size,
            outputDrawioSize: cleanBlob.size
          }
        };
      } else {
        throw new Error('Extensión no admitida. Por favor, sube un archivo .drawio, .xml o .vsdx.');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Error inesperado durante el procesamiento';
      return {
        ...item,
        status: 'error',
        error: errMsg,
        report: {
          fileName: file.name,
          fileType: isVsdx ? 'vsdx' : 'drawio',
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
      };
    }
  };

  // Add files to state and process them
  const handleFilesAdded = useCallback(async (newFiles: File[]) => {
    if (newFiles.length === 0) return;
    setIsProcessingBatch(true);

    const initialItems: ProcessedFileItem[] = newFiles.map(f => ({
      id: `${f.name}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      file: f,
      name: f.name,
      size: f.size,
      type: f.name.toLowerCase().endsWith('.vsdx') ? 'vsdx' : 'drawio',
      status: 'processing'
    }));

    setFiles(prev => [...initialItems, ...prev]);

    // Process each file
    const processedResults: ProcessedFileItem[] = [];
    for (const f of newFiles) {
      const res = await processFile(f, options);
      processedResults.push(res);
    }

    setFiles(prev => {
      return prev.map(existing => {
        const found = processedResults.find(p => p.name === existing.name && existing.status === 'processing');
        return found ? found : existing;
      });
    });

    setIsProcessingBatch(false);
  }, [options]);

  // Handle Drag & Drop
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAdded(Array.from(e.dataTransfer.files));
    }
  };

  // Load sample electrical/CAD diagram
  const handleLoadSample = async () => {
    const sampleBlob = new Blob([SAMPLE_DRAWIO_XML], { type: 'application/xml' });
    const sampleFile = new File([sampleBlob], 'plano-electrico-U3-U4.drawio', { type: 'application/xml' });
    await handleFilesAdded([sampleFile]);
  };

  // Download helpers
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

  const downloadVsdx = (item: ProcessedFileItem) => {
    if (!item.vsdxBlob) return;
    const baseName = item.name.replace(/\.(drawio|xml|vsdx)$/i, '');
    triggerDownload(item.vsdxBlob, `${baseName}_visio_cad.vsdx`);
  };

  const downloadCleanDrawio = (item: ProcessedFileItem) => {
    if (!item.cleanDrawioBlob) return;
    const baseName = item.name.replace(/\.(drawio|xml|vsdx)$/i, '');
    triggerDownload(item.cleanDrawioBlob, `${baseName}_sanitized.drawio`);
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const clearAllFiles = () => {
    setFiles([]);
  };

  const reprocessAll = async () => {
    if (files.length === 0) return;
    setIsProcessingBatch(true);
    const updatedFiles: ProcessedFileItem[] = [];
    for (const item of files) {
      const res = await processFile(item.file, options);
      updatedFiles.push(res);
    }
    setFiles(updatedFiles);
    setIsProcessingBatch(false);
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-linear-to-tr from-brand-700 to-brand-500 flex items-center justify-center text-white shadow-md shadow-brand-500/20">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">Drawio2Visio Fixer Pro</h1>
                <span className="bg-brand-100 text-brand-800 text-xs px-2 py-0.5 rounded-full font-medium border border-brand-200">
                  CAD &amp; Electrical Edition
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                Conversor y Reparador OpenXML .VSDX para planos eléctricos y diagramas draw.io
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span className="inline-flex items-center text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1">
              <ShieldCheck className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
              100% Local en Navegador
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Hero Banner */}
        <section className="bg-linear-to-r from-slate-900 via-brand-950 to-slate-900 rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
          <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 pointer-events-none flex items-center justify-center">
            <Layers className="w-96 h-96 transform translate-x-12 -translate-y-6" />
          </div>

          <div className="relative z-10 max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-1.5 bg-brand-500/20 text-brand-300 text-xs px-3 py-1 rounded-full border border-brand-400/30 font-medium">
              <Sparkles className="w-3.5 h-3.5 text-brand-300" />
              Fidelidad milimétrica para planos eléctricos, CAD y automatización
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Convierte y repara diagramas draw.io a Microsoft Visio sin desajustes
            </h2>
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
              Resuelve jerarquías profundas de 3+ niveles (<code className="text-brand-300 font-mono">&lt;UserObject&gt;</code> y placas U3/U4),
              rescata fuentes reales anidadas bajo contenedores de 1px, traza conectores ortogonales con codos, decodifica stencils vectoriales e incrusta imágenes en <code className="text-brand-300 font-mono">visio/media/</code>.
            </p>
          </div>
        </section>

        {/* Configuration Panel */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
            <div className="flex items-center space-x-2">
              <Sliders className="w-5 h-5 text-brand-600" />
              <h3 className="text-base font-semibold text-slate-900">Panel de Configuración de Conversión y Parcheo</h3>
            </div>
            {files.length > 0 && (
              <button
                onClick={reprocessAll}
                disabled={isProcessingBatch}
                className="inline-flex items-center text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isProcessingBatch ? 'animate-spin' : ''}`} />
                Re-procesar archivos
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Option 1 */}
            <label className="flex items-start space-x-3 p-3.5 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50/50 transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={options.rescueHtmlStyles}
                onChange={(e) => setOptions({ ...options, rescueHtmlStyles: e.target.checked })}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
              />
              <div>
                <span className="text-sm font-semibold text-slate-800 flex items-center">
                  <Type className="w-3.5 h-3.5 mr-1.5 text-brand-600" />
                  1. Rescatar tamaños, colores y estilos desde etiquetas HTML internas
                </span>
                <span className="text-xs text-slate-500 leading-normal block mt-1">
                  Ignora contenedores externos de 1px y extrae el tamaño real (&gt;2px), colores RGB/Hex, negritas y tipografía antes de eliminar etiquetas.
                </span>
              </div>
            </label>

            {/* Option 2 */}
            <label className="flex items-start space-x-3 p-3.5 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50/50 transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={options.resolveUserObjects}
                onChange={(e) => setOptions({ ...options, resolveUserObjects: e.target.checked })}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
              />
              <div>
                <span className="text-sm font-semibold text-slate-800 flex items-center">
                  <Box className="w-3.5 h-3.5 mr-1.5 text-purple-600" />
                  2. Resolver UserObjects y coordenadas de grupos anidados (3+ niveles)
                </span>
                <span className="text-xs text-slate-500 leading-normal block mt-1">
                  Hereda IDs y labels desde <code>&lt;UserObject&gt;</code> y calcula coordenadas acumuladas en cascada considerando rotaciones de placas padre.
                </span>
              </div>
            </label>

            {/* Option 3 */}
            <label className="flex items-start space-x-3 p-3.5 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50/50 transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={options.routeOrthogonalConnectors}
                onChange={(e) => setOptions({ ...options, routeOrthogonalConnectors: e.target.checked })}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
              />
              <div>
                <span className="text-sm font-semibold text-slate-800 flex items-center">
                  <GitBranch className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                  3. Trazar conectores ortogonales y puntos de codo (&lt;Array as='points'&gt;)
                </span>
                <span className="text-xs text-slate-500 leading-normal block mt-1">
                  Calcula puntos de anclaje (exitX/entryY), genera codos ortogonales limpios y vincula dinámicamente flechas en <code>&lt;Connects&gt;</code>.
                </span>
              </div>
            </label>

            {/* Option 4 */}
            <label className="flex items-start space-x-3 p-3.5 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50/50 transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={options.convertStencilsAndImages}
                onChange={(e) => setOptions({ ...options, convertStencilsAndImages: e.target.checked })}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
              />
              <div>
                <span className="text-sm font-semibold text-slate-800 flex items-center">
                  <ImageIcon className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                  4. Convertir stencils, líneas de cajetín e incrustar imágenes Base64
                </span>
                <span className="text-xs text-slate-500 leading-normal block mt-1">
                  Decodifica <code>shape=stencil(...)</code>, fuerza 0.75pt en líneas de 1px e incrusta bitmaps en <code>visio/media/</code> con ForeignData.
                </span>
              </div>
            </label>

            {/* Option 5 */}
            <label className="flex items-start space-x-3 p-3.5 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50/50 transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={options.adjustTextBoxesAndRotations}
                onChange={(e) => setOptions({ ...options, adjustTextBoxesAndRotations: e.target.checked })}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
              />
              <div>
                <span className="text-sm font-semibold text-slate-800 flex items-center">
                  <Sliders className="w-3.5 h-3.5 mr-1.5 text-amber-600" />
                  5. Ajustar cajas de texto sin márgenes negativos y aplicar rotaciones (90°/270°)
                </span>
                <span className="text-xs text-slate-500 leading-normal block mt-1">
                  Aplica fórmulas <code>TextXForm</code> con <code>TxtAngle=0</code>, fija márgenes en 0 para etiquetas de 10px y mapea ángulos en radianes.
                </span>
              </div>
            </label>
          </div>
        </section>

        {/* Drag & Drop Upload Zone */}
        <section
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all ${
            isDragging
              ? 'border-brand-500 bg-brand-50/50 scale-[1.005]'
              : 'border-slate-300 bg-white hover:border-slate-400'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleFilesAdded(Array.from(e.target.files));
              }
            }}
            multiple
            accept=".drawio,.xml,.vsdx"
            className="hidden"
          />

          <div className="mx-auto w-16 h-16 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-4 shadow-inner">
            <Upload className="w-8 h-8" />
          </div>

          <h3 className="text-lg font-bold text-slate-900 mb-1">
            Arrastra y suelta tus planos eléctricos y diagramas aquí
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
            Admite archivos <strong>.drawio</strong>, exportaciones <strong>.xml</strong> de draw.io o paquetes <strong>.vsdx</strong> para reparación directa.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-xl shadow-md shadow-brand-600/20 transition-colors text-sm cursor-pointer"
            >
              <Upload className="w-4 h-4 mr-2" />
              Seleccionar archivos desde mi equipo
            </button>

            <button
              type="button"
              onClick={handleLoadSample}
              disabled={isProcessingBatch}
              className="inline-flex items-center px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl border border-slate-200 transition-colors text-sm cursor-pointer"
            >
              <Sparkles className="w-4 h-4 mr-2 text-amber-500" />
              Cargar plano eléctrico de prueba (U3-U4 con 3 niveles)
            </button>
          </div>
        </section>

        {/* Processed Files List & Actions */}
        {files.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                <span>Archivos Procesados ({files.length})</span>
              </h3>
              <button
                onClick={clearAllFiles}
                className="text-xs text-rose-600 hover:text-rose-800 font-medium inline-flex items-center cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Limpiar lista
              </button>
            </div>

            <div className="space-y-4">
              {files.map((item) => {
                const isExpanded = !!expandedLogs[item.id];
                const report = item.report;

                return (
                  <div
                    key={item.id}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs transition-all hover:shadow-md"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      {/* File Info */}
                      <div className="flex items-start space-x-3.5 min-w-0">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                          item.type === 'vsdx'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {item.type === 'vsdx' ? <FileCheck2 className="w-6 h-6" /> : <FileCode className="w-6 h-6" />}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center space-x-2">
                            <h4 className="text-sm font-bold text-slate-900 truncate max-w-sm sm:max-w-md">
                              {item.name}
                            </h4>
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                              item.type === 'vsdx'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}>
                              {item.type}
                            </span>
                          </div>

                          <div className="flex items-center space-x-3 text-xs text-slate-500 mt-1">
                            <span>Tamaño: {formatBytes(item.size)}</span>
                            <span>•</span>
                            <span className="flex items-center">
                              {item.status === 'processing' && (
                                <span className="text-brand-600 font-medium flex items-center">
                                  <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Procesando...
                                </span>
                              )}
                              {item.status === 'success' && (
                                <span className="text-emerald-600 font-medium flex items-center">
                                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Listo para descargar
                                </span>
                              )}
                              {item.status === 'error' && (
                                <span className="text-rose-600 font-medium flex items-center">
                                  <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Error en proceso
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Three Action Buttons */}
                      {item.status === 'success' && (
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Button 1: Complete VSDX Download */}
                          {item.vsdxBlob && (
                            <button
                              onClick={() => downloadVsdx(item)}
                              className="inline-flex items-center px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
                              title="Descarga el archivo OpenXML .VSDX con fidelidad CAD completa"
                            >
                              <Download className="w-4 h-4 mr-1.5" />
                              Descargar .VSDX completo para Visio
                            </button>
                          )}

                          {/* Button 2: Direct VSDX Repair */}
                          {item.type === 'vsdx' && item.vsdxBlob && (
                            <button
                              onClick={() => downloadVsdx(item)}
                              className="inline-flex items-center px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium text-xs rounded-xl border border-blue-200 transition-colors cursor-pointer"
                              title="Repara y descarga el archivo .VSDX existente"
                            >
                              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                              Reparar archivo .VSDX existente
                            </button>
                          )}

                          {/* Button 3: Sanitized Drawio Download */}
                          {item.cleanDrawioBlob && (
                            <button
                              onClick={() => downloadCleanDrawio(item)}
                              className="inline-flex items-center px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-xl border border-slate-200 transition-colors cursor-pointer"
                              title="Descarga el archivo .drawio limpio para draw.io v26.0.16"
                            >
                              <FileCode className="w-3.5 h-3.5 mr-1.5 text-amber-600" />
                              Descargar .drawio sanitizado
                            </button>
                          )}

                          {/* Remove button */}
                          <button
                            onClick={() => removeFile(item.id)}
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                            title="Eliminar de la lista"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Quick Metrics Bar for CAD & Electrical Schematics V3.0 */}
                    {report && item.status === 'success' && (
                      <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2">
                        <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Páginas</span>
                          <span className="text-sm font-extrabold text-slate-800">{report.pagesCount}</span>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">UserObjects</span>
                          <span className="text-sm font-extrabold text-purple-700">{report.userObjectsResolved}</span>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Estilos HTML</span>
                          <span className="text-sm font-extrabold text-emerald-600">{report.htmlStylesRescued}</span>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Conectores 2D</span>
                          <span className="text-sm font-extrabold text-blue-700">{report.orthogonalConnectorsCount}</span>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Imágenes Media</span>
                          <span className="text-sm font-extrabold text-amber-700">{report.imagesEmbedded}</span>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Bordes Fantasma</span>
                          <span className="text-sm font-extrabold text-rose-600">{report.ghostBordersCleared}</span>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Hairlines CAD</span>
                          <span className="text-sm font-extrabold text-teal-700">{report.hairlinesPreserved}</span>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">TextXForm</span>
                          <span className="text-sm font-extrabold text-indigo-700">{report.textBlocksFixed}</span>
                        </div>
                      </div>
                    )}

                    {/* Diagnostic Console Collapsible */}
                    {report && (
                      <div className="mt-3">
                        <button
                          onClick={() => toggleLog(item.id)}
                          className="w-full flex items-center justify-between text-xs font-semibold text-slate-600 hover:text-slate-900 py-1.5 px-2 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          <span className="flex items-center space-x-1.5">
                            <Terminal className="w-3.5 h-3.5 text-slate-500" />
                            <span>Consola de Diagnóstico &amp; Auditoría OpenXML</span>
                            {report.warnings.length > 0 && (
                              <span className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.2 rounded font-bold">
                                {report.warnings.length} advertencia(s)
                              </span>
                            )}
                          </span>
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>

                        {isExpanded && (
                          <div className="mt-2 bg-slate-950 text-slate-200 rounded-xl p-4 font-mono text-xs space-y-1.5 overflow-x-auto max-h-60 overflow-y-auto border border-slate-800">
                            <div className="text-slate-400 pb-1 border-b border-slate-800 text-[11px] flex justify-between">
                              <span>== Registro de eventos CAD/OpenXML ==</span>
                              <span>{report.fileName}</span>
                            </div>
                            {report.logs.map((log, lIdx) => (
                              <div key={lIdx} className="leading-relaxed">
                                <span className="text-brand-400 mr-2">›</span>
                                {log}
                              </div>
                            ))}
                            {report.warnings.map((warn, wIdx) => (
                              <div key={wIdx} className="text-amber-400 leading-relaxed">
                                <span className="text-amber-500 mr-2">▲</span>
                                {warn}
                              </div>
                            ))}
                            {item.error && (
                              <div className="text-rose-400 leading-relaxed font-bold">
                                <span className="text-rose-500 mr-2">✖</span>
                                {item.error}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Technical Explanations Card */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-5">
          <div className="flex items-center space-x-2.5">
            <Info className="w-5 h-5 text-brand-600" />
            <h3 className="text-base font-bold text-slate-900">
              ¿Cómo garantiza Drawio2Visio Fixer Pro la fidelidad en planos eléctricos y CAD?
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs sm:text-sm text-slate-600 leading-relaxed">
            <div className="space-y-1.5 p-4 rounded-xl bg-slate-50 border border-slate-100">
              <h4 className="font-bold text-slate-800 flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-500 inline-block"></span>
                <span>Resolución de UserObjects y Jerarquías de 3+ Niveles</span>
              </h4>
              <p>
                Mapea contenedores padre (placas U3, U4), conectores intermedios y pines hijos acumulando sus coordenadas relativas y compensando cualquier rotación angular del contenedor padre.
              </p>
            </div>

            <div className="space-y-1.5 p-4 rounded-xl bg-slate-50 border border-slate-100">
              <h4 className="font-bold text-slate-800 flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-brand-500 inline-block"></span>
                <span>Extractor de Estilos HTML Profundos (Bypassing 1px)</span>
              </h4>
              <p>
                Extrae el tamaño real del texto (ej. 26.25px, 17.5px, 8.47px) alojado en <code>&lt;font&gt;</code> y <code>&lt;span&gt;</code> internos, ignorando el wrapper de 1px e inyectándolo exactamente en la sección <code>Character</code> de Visio (px a pt).
              </p>
            </div>

            <div className="space-y-1.5 p-4 rounded-xl bg-slate-50 border border-slate-100">
              <h4 className="font-bold text-slate-800 flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>
                <span>Enrutamiento Ortogonal y Puntos de Codo</span>
              </h4>
              <p>
                Procesa listas <code>&lt;Array as="points"&gt;</code> calculando los puntos de anclaje (exitX/entryY) en las caras de los pines para generar polilíneas de cables nítidas con vinculación dinámica en <code>&lt;Connects&gt;</code>.
              </p>
            </div>

            <div className="space-y-1.5 p-4 rounded-xl bg-slate-50 border border-slate-100">
              <h4 className="font-bold text-slate-800 flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                <span>Líneas de Cajetín, Stencils e Imágenes Base64</span>
              </h4>
              <p>
                Asegura un grosor mínimo visible de 0.75pt para las líneas de 1px del cajetín, traduce primitivas de stencils XML a geometría nativa e incrusta imágenes en <code>visio/media/</code> con bloques <code>ForeignData</code>.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-12 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Drawio2Visio Fixer Pro • Procesamiento local seguro bajo estándares Ecma Office Open XML</span>
          <span>Especializado en Planos Eléctricos, Diagramas Unifilares, Automatización y CAD</span>
        </div>
      </footer>
    </div>
  );
}
