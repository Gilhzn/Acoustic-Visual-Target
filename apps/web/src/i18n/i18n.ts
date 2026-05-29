/**
 * Minimal i18n: a static dictionary plus a `t(key)` lookup. The Hebrew strings
 * also flip the document direction (`dir="rtl"`). Choice persists in
 * localStorage and the document is re-rendered on change.
 */
export type Lang = "en" | "he";

type Dict = Record<string, string>;

const dicts: Record<Lang, Dict> = {
  en: {
    "status.init": "Initializing…",
    "status.searching": "Searching for target",
    "status.tracking": "Tracking",
    "status.sonar": "Target hidden · sonar only",
    "status.lost": "Signal lost",

    "ui.target_none": "No target",
    "ui.distance": "Distance",
    "ui.direction": "Direction",
    "ui.confidence": "Confidence",
    "ui.lock": "Lock",
    "ui.lock_strong": "strong",
    "ui.lock_medium": "medium",
    "ui.lock_weak": "weak",
    "ui.motion_approaching": "approaching",
    "ui.motion_receding": "receding",
    "ui.direction_ahead": "ahead",
    "ui.direction_right": "right",
    "ui.direction_left": "left",
    "ui.life_living": "Living",
    "ui.life_unit": "bpm",
    "ui.life_none": "Life sign: —",

    "posture.standing": "standing",
    "posture.sitting": "sitting",
    "posture.lying": "lying",
    "posture.unknown": "unknown",
    "activity.still": "still",
    "activity.moving": "moving",
    "activity.active": "active",
    "activity.unknown": "—",

    "panel.sonar": "SONAR · RANGE PROFILE",
    "panel.layout": "ROOM LAYOUT",
    "panel.people": "PEOPLE",
    "sensor.camera": "Camera",
    "sensor.sonar": "Sonar",
    "sensor.motion": "Motion",

    "start.tagline": "Acoustic · Visual · AR",
    "start.title": "Track anything with sound + sight",
    "start.lead": "Fuses near-ultrasonic sonar with on-device vision to follow a person or pet and lock a 3D marker onto them in augmented reality.",
    "start.button": "Start Tracking",
    "start.step1_lead": "Hold the phone in",
    "start.step1_bold": "landscape",
    "start.step2_lead": "Allow",
    "start.step2_bold_a": "camera",
    "start.step2_amp": "&",
    "start.step2_bold_b": "microphone",
    "start.step3_lead": "Point at a",
    "start.step3_bold": "person, cat or dog",
    "start.foot": "Emits a faint near-ultrasonic sweep (18.5–21.5 kHz). Audible to some people and pets — keep the volume moderate.",

    "dialog.name_title": "Name this person",
    "dialog.name_placeholder": "e.g. Dad, Maya, the cat…",
    "dialog.height_placeholder": "Height in cm (optional — improves distance accuracy)",
    "dialog.height_hint": "If set, this person's real height is used to compute their distance instead of the generic ~170 cm.",
    "dialog.name_save": "Save",
    "dialog.name_cancel": "Cancel",
    "dialog.name_clear": "Clear",

    "menu.title": "Menu",
    "menu.main": "Main view",
    "menu.analysis": "Person analysis",
    "menu.language": "Language",

    "analysis.title": "Person analysis",
    "analysis.subtitle": "Live behaviour and history per person",
    "analysis.no_people": "No people detected yet. Return to the main view and point the camera at someone.",
    "analysis.select_hint": "Tap a person to see their full analysis.",
    "analysis.section_state": "Observable state",
    "analysis.section_now": "Right now",
    "analysis.section_history": "Recent history",
    "analysis.state_calm": "calm",
    "analysis.state_still": "still",
    "analysis.state_engaged": "engaged",
    "analysis.state_restless": "restless",
    "analysis.state_agitated": "agitated",
    "analysis.state_unknown": "—",
    "analysis.metric_distance": "Distance",
    "analysis.metric_direction": "Direction",
    "analysis.metric_posture": "Posture",
    "analysis.metric_activity": "Activity",
    "analysis.metric_breathing": "Breathing",
    "analysis.metric_avg_activity": "Avg activity (10 s)",
    "analysis.metric_breathing_pattern": "Breathing pattern",
    "analysis.metric_posture_changes": "Posture changes",
    "analysis.metric_time_present": "Time tracked",
    "analysis.metric_min_distance": "Closest approach",
    "analysis.metric_mean_distance": "Avg distance",
    "analysis.metric_centered_pct": "Facing the camera",
    "analysis.metric_activity_peaks": "Activity peaks",
    "analysis.breathing_regular": "regular",
    "analysis.breathing_irregular": "irregular",
    "analysis.breathing_fast": "fast",
    "analysis.breathing_slow": "slow",
    "analysis.breathing_none": "no signal",
    "analysis.metric_samples": "Samples logged",
    "analysis.metric_first_seen": "First seen",
    "analysis.metric_last_seen": "Last seen",
    "analysis.metric_seconds": "seconds ago",
    "analysis.rename": "Rename",
    "analysis.no_breathing": "no signal",
    "analysis.honesty_note":
      "Observable state is derived from measured signals (motion, posture, breathing) — not from face or voice 'emotion' detection, which is scientifically unreliable.",

    "error.title": "Something went wrong",
  },

  he: {
    "status.init": "מאתחל…",
    "status.searching": "מחפש מטרה",
    "status.tracking": "במעקב",
    "status.sonar": "המטרה מוסתרת · סונאר בלבד",
    "status.lost": "אות אבוד",

    "ui.target_none": "אין מטרה",
    "ui.distance": "מרחק",
    "ui.direction": "כיוון",
    "ui.confidence": "ביטחון",
    "ui.lock": "נעילה",
    "ui.lock_strong": "חזקה",
    "ui.lock_medium": "בינונית",
    "ui.lock_weak": "חלשה",
    "ui.motion_approaching": "מתקרב",
    "ui.motion_receding": "מתרחק",
    "ui.direction_ahead": "מלפנים",
    "ui.direction_right": "ימינה",
    "ui.direction_left": "שמאלה",
    "ui.life_living": "חי",
    "ui.life_unit": "נשימות/דק'",
    "ui.life_none": "סימן חיים: —",

    "posture.standing": "עומד",
    "posture.sitting": "יושב",
    "posture.lying": "שוכב",
    "posture.unknown": "לא ידוע",
    "activity.still": "נייח",
    "activity.moving": "בתנועה",
    "activity.active": "פעיל",
    "activity.unknown": "—",

    "panel.sonar": "סונאר · פרופיל מרחק",
    "panel.layout": "מפת חדר",
    "panel.people": "אנשים",
    "sensor.camera": "מצלמה",
    "sensor.sonar": "סונאר",
    "sensor.motion": "תנועה",

    "start.tagline": "אקוסטיקה · ראייה · AR",
    "start.title": "מעקב באמצעות קול וראייה",
    "start.lead": "משלב סונאר על‑קולי קרוב עם ראייה על המכשיר כדי לעקוב אחר אדם או חיה ולנעול עליהם סמן AR.",
    "start.button": "התחל מעקב",
    "start.step1_lead": "החזיקו את הטלפון",
    "start.step1_bold": "לרוחב",
    "start.step2_lead": "אפשרו גישה ל",
    "start.step2_bold_a": "מצלמה",
    "start.step2_amp": "ו",
    "start.step2_bold_b": "מיקרופון",
    "start.step3_lead": "כוונו אל",
    "start.step3_bold": "אדם, חתול או כלב",
    "start.foot": "המכשיר משדר ציוץ על‑קולי קרוב חלש (18.5–21.5 קה\"ץ). חלק מהאנשים וחיות עשויים לשמוע אותו — שמרו על עוצמה מתונה.",

    "dialog.name_title": "תן שם לאדם",
    "dialog.name_placeholder": "למשל אבא, מאיה, החתול…",
    "dialog.height_placeholder": "גובה בס\"מ (אופציונלי — משפר דיוק מרחק)",
    "dialog.height_hint": "אם מוזן, ייעשה שימוש בגובה האמיתי של האדם לחישוב המרחק במקום בהנחה הגנרית של ~170 ס\"מ.",
    "dialog.name_save": "שמירה",
    "dialog.name_cancel": "ביטול",
    "dialog.name_clear": "מחיקה",

    "menu.title": "תפריט",
    "menu.main": "מסך ראשי",
    "menu.analysis": "ניתוח פרסונות",
    "menu.language": "שפה",

    "analysis.title": "ניתוח פרסונות",
    "analysis.subtitle": "התנהגות והיסטוריה לכל אדם, בזמן אמת",
    "analysis.no_people": "עדיין לא זוהו אנשים. חזרו לתצוגה הראשית וכוונו את המצלמה לאדם.",
    "analysis.select_hint": "הקש על אדם כדי לראות את הניתוח המלא.",
    "analysis.section_state": "מצב נצפה",
    "analysis.section_now": "כרגע",
    "analysis.section_history": "היסטוריה אחרונה",
    "analysis.state_calm": "רגוע",
    "analysis.state_still": "נייח",
    "analysis.state_engaged": "פעיל מתון",
    "analysis.state_restless": "חסר‑מנוח",
    "analysis.state_agitated": "מתוח",
    "analysis.state_unknown": "—",
    "analysis.metric_distance": "מרחק",
    "analysis.metric_direction": "כיוון",
    "analysis.metric_posture": "יציבה",
    "analysis.metric_activity": "פעילות",
    "analysis.metric_breathing": "נשימה",
    "analysis.metric_avg_activity": "פעילות ממוצעת (10 שניות)",
    "analysis.metric_breathing_pattern": "דפוס נשימה",
    "analysis.metric_posture_changes": "שינויי יציבה",
    "analysis.metric_time_present": "זמן מעקב",
    "analysis.metric_min_distance": "מרחק מינימלי",
    "analysis.metric_mean_distance": "מרחק ממוצע",
    "analysis.metric_centered_pct": "מול המצלמה",
    "analysis.metric_activity_peaks": "שיאי פעילות",
    "analysis.breathing_regular": "סדירה",
    "analysis.breathing_irregular": "לא סדירה",
    "analysis.breathing_fast": "מהירה",
    "analysis.breathing_slow": "איטית",
    "analysis.breathing_none": "אין אות",
    "analysis.metric_samples": "דגימות שנשמרו",
    "analysis.metric_first_seen": "נצפה לראשונה",
    "analysis.metric_last_seen": "נצפה לאחרונה",
    "analysis.metric_seconds": "שניות לפני",
    "analysis.rename": "שינוי שם",
    "analysis.no_breathing": "אין אות",
    "analysis.honesty_note":
      "המצב הנצפה נגזר מאותות נמדדים (תנועה, יציבה, נשימה) — לא מ\"רגש\" שמזוהה מהפנים או מהקול, שאינו אמין מדעית.",

    "error.title": "משהו השתבש",
  },
};

const STORAGE_KEY = "av-track:lang";
const listeners = new Set<() => void>();
let current: Lang = "en";

export function initLang(): Lang {
  let lang: Lang = "en";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "he" || stored === "en") {
      lang = stored;
    } else if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("he")) {
      lang = "he";
    }
  } catch {
    /* private mode etc. */
  }
  current = lang;
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  }
  return lang;
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  applyI18n();
  for (const fn of listeners) fn();
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: string): string {
  return dicts[current][key] ?? dicts.en[key] ?? key;
}

/** Apply translations to every element carrying `data-i18n` / `data-i18n-placeholder`. */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const k = el.getAttribute("data-i18n");
    if (k) el.textContent = t(k);
  });
  root.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((el) => {
    const k = el.getAttribute("data-i18n-placeholder");
    if (k) el.placeholder = t(k);
  });
}
