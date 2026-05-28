// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { applyI18n, getLang, initLang, setLang, t } from "../src/i18n/i18n.js";

describe("i18n", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "";
    document.documentElement.dir = "";
    initLang();
  });

  it("returns the English string by default", () => {
    expect(t("ui.distance")).toBe("Distance");
    expect(t("status.tracking")).toBe("Tracking");
  });

  it("returns the key for an unknown lookup (no crash)", () => {
    expect(t("nope.nope")).toBe("nope.nope");
  });

  it("switches to Hebrew, flips dir to rtl, and translates strings", () => {
    setLang("he");
    expect(getLang()).toBe("he");
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("he");
    expect(t("ui.distance")).toBe("מרחק");
    expect(t("status.tracking")).toBe("במעקב");
  });

  it("persists the choice across an initLang() round-trip", () => {
    setLang("he");
    initLang();
    expect(getLang()).toBe("he");
  });

  it("applyI18n rewrites elements carrying data-i18n / data-i18n-placeholder", () => {
    document.body.innerHTML =
      '<p data-i18n="ui.distance">x</p><input data-i18n-placeholder="dialog.name_placeholder" />';
    setLang("en");
    applyI18n();
    expect(document.querySelector("p")?.textContent).toBe("Distance");
    expect((document.querySelector("input") as HTMLInputElement).placeholder).toContain("Dad");
    setLang("he");
    expect(document.querySelector("p")?.textContent).toBe("מרחק");
    expect((document.querySelector("input") as HTMLInputElement).placeholder).toContain("אבא");
  });
});
