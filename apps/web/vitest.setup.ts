import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";

if (typeof CSS === "object" && typeof CSS.supports !== "function") {
  Object.defineProperty(CSS, "supports", {
    configurable: true,
    value: () => false,
  });
}
