/**
 * WebXR immersive-AR session helpers. Everything is feature-detected at runtime
 * — no browser-version pinning. Device-only.
 */

export async function isImmersiveArSupported(): Promise<boolean> {
  const xr = navigator.xr;
  if (!xr) return false;
  try {
    return await xr.isSessionSupported("immersive-ar");
  } catch {
    return false;
  }
}

export interface ArSessionOpts {
  domOverlayRoot?: HTMLElement;
  /** Request raw camera access (Android Chrome). Optional — falls back silently. */
  cameraAccess?: boolean;
}

export async function requestArSession(opts: ArSessionOpts = {}): Promise<XRSession> {
  const xr = navigator.xr;
  if (!xr) throw new Error("WebXR not available");
  const optionalFeatures = ["local-floor", "dom-overlay"];
  if (opts.cameraAccess) optionalFeatures.push("camera-access");
  const init: XRSessionInit = { optionalFeatures };
  if (opts.domOverlayRoot) init.domOverlay = { root: opts.domOverlayRoot };
  return xr.requestSession("immersive-ar", init);
}

/**
 * Whether the session actually granted raw camera access (refines the
 * optimistic capability probe).
 */
export function sessionHasCameraAccess(session: XRSession): boolean {
  const features = (session as XRSession & { enabledFeatures?: string[] }).enabledFeatures;
  return Array.isArray(features) ? features.includes("camera-access") : false;
}
