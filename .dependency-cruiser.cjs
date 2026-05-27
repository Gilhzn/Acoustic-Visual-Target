/**
 * Enforces the core/app boundary: the headless numeric core
 * (core-units, contracts, dsp, fusion, lab) must never import the browser app
 * or DOM/Three.js/TF.js — guaranteeing it stays runnable in Node.
 */
module.exports = {
  forbidden: [
    {
      name: "core-must-stay-headless",
      comment:
        "Core packages must not import the web app or browser-only libraries.",
      severity: "error",
      from: { path: "^packages/(core-units|contracts|dsp|fusion|lab)/src" },
      to: {
        path: "^(apps/|node_modules/(three|gsap|@tensorflow))",
      },
    },
    {
      name: "no-circular",
      comment: "Circular dependencies are forbidden.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
    tsPreCompilationDeps: true,
  },
};
