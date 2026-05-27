import { seconds } from "@avt/core-units";
import type { CameraSource, FrameLike } from "@avt/contracts";

/**
 * getUserMedia camera source — the universal fallback (and detector frame source
 * in all modes). Exposes the live <video> element as the frame's pixel source.
 * Device-only.
 */
export class GumCameraSource implements CameraSource {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  width = 0;
  height = 0;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    const video = document.createElement("video");
    video.srcObject = this.stream;
    video.playsInline = true;
    video.muted = true;
    video.setAttribute("playsinline", "");
    await video.play();
    this.video = video;
    this.width = video.videoWidth || 1280;
    this.height = video.videoHeight || 720;
  }

  /** The underlying element, for use as a WebGL background texture. */
  get element(): HTMLVideoElement | null {
    return this.video;
  }

  latestFrame(): FrameLike | null {
    if (!this.video || this.video.readyState < 2) return null;
    return {
      width: this.video.videoWidth,
      height: this.video.videoHeight,
      tSec: seconds(performance.now() / 1000),
      source: this.video,
    };
  }

  async stop(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.video?.pause();
    this.video = null;
    this.stream = null;
  }
}
