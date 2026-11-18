import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StationMonitor from "./StationMonitor";

describe("station feed source identification", () => {
  it("identifies station submissions and states that physical identity is unverified", () => {
    const html = renderToStaticMarkup(<StationMonitor onBack={() => {}} onQuality={() => {}} />);
    expect(html).toContain("Source: submitted station observations");
    expect(html).toContain("separately from modeled weather data");
    expect(html).toContain("physical device has not been verified");
  });
});
