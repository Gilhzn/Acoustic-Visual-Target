/**
 * Device-orientation (gyro/IMU) source. Reads the phone's tilt so the AR marker
 * can stay gravity-aligned and so heading is available to the UI. iOS 13+
 * requires a permission request from a user gesture — call start() from a tap.
 * Device-only; degrades gracefully when unavailable or denied.
 */
type OrientationCtor = {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export class GyroSource {
  available = false;
  /** Compass heading / yaw (deg). */
  alpha = 0;
  /** Front-back tilt (deg). */
  beta = 0;
  /** Left-right roll (deg). */
  gamma = 0;

  private readonly handler = (e: DeviceOrientationEvent): void => {
    this.alpha = e.alpha ?? this.alpha;
    this.beta = e.beta ?? this.beta;
    this.gamma = e.gamma ?? this.gamma;
    this.available = true;
  };

  async start(): Promise<boolean> {
    const D = (globalThis as { DeviceOrientationEvent?: OrientationCtor }).DeviceOrientationEvent;
    if (!D || typeof window === "undefined") return false;
    if (typeof D.requestPermission === "function") {
      try {
        if ((await D.requestPermission()) !== "granted") return false;
      } catch {
        return false;
      }
    }
    window.addEventListener("deviceorientation", this.handler, true);
    return true;
  }

  stop(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("deviceorientation", this.handler, true);
    }
  }
}
