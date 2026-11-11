import { ConversionOptions, DiagnosticReport } from '../types';
import { patchVsdx } from './vsdxPatcher';

export interface ExportBridgeStatus {
  isBundleLoaded: boolean;
  bundleVersion?: string;
}

/**
 * Bridge interface for executing draw.io's client-side VsdxExport engine
 * (for complex cloud icons such as AWS, Azure, GCP, Cisco stencils),
 * automatically piping the resulting .vsdx through vsdxPatcher.
 */
class DrawioExportBridge {
  private bundleLoaded = false;
  private workerInstance: Worker | null = null;

  /**
   * Checks if an external VsdxExport bundle is available in the browser window
   * (e.g. if loaded via script tag or uploaded by user).
   */
  public isAvailable(): boolean {
    if (typeof window !== 'undefined') {
      // Check for global VsdxExport or mxVsdxExport from draw.io export bundle
      return !!((window as unknown as Record<string, unknown>)['VsdxExport'] || this.bundleLoaded);
    }
    return false;
  }

  /**
   * Allows the user to load a custom draw.io export bundle (e.g. export-vsdx.min.js)
   * into a local Blob URL worker/iframe sandbox.
   */
  public async loadBundleFromScript(scriptContent: string): Promise<boolean> {
    try {
      const blob = new Blob([scriptContent], { type: 'application/javascript' });
      const scriptUrl = URL.createObjectURL(blob);
      const scriptTag = document.createElement('script');
      scriptTag.src = scriptUrl;
      scriptTag.async = true;

      await new Promise<void>((resolve, reject) => {
        scriptTag.onload = () => resolve();
        scriptTag.onerror = () => reject(new Error('No se pudo cargar el script de VsdxExport.'));
        document.head.appendChild(scriptTag);
      });

      this.bundleLoaded = true;
      return true;
    } catch {
      this.bundleLoaded = false;
      return false;
    }
  }

  /**
   * Executes conversion through the external bundle if present,
   * then pipes the output through vsdxPatcher for TextXForm and OpenXML hardening.
   */
  public async exportAndPatch(
    xmlContent: string,
    options: ConversionOptions
  ): Promise<{
    patchedBlob: Blob;
    report: Partial<DiagnosticReport>;
  }> {
    if (!this.isAvailable()) {
      throw new Error(
        'El bundle VsdxExport de draw.io no está cargado. Se utilizará el conversor nativo integrado de Drawio2Visio Fixer Pro.'
      );
    }

    const windowRef = window as unknown as Record<string, unknown>;
    const vsdxExportFunc = windowRef['VsdxExport'] as ((xml: string) => Promise<ArrayBuffer | Blob>) | undefined;

    if (!vsdxExportFunc) {
      throw new Error('Función VsdxExport no encontrada en el ámbito global.');
    }

    // Generate raw VSDX from the bundle
    const rawVsdx = await vsdxExportFunc(xmlContent);

    // Pipe through vsdxPatcher to fix TextXForm, LockTextEdit, and font scaling
    const patched = await patchVsdx(rawVsdx, options);

    return {
      patchedBlob: patched.patchedBlob,
      report: {
        ...patched.report,
        logs: [
          '[Bridge] Diagrama exportado mediante bundle VsdxExport de draw.io',
          ...(patched.report.logs || [])
        ]
      }
    };
  }

  /**
   * Cleans up worker instances if allocated.
   */
  public dispose(): void {
    if (this.workerInstance) {
      this.workerInstance.terminate();
      this.workerInstance = null;
    }
  }
}

export const drawioBridge = new DrawioExportBridge();

