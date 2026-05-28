import { getLang, onLangChange, setLang, type Lang } from "../i18n/i18n.js";

export type View = "main" | "analysis";

/** Slide-in menu drawer with view navigation and a language toggle. */
export class Menu {
  private readonly drawer: HTMLElement;
  private readonly trigger: HTMLElement;
  private readonly listeners = new Set<(v: View) => void>();
  private currentView: View = "main";

  constructor() {
    this.trigger = el("menu-brand");
    this.drawer = el("drawer");
    const close = el("drawer-close");
    this.trigger.addEventListener("click", () => this.open());
    close.addEventListener("click", () => this.close());
    document.addEventListener("click", (e) => {
      if (!this.drawer.classList.contains("open")) return;
      const t = e.target as Node;
      if (this.drawer.contains(t) || this.trigger.contains(t)) return;
      this.close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.drawer.classList.contains("open")) this.close();
    });

    this.drawer.querySelectorAll<HTMLElement>("[data-view]").forEach((b) => {
      b.addEventListener("click", () => {
        const v = b.getAttribute("data-view") as View;
        this.setView(v);
        this.close();
      });
    });
    this.drawer.querySelectorAll<HTMLElement>("[data-lang]").forEach((b) => {
      b.addEventListener("click", () => {
        const v = b.getAttribute("data-lang");
        if (v === "en" || v === "he") setLang(v);
      });
    });
    this.refreshLangButtons();
    onLangChange(() => this.refreshLangButtons());
    document.body.setAttribute("data-view", "main");
  }

  open(): void {
    this.drawer.classList.add("open");
    this.drawer.setAttribute("aria-hidden", "false");
  }
  close(): void {
    this.drawer.classList.remove("open");
    this.drawer.setAttribute("aria-hidden", "true");
  }

  setView(v: View): void {
    this.currentView = v;
    document.body.setAttribute("data-view", v);
    this.drawer.querySelectorAll<HTMLElement>("[data-view]").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-view") === v);
    });
    for (const fn of this.listeners) fn(v);
  }

  get view(): View {
    return this.currentView;
  }

  onView(fn: (v: View) => void): void {
    this.listeners.add(fn);
  }

  private refreshLangButtons(): void {
    const cur: Lang = getLang();
    this.drawer.querySelectorAll<HTMLElement>("[data-lang]").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-lang") === cur);
    });
  }
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing element #${id}`);
  return e as T;
}
