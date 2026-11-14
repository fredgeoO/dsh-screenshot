# dsh-screenshot

Plugin de capturas de pantalla para Windows para [DeepSeek Harness](https://github.com/deepseek-ai): dos herramientas para el modelo (`screenshot`, `list_windows`) y una skill de ejecución (`ui-visual-check`) que permiten al agente ver de verdad ventanas, páginas y el antes/después de un cambio de interfaz.

[English](README.md) · [中文](README_zh.md) · [日本語](README_ja.md) · **Español**

> Esta es una traducción de [README.md](README.md) (el original en inglés); si hay discrepancias, prevalece la versión inglesa.

## Por qué un plugin y una skill

Capturar la pantalla es una **capacidad**: necesita argumentos estructurados, valores de retorno estables y devolver la imagen al modelo, así que es una herramienta. Decidir cuándo capturar, qué ventana y cómo comparar el antes/después es un **procedimiento**, así que es una skill. La skill se registra con `ctx.skills.register()`, de modo que se instala y se retira junto con el plugin.

## Estructura del repositorio

```
plugin/dsh-screenshot/     # el plugin (@local/dsh-screenshot)
├─ index.js                # registro de herramientas, validación, detección de backend, retorno de imagen
├─ cordis.patch.yml        # configuración de despliegue (row config es el contrato)
├─ scripts/capture.py      # captura Win32 (límites DWM + recorte del rectángulo en pantalla + Pillow)
├─ skill/SKILL.md          # ui-visual-check: capturar, cambiar, volver a capturar
└─ test/                   # pruebas unitarias + pruebas de captura real
bin/obscura/               # binarios de Obscura (fuera de git, ver abajo)
```

## Primeros pasos

```powershell
git clone https://github.com/fredgeoO/dsh-screenshot C:\dev\dsh-screenshot
# edita %DSH_PROFILE_DIR%\package.json:
#   dependencies: añade "@local/dsh-screenshot": "link:C:/dev/dsh-screenshot/plugin/dsh-screenshot"
#   dsh.profile.bundles: añade "@local/dsh-screenshot"
$rt = "$env:DSH_HOME\dsh-runtimes\dsh-primary-runtime\dependencies"
Push-Location $env:DSH_PROFILE_DIR
& "$rt\node\bin\node.exe" "$rt\pnpm\bin\pnpm.cjs" install
Pop-Location
```

Después descomprime [Obscura](https://github.com/h4ckf0r0day/obscura) en `bin/obscura/` (backend para URL, ~30 MB de RAM; sin él, las capturas de URL usan Chrome/Edge), reinicia DSH y comprueba en una **sesión nueva** que aparecen `screenshot`, `list_windows` y `ui-visual-check`.

> ¿Le encargas la instalación a otro agente? Pásale [INSTALL.md](INSTALL.md) (en inglés, orientado a agentes): script de autodiagnóstico, checkpoints por paso y tabla de fallos.

## Uso

```text
screenshot({ target: "active" })
screenshot({ target: "window", window: "DeepSeek Harness", activate: true })
screenshot({ target: "screen" })
screenshot({ target: "url", url: "http://127.0.0.1:62714", width: 1440, height: 900 })
screenshot({ target: "active", region: { x: 0, y: 0, width: 800, height: 600 } })
list_windows({})
```

Las capturas de ventana se recortan del rectángulo visible en pantalla (`PrintWindow` devuelve negro en Electron/Chromium), así que la ventana debe estar visible. Una imagen negra se reporta como `SCREENSHOT_BLACK`, nunca como éxito.

## Requisitos

- Windows 10/11 y DSH Desktop (probado en `0.2.2-rc.3`).
- Python 3.12 + Pillow incluidos con DSH (detección automática).
- Obscura; para viewports exactos se usa Chrome y, si no está, Edge.
- Node 24 y pnpm 11 del runtime de DSH: no uses una toolchain global.

## Pruebas

```powershell
node test/unit.test.mjs     # no requiere DSH
node test/capture.test.mjs  # captura real; requiere sesión de escritorio
```

No uses `node --test`: las restricciones de tuberías en el sandbox provocan EPERM.

## Privacidad

Las capturas incluyen todo lo visible en pantalla (contraseñas, mensajes privados, claves) y se envían al proveedor del modelo como peticiones de imagen normales. Prefiere capturas de ventana en lugar de pantalla completa.

## Licencia

[MIT](LICENSE) © 2026 FredgeoO. El repositorio no incluye los binarios de Obscura; se descargan del upstream cuando hacen falta (Apache-2.0, independiente de este proyecto).
