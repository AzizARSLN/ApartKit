import { describe, expect, it } from "vitest";
import { createLoginThrottle } from "./login-throttle.js";

describe("createLoginThrottle", () => {
  it("blocks after ten failures until the window ends", () => {
    let time = 0;
    const throttle = createLoginThrottle(() => time);
    for (let i = 0; i < 9; i += 1) throttle.recordFailure("a");
    expect(throttle.retryAfterSeconds("a")).toBe(0);

    throttle.recordFailure("a");
    expect(throttle.retryAfterSeconds("a")).toBe(900);
    expect(throttle.retryAfterSeconds("b")).toBe(0);

    time = 15 * 60 * 1000;
    expect(throttle.retryAfterSeconds("a")).toBe(0);
  });

  it("forgets failures after a successful login", () => {
    const throttle = createLoginThrottle(() => 0);
    for (let i = 0; i < 10; i += 1) throttle.recordFailure("a");
    throttle.clear("a");
    expect(throttle.retryAfterSeconds("a")).toBe(0);
  });
});
