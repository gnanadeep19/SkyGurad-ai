import type { SourceMode } from "./observations.js";

export function recommendationFor(source: SourceMode, status: "Healthy" | "Warning" | "Critical", strongest: string): string {
  if (status === "Healthy") return "Continue monitoring and review any changes in the readings.";
  if (source === "open-meteo") return `Compare the ${strongest} estimate with independent weather observations and review its context. Model estimates cannot diagnose sensor faults.`;
  if (source === "replay") return "This is demonstration data. Review the simulated anomaly without taking action on physical equipment.";
  if (source === "station-api" || source === "live") return `Verify the ${strongest} reading against independent observations and station records. Consider sensor inspection if further evidence supports it.`;
  return `Check the ${strongest} value, source documentation, quality flags, and independent observations before drawing conclusions.`;
}
