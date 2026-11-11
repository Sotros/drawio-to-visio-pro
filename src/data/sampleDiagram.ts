export const SAMPLE_DRAWIO_XML = `<mxfile host="app.diagrams.net" modified="2026-11-11T12:00:00.000Z" agent="Mozilla/5.0" version="26.0.16">
  <diagram id="diag-electrical-v3" name="Plano Eléctrico U3-U4 (V3.0)">
    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />

        <!-- 1. Cajetín y Marco: Líneas de 1px con strokeColor=#000000 y strokeWidth=0 (Hairline CAD) -->
        <mxCell id="frame-top" value="" style="strokeColor=#000000;strokeWidth=0;fillColor=none;" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="1080" height="1" as="geometry" />
        </mxCell>
        <mxCell id="frame-bottom" value="" style="strokeColor=#000000;strokeWidth=0;fillColor=none;" vertex="1" parent="1">
          <mxGeometry x="40" y="780" width="1080" height="1" as="geometry" />
        </mxCell>
        <mxCell id="frame-divider-v" value="" style="strokeColor=#000000;strokeWidth=0;fillColor=none;" vertex="1" parent="1">
          <mxGeometry x="580" y="40" width="1" height="740" as="geometry" />
        </mxCell>

        <!-- 2. Título de Cajetín con font-size: 1px externo, font-size real de 26.25px y strokeColor=none (Sin borde fantasma) -->
        <UserObject id="title-block" label="&lt;div style=&quot;font-size: 1px&quot;&gt;&lt;font style=&quot;font-size: 26.25px; font-family: Calibri; color: rgb(0, 0, 0);&quot;&gt;&lt;b&gt;ADRV GEN BOX B0-B5 JARMS&lt;/b&gt;&lt;/font&gt;&lt;/div&gt;">
          <mxCell style="text;html=1;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=0;strokeColor=none;fillColor=none;" vertex="1" parent="1">
            <mxGeometry x="50" y="50" width="450" height="40" as="geometry" />
          </mxCell>
        </UserObject>

        <!-- 3. Logo/Imagen Base64 Incrustada SIN ';base64' (data:image/png,<base64>) -->
        <mxCell id="logo-cajetin" value="" style="vsdxID=221;fillColor=none;gradientColor=none;image;aspect=fixed;image=data:image/png,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==;strokeColor=none;" vertex="1" parent="1">
          <mxGeometry x="1000" y="50" width="100" height="35" as="geometry" />
        </mxCell>

        <!-- 4. Placa Electrónica U3 (Nivel 1 de jerarquía) -->
        <UserObject id="U3" label="&lt;div style=&quot;font-size: 1px&quot;&gt;&lt;font style=&quot;font-size: 17.5px; font-family: Arial;&quot;&gt;&lt;b&gt;PLACA DE CONTROL U3&lt;/b&gt;&lt;/font&gt;&lt;/div&gt;">
          <mxCell style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#4672c4;strokeWidth=2;verticalAlign=top;spacingTop=10;" vertex="1" parent="1">
            <mxGeometry x="80" y="140" width="400" height="320" as="geometry" />
          </mxCell>
        </UserObject>

        <!-- 5. Bloque Conector J1 (Nivel 2 de jerarquía, anidado en U3) -->
        <UserObject id="CONN_J1" label="&lt;div style=&quot;font-size: 1px&quot;&gt;&lt;span style=&quot;font-size: 11.29px; color: rgb(0, 0, 0);&quot;&gt;CONECTOR J1&lt;/span&gt;&lt;/div&gt;">
          <mxCell style="rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#666666;strokeWidth=1.5;" vertex="1" parent="U3">
            <mxGeometry x="240" y="60" width="130" height="180" as="geometry" />
          </mxCell>
        </UserObject>

        <!-- 6. Pin 1 (Nivel 3 de jerarquía, anidado en CONN_J1) con rotación=90 (sin swap de width/height) -->
        <UserObject id="PIN_1" label="&lt;div style=&quot;font-size: 1px&quot;&gt;&lt;font style=&quot;font-size: 8.47px;&quot;&gt;&lt;span style=&quot;color: rgb(255, 255, 255); font-size: 8.47px;&quot;&gt;PIN 1 (VCC)&lt;/span&gt;&lt;/font&gt;&lt;/div&gt;">
          <mxCell style="rounded=0;whiteSpace=wrap;html=1;fillColor=#c00000;strokeColor=#000000;rotation=90;spacingTop=0;spacingBottom=0;spacingLeft=0;spacingRight=0;" vertex="1" parent="CONN_J1">
            <mxGeometry x="20" y="30" width="80" height="15" as="geometry" />
          </mxCell>
        </UserObject>

        <!-- 7. Pin 2 (Nivel 3 de jerarquía, anidado en CONN_J1) -->
        <UserObject id="PIN_2" label="&lt;div style=&quot;font-size: 1px&quot;&gt;&lt;font style=&quot;font-size: 8.47px;&quot;&gt;&lt;span style=&quot;color: rgb(0, 0, 0);&quot;&gt;PIN 2 (GND)&lt;/span&gt;&lt;/font&gt;&lt;/div&gt;">
          <mxCell style="rounded=0;whiteSpace=wrap;html=1;fillColor=#d9d9d9;strokeColor=#000000;strokeWidth=1;" vertex="1" parent="CONN_J1">
            <mxGeometry x="20" y="110" width="80" height="15" as="geometry" />
          </mxCell>
        </UserObject>

        <!-- 8. Placa Electrónica U4 (Nivel 1 de jerarquía) -->
        <UserObject id="U4" label="&lt;div style=&quot;font-size: 1px&quot;&gt;&lt;font style=&quot;font-size: 17.5px; font-family: Arial;&quot;&gt;&lt;b&gt;MÓDULO DE POTENCIA U4&lt;/b&gt;&lt;/font&gt;&lt;/div&gt;">
          <mxCell style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#00b050;strokeWidth=2;verticalAlign=top;spacingTop=10;" vertex="1" parent="1">
            <mxGeometry x="680" y="140" width="400" height="320" as="geometry" />
          </mxCell>
        </UserObject>

        <!-- 9. Conector J2 en U4 -->
        <UserObject id="CONN_J2" label="&lt;div style=&quot;font-size: 1px&quot;&gt;&lt;span style=&quot;font-size: 11.29px; color: rgb(0, 0, 0);&quot;&gt;CONECTOR J2&lt;/span&gt;&lt;/div&gt;">
          <mxCell style="rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#666666;strokeWidth=1.5;" vertex="1" parent="U4">
            <mxGeometry x="30" y="60" width="130" height="180" as="geometry" />
          </mxCell>
        </UserObject>

        <!-- 10. Pin 3 en CONN_J2 (Nivel 3) con fondo negro y texto blanco rescatado -->
        <UserObject id="PIN_3" label="&lt;div style=&quot;font-size: 1px&quot;&gt;&lt;span style=&quot;color: rgb(255, 255, 255); font-size: 8.47px;&quot;&gt;PIN 1 (PWR_IN)&lt;/span&gt;&lt;/div&gt;">
          <mxCell style="rounded=0;whiteSpace=wrap;html=1;fillColor=#000000;strokeColor=#000000;" vertex="1" parent="CONN_J2">
            <mxGeometry x="20" y="30" width="80" height="15" as="geometry" />
          </mxCell>
        </UserObject>

        <!-- 11. Conector Ortogonal 2D con Codos (<Array as="points">) entre PIN_1 y PIN_3 -->
        <mxCell id="wire-power" value="24V DC POWER" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#c00000;strokeWidth=2;dashed=1;exitX=1;exitY=0.5;entryX=0;entryY=0.5;" edge="1" parent="1" source="PIN_1" target="PIN_3">
          <mxGeometry relative="1" as="geometry">
            <Array as="points">
              <mxPoint x="550" y="240" />
              <mxPoint x="640" y="240" />
            </Array>
          </mxGeometry>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
