import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAutoencoder, createLstm, mse } from "../scripts/phase5-neural-models.mjs";
import { compare, createScenarios, validWindow, labelValue, labeledMetrics } from "../scripts/compare-phase5-models.mjs";

describe("experimental offline neural models", () => {
  it("trains an LSTM predictor on a simple repeated sequence", () => {
    const model=createLstm(7), seq=Array.from({length:8},()=>[0.4,-0.3,0.2]), target=[0.4,-0.3,0.2];
    const before=mse(model.predict(seq),target);
    for(let i=0;i<60;i++) model.train(seq,target,0.03);
    expect(mse(model.predict(seq),target)).toBeLessThan(before * 0.7);
    expect(model.parameterCount).toBeGreaterThan(0);
  });
  it("trains a window autoencoder without non-finite outputs", () => {
    const model=createAutoencoder(), seq=Array.from({length:8},()=>[0.4,-0.3,0.2]);
    const before=mse(model.reconstruct(seq),seq.flat());
    for(let i=0;i<100;i++) model.train(seq,0.03);
    expect(mse(model.reconstruct(seq),seq.flat())).toBeLessThan(before * 0.7);
    expect(model.reconstruct(seq).every(Number.isFinite)).toBe(true);
  });
  it("rejects gaps and makes independent, bounded synthetic scenarios", () => {
    const start=Date.parse("2024-01-01T00:00:00Z");
    const rows=Array.from({length:12},(_,i)=>({station_id:"TEST",timestamp:new Date(start+i*3*3600_000).toISOString(),temperature:"20",humidity:"60",pressure:"1000"}));
    const original=structuredClone(rows);
    expect(validWindow(rows,10)).toBe(true);
    const cases=createScenarios(rows,10);
    expect(cases.map(item=>item.kind)).toEqual(["temperature_spike_plus_6_c","humidity_frozen_last_5_readings","pressure_ramp_plus_4_hpa"]);
    expect(Number(cases[0].rows[10].temperature)).toBe(26);
    expect(Number(cases[2].rows[10].pressure)).toBe(1004);
    expect(rows).toEqual(original);
    rows.splice(5,2); expect(validWindow(rows,8)).toBe(false);
  });
  it("counts only labeled test observations and preserves undefined metrics", () => {
    const items=[{label:1,scores:{model:0.9}},{label:1,scores:{model:0.1}},{label:0,scores:{model:0.8}},{label:0,scores:{model:0.2}},{label:null,scores:{model:0.9}}];
    const result=labeledMetrics(items,["model"],{model:0.5});
    expect(result.labeled_test_observations).toBe(4);
    expect(result.unknown_test_observations).toBe(1);
    expect(result.methods.model).toEqual({true_positive:1,false_positive:1,true_negative:1,false_negative:1,precision:0.5,recall:0.5,f1:0.5});
    expect(labeledMetrics([{label:null,scores:{model:0.9}}],["model"],{model:0.5}).methods.model.precision).toBeNull();
    expect(labelValue("")).toBeNull();
    expect(()=>labelValue("yes")).toThrow();
  });
  it("evaluates test labels end to end and rejects known faults in training", async () => {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),"skyguard-phase5-test-"));
    try {
      const csv=await fs.readFile("data/noaa/chennai-ghcnh-january-2024.csv","utf8");
      const lines=csv.trim().split(/\r?\n/);
      const fixture=lines.map((line,index)=>line+(index===0 ? ",fault_label" : index>200 ? `,${index%2}` : ",")).join("\n")+"\n";
      const file=path.join(dir,"artificial-labels.csv"); await fs.writeFile(file,fixture);
      const result=await compare(file);
      expect(result.labeled_test_evaluation.labeled_test_observations).toBeGreaterThan(0);
      expect(result.labeled_test_evaluation.positive_labels).toBeGreaterThan(0);
      expect(result.labeled_test_evaluation.negative_labels).toBeGreaterThan(0);
      for(const counts of Object.values(result.labeled_test_evaluation.methods)) expect(counts.true_positive+counts.false_positive+counts.true_negative+counts.false_negative).toBe(result.labeled_test_evaluation.labeled_test_observations);
      const contaminated=fixture.split("\n"); contaminated[1]=contaminated[1].slice(0,-1)+",1"; await fs.writeFile(file,contaminated.join("\n"));
      await expect(compare(file)).rejects.toThrow("Known faults in the training or calibration period");
    } finally { await fs.rm(dir,{recursive:true,force:true}); }
  },30000);
});
