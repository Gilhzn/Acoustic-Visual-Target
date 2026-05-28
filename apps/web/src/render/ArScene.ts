import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Three.js AR overlay. A transparent WebGL canvas composited over the camera
 * (WebXR passthrough, or a getUserMedia video background). A stylized character
 * is parented to the camera so EKF view-space coordinates place it directly.
 * Frustum culling suspends its draw when off-view. Device-only.
 */
export class ArScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly target: THREE.Group;

  private bgMesh: THREE.Mesh | null = null;
  private videoTexture: THREE.VideoTexture | null = null;
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.xr.enabled = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, this.aspect(), 0.05, 50);
    this.scene.add(this.camera);

    this.scene.add(new THREE.HemisphereLight(0xddeeff, 0x223344, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 2, 1);
    this.scene.add(key);

    // No default 3D AR marker — the on-screen thermal overlay and minimap
    // already pinpoint the target. A glTF marker can be loaded via
    // loadCharacterGltf() when wanted.
    this.target = new THREE.Group();
    this.target.visible = false;
    this.camera.add(this.target); // view-space placement

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private aspect(): number {
    return window.innerWidth / Math.max(window.innerHeight, 1);
  }

  /** Replace the (empty by default) marker group with a loaded glTF asset. */
  async loadCharacterGltf(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.target.clear();
    this.target.add(gltf.scene);
  }

  /** Show the live camera feed as a fullscreen background (getUserMedia path). */
  setVideoBackground(video: HTMLVideoElement): void {
    this.videoTexture = new THREE.VideoTexture(video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(2, 2);
    const matBg = new THREE.MeshBasicMaterial({ map: this.videoTexture, depthTest: false, depthWrite: false });
    matBg.toneMapped = false;
    this.bgMesh = new THREE.Mesh(geo, matBg);
    const bgScene = new THREE.Scene();
    bgScene.add(this.bgMesh);
    (this.scene.userData as { bgScene?: THREE.Scene }).bgScene = bgScene;
  }

  /**
   * The Chrome raw-camera-access crash workaround: force a classic XRWebGLLayer
   * instead of projection layers. Feature-detected — a no-op when the internal
   * flag is absent (never pinned to a browser version).
   */
  setForceWebGLLayer(force: boolean): void {
    const xr = this.renderer.xr as unknown as Record<string, unknown>;
    if ("supportsLayers" in xr) (xr as { supportsLayers: boolean }).supportsLayers = !force;
  }

  setPixelRatio(dpr: number): void {
    this.renderer.setPixelRatio(dpr);
  }

  setTargetVisible(v: boolean): void {
    this.target.visible = v;
  }

  /** Counter-rotate the marker by the device roll so it stays upright (gyro). */
  setUpright(rollDeg: number): void {
    this.target.rotation.z = (-rollDeg * Math.PI) / 180;
  }

  /** True if the target group is within the camera frustum. */
  isTargetInFrustum(): boolean {
    this.camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);
    const sphere = new THREE.Sphere(this.target.getWorldPosition(new THREE.Vector3()), 0.6);
    return this.frustum.intersectsSphere(sphere);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    const bgScene = (this.scene.userData as { bgScene?: THREE.Scene }).bgScene;
    if (this.videoTexture) this.videoTexture.needsUpdate = true;
    this.renderer.autoClear = true;
    if (bgScene && !this.renderer.xr.isPresenting) {
      this.renderer.render(bgScene, this.camera);
      this.renderer.autoClear = false;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Drive the render/XR loop; cb receives the optional XRFrame. */
  setLoop(cb: (t: number, frame?: XRFrame) => void): void {
    this.renderer.setAnimationLoop((t, frame) => {
      cb(t, frame as XRFrame | undefined);
      this.render();
    });
  }

  async enterXR(session: XRSession): Promise<void> {
    await this.renderer.xr.setSession(session as Parameters<THREE.WebXRManager["setSession"]>[0]);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}
