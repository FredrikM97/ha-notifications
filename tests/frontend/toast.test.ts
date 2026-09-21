// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { showToast, toastListTemplate, type Toast } from "../../frontend/toast.js";
import { renderTemplate } from "./conftest.js";

const host = () => ({
  toasts: [] as Toast[],
  requestUpdate: vi.fn(),
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("toast notifications", () => {
  it("renders success and error toast states", () => {
    const owner = host();
    showToast(owner, "Saved.");
    showToast(owner, "Failed.", true);

    const rendered = renderTemplate(toastListTemplate(owner.toasts));
    expect(
      [...rendered.querySelectorAll(".nc-toast")].map((toast) => ({
        text: toast.textContent?.trim(),
        error: toast.classList.contains("error"),
      })),
    ).toMatchSnapshot();
  });

  it("removes a toast after its duration", () => {
    vi.useFakeTimers();
    const owner = host();
    showToast(owner, "Temporary", false, 100);

    expect(owner.toasts).toHaveLength(1);
    vi.advanceTimersByTime(100);

    expect(owner.toasts).toHaveLength(0);
    expect(owner.requestUpdate).toHaveBeenCalledTimes(2);
  });
});
