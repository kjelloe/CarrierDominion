// client/diagnostics.js - what GPU is actually rendering, and which preset
// suits it. Adapted from multiciv's tested version: the tier rules there were
// measured against real machines, so they are inherited rather than reinvented.
//
// suggestGraphicsLevel is pure - it takes the diagnostics object - so the tier
// logic is testable headless without a browser.

function getGraphicsDiagnostics() {
  let webgl2 = null;
  let webgl1 = null;
  let why = null;
  // A refused context fires webglcontextcreationerror with a statusMessage
  // saying WHY (blocklisted driver, acceleration off, ANGLE failed). Without
  // it, a blocked player only ever learns "unavailable".
  const onFail = (e) => { if (!why && e.statusMessage) why = e.statusMessage; };
  try {
    const c = document.createElement('canvas');
    c.addEventListener('webglcontextcreationerror', onFail, false);
    webgl2 = c.getContext('webgl2');
  } catch { /* unsupported */ }
  try {
    const c = document.createElement('canvas');
    c.addEventListener('webglcontextcreationerror', onFail, false);
    webgl1 = c.getContext('webgl') || c.getContext('experimental-webgl');
  } catch { /* unsupported */ }

  const gl = webgl2 || webgl1;
  const diag = { webgl2: Boolean(webgl2), webgl1: Boolean(webgl1), renderer: '', vendor: '', why: why };
  if (gl) {
    // Firefox reports the real GPU through plain RENDERER/VENDOR; Chrome and
    // Safari mask those, so fall back to the debug extension only when needed.
    diag.renderer = String(gl.getParameter(gl.RENDERER) ?? '');
    diag.vendor = String(gl.getParameter(gl.VENDOR) ?? '');
    if (/webkit|mozilla|apple gpu/i.test(`${diag.renderer} ${diag.vendor}`)) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      if (info) {
        diag.renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '');
        diag.vendor = String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL) ?? '');
      }
    }
  }
  return diag;
}

function suggestGraphicsLevel(diag) {
  if (!diag || (!diag.webgl2 && !diag.webgl1)) return 'low';
  const gpu = String(diag.renderer || '');
  if (/swiftshader|warp|llvmpipe|softpipe|basic render|software|d3d9/i.test(gpu)) return 'low';
  // Gemini/Amber-Lake-class Intel (UHD 600-617) measured ~48 fps at medium in
  // the sibling project; start them low, medium is one click away.
  if (/UHD Graphics 6[01][0-9]\b/i.test(gpu)) return 'low';
  if (!diag.webgl2) return 'low';
  if (/geforce|rtx|gtx|quadro|radeon (rx|pro|vii)|apple m\d/i.test(gpu)) return 'high';
  return 'medium';
}

function describeGpu(diag) {
  if (!diag) return 'unknown';
  if (!diag.webgl2 && !diag.webgl1) return `no WebGL${diag.why ? ` (${diag.why})` : ''}`;
  const api = diag.webgl2 ? 'WebGL2' : 'WebGL1';
  return `${api} - ${diag.renderer || 'unnamed GPU'}`;
}

export { getGraphicsDiagnostics, suggestGraphicsLevel, describeGpu };
