// Isolated educational comparison. No telemetry, live settings, incidents, or email are modified.
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { analyzeIsolated } from "./evaluate-detector.mjs";
import { createLstm, createAutoencoder, mse } from "./phase5-neural-models.mjs";

const fields=["temperature","humidity","pressure"], windowSize=8;
const limits={temperature:[-90,65],humidity:[0,100],pressure:[300,1100]};
const quote = value => `"${String(value ?? "").replaceAll('"','""')}"`;
const serialize = rows => { const headers=Object.keys(rows[0]); return [headers.map(quote).join(","),...rows.map(row=>headers.map(key=>quote(row[key])).join(",")),""].join("\n"); };
const values = row => fields.map(field=>Number(row[field]));
const date = row => Date.parse(row.timestamp);
export function validWindow(rows, i) { return i >= windowSize && rows.slice(i-windowSize,i+1).every((row,j,window)=>Number.isFinite(date(row)) && fields.every(field=>row[field] !== "" && Number.isFinite(Number(row[field]))) && (!j || date(row)-date(window[j-1]) > 0 && date(row)-date(window[j-1]) <= 6*3600_000)); }
export function createScenarios(rows, index) {
  if (!validWindow(rows,index)) throw Error("A complete test window is required.");
  const copy=()=>rows.map(row=>({...row}));
  const spike=copy(); spike[index].temperature=String(Number(spike[index].temperature)+6);
  const frozen=copy(), frozenValue=frozen[index-5].humidity;
  for(let i=index-4;i<=index;i++) frozen[i].humidity=frozenValue;
  const drift=copy(); for(let i=index-7;i<=index;i++) drift[i].pressure=String(Number(drift[i].pressure)+4*(i-(index-7))/7);
  return [{kind:"temperature_spike_plus_6_c",rows:spike},{kind:"humidity_frozen_last_5_readings",rows:frozen},{kind:"pressure_ramp_plus_4_hpa",rows:drift}].map(item=>({ ...item, valid:item.rows.every(row=>fields.every(field=>Number(row[field])>=limits[field][0] && Number(row[field])<=limits[field][1])) }));
}
function percentile95(scores) { const sorted=[...scores].sort((a,b)=>a-b); if(!sorted.length||sorted.some(x=>!Number.isFinite(x))) throw Error("Not enough finite calibration scores."); return sorted[Math.min(sorted.length-1,Math.ceil(.95*sorted.length)-1)]; }
function scoreOne(rows,index,stats,lstm,autoencoder) {
  const normalize = row => values(row).map((value,k)=>(value-stats.mean[k])/stats.std[k]);
  const previous=rows.slice(index-windowSize,index).map(normalize), target=normalize(rows[index]);
  const aeWindow=rows.slice(index-windowSize+1,index+1).map(normalize);
  return { rules: Math.max(...target.map((value,k)=>Math.abs(value-previous.at(-1)[k]))), lstm: mse(lstm.predict(previous),target), autoencoder:mse(autoencoder.reconstruct(aeWindow),aeWindow.flat()) };
}
function forestMap(report) { return new Map(report.series.map(row=>[`${row.station_id}\0${new Date(row.timestamp).toISOString()}`,row.anomaly_score])); }
function prediction(scores,thresholds) { return Object.fromEntries(Object.keys(thresholds).map(key=>[key,{ score:scores[key], flagged:scores[key] >= thresholds[key] }])); }

// Labels are caller-supplied assertions. Their provenance and independence must be
// verified separately; a blank label is unknown, never an implicit negative.
export function labelValue(value) {
  const label=String(value ?? "").trim();
  if (label === "") return null;
  if (label === "0" || label === "1") return Number(label);
  throw Error("fault_label must be 0, 1, or blank.");
}
export function labeledMetrics(test, methods, thresholds) {
  const labeled=test.filter(item=>item.label !== null);
  const methodsResult=Object.fromEntries(methods.map(method=>{
    let tp=0, fp=0, tn=0, fn=0;
    for (const item of labeled) {
      const flag=item.scores[method] >= thresholds[method];
      if(item.label === 1) flag ? tp++ : fn++;
      else flag ? fp++ : tn++;
    }
    const precision=tp+fp ? tp/(tp+fp) : null, recall=tp+fn ? tp/(tp+fn) : null;
    return [method,{true_positive:tp,false_positive:fp,true_negative:tn,false_negative:fn,precision,recall,f1:2*tp+fp+fn ? 2*tp/(2*tp+fp+fn) : null}];
  }));
  return {labeled_test_observations:labeled.length,unknown_test_observations:test.length-labeled.length,positive_labels:labeled.filter(item=>item.label===1).length,negative_labels:labeled.filter(item=>item.label===0).length,methods:methodsResult};
}

export async function compare(file) {
  const csv=await fs.readFile(file,"utf8"), rows=parse(csv,{columns:true,bom:true,skip_empty_lines:true});
  if(rows.length<100 || rows.length>5000 || new Set(rows.map(row=>row.station_id)).size!==1 || rows.some(row=>!row.station_id || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z$/i.test(row.timestamp) || !Number.isFinite(date(row)) || fields.some(field=>!String(row[field]??"").trim() || !Number.isFinite(Number(row[field])) || Number(row[field])<limits[field][0] || Number(row[field])>limits[field][1]))) throw Error("Input must have 100–5,000 valid, in-range observations from one station with UTC timestamps.");
  rows.sort((a,b)=>date(a)-date(b));
  if(rows.some((row,i)=>i>0 && date(row)===date(rows[i-1]))) throw Error("Duplicate timestamps are not supported.");
  rows.forEach(row=>labelValue(row.fault_label));
  const trainEnd=Math.floor(rows.length*.6), validationEnd=Math.floor(rows.length*.8), train=rows.slice(0,trainEnd);
  const knownPositiveTraining=rows.slice(0,trainEnd).filter(row=>labelValue(row.fault_label)===1).length;
  const knownPositiveValidation=rows.slice(trainEnd,validationEnd).filter(row=>labelValue(row.fault_label)===1).length;
  if(knownPositiveTraining || knownPositiveValidation) throw Error("Known faults in the training or calibration period are not supported; choose clean earlier periods without positive labels.");
  const mean=fields.map((field)=>train.reduce((sum,row)=>sum+Number(row[field]),0)/train.length);
  const std=fields.map((field,k)=>Math.max(.01,Math.sqrt(train.reduce((sum,row)=>sum+(Number(row[field])-mean[k])**2,0)/train.length)));
  const stats={mean,std}, normalize=row=>values(row).map((value,k)=>(value-mean[k])/std[k]);
  const trainIndices=Array.from({length:trainEnd},(_,i)=>i).filter(i=>validWindow(rows,i));
  const validationIndices=Array.from({length:validationEnd-trainEnd},(_,i)=>i+trainEnd).filter(i=>validWindow(rows,i));
  const testIndices=Array.from({length:rows.length-validationEnd},(_,i)=>i+validationEnd).filter(i=>validWindow(rows,i));
  if(trainIndices.length<40 || validationIndices.length<10 || testIndices.length<10) throw Error("Insufficient complete windows after the time split.");
  const lstm=createLstm(7), autoencoder=createAutoencoder(windowSize,11), losses=[];
  for(let epoch=0;epoch<8;epoch++) {
    let lstmLoss=0, aeLoss=0;
    for(const i of trainIndices) { lstmLoss+=lstm.train(rows.slice(i-windowSize,i).map(normalize),normalize(rows[i])); aeLoss+=autoencoder.train(rows.slice(i-windowSize+1,i+1).map(normalize)); }
    losses.push({epoch:epoch+1,lstm:lstmLoss/trainIndices.length,autoencoder:aeLoss/trainIndices.length});
  }
  const original=await analyzeIsolated(csv), forest=forestMap(original);
  const key = row=>`${row.station_id}\0${new Date(row.timestamp).toISOString()}`;
  const combined = (input,index,forestScores) => ({...scoreOne(input,index,stats,lstm,autoencoder),isolation_forest_combined:forestScores.get(key(input[index]))});
  const val=validationIndices.map(i=>combined(rows,i,forest));
  if(val.some(item=>Object.values(item).some(value=>!Number.isFinite(value)))) throw Error("Some calibration scores were unavailable.");
  const methods=["rules","isolation_forest_combined","lstm","autoencoder"];
  const thresholds=Object.fromEntries(methods.map(method=>[method,percentile95(val.map(item=>item[method]))]));
  const test=testIndices.map(i=>({timestamp:new Date(date(rows[i])).toISOString(),label:labelValue(rows[i].fault_label),scores:combined(rows,i,forest)}));
  if(test.some(item=>Object.values(item.scores).some(value=>!Number.isFinite(value)))) throw Error("Some test scores were unavailable.");
  const testFlags=Object.fromEntries(methods.map(method=>[method,{flagged:test.filter(item=>item.scores[method]>=thresholds[method]).length,scored:test.length}]));
  const selected=testIndices[Math.floor(testIndices.length/2)], scenarios=createScenarios(rows,selected), experiments=[];
  const control=prediction(combined(rows,selected,forest),thresholds);
  for(const scenario of scenarios) {
    if(!scenario.valid) { experiments.push({kind:scenario.kind,skipped:"Exceeds input limits."}); continue; }
    const replay=await analyzeIsolated(serialize(scenario.rows));
    const scores=combined(scenario.rows,selected,forestMap(replay));
    if(Object.values(scores).some(value=>!Number.isFinite(value))) throw Error("A synthetic case was not scored.");
    experiments.push({kind:scenario.kind,control,injected:prediction(scores,thresholds)});
  }
  return { evaluated_at:new Date().toISOString(), dataset:path.basename(file), sha256:createHash("sha256").update(csv).digest("hex"), station_id:rows[0].station_id, split:{train:{start:rows[0].timestamp,end:rows[trainEnd-1].timestamp,windows:trainIndices.length},validation:{start:rows[trainEnd].timestamp,end:rows[validationEnd-1].timestamp,windows:validationIndices.length},test:{start:rows[validationEnd].timestamp,end:rows.at(-1).timestamp,windows:testIndices.length}}, config:{window_size:windowSize,maximum_gap_hours:6,epochs:8,scaler:stats,threshold_method:"95th percentile of validation scores per method; ties may yield different flag counts",thresholds}, models:{rules:"Largest standardized one-step change",isolation_forest_combined:"Existing rolling Isolation Forest plus robust station baseline",lstm:{description:"Small LSTM next-reading predictor",parameters:lstm.parameterCount},autoencoder:{description:"Small dense window reconstruction autoencoder",parameters:autoencoder.parameterCount}},training_losses:losses,unmodified_test_flags:testFlags,labeled_test_evaluation:labeledMetrics(test,methods,thresholds),label_provenance:"Labels are supplied by the caller and are not independently verified by this script. Blank labels are unknown. Verify provenance and exclude synthetic labels from real-world claims.",synthetic_endpoint:new Date(date(rows[selected])).toISOString(),synthetic_cases:experiments,missing_data:"Windows with missing measurements or gaps over six hours are excluded; no neural score is produced for them.",limitations:["Unlabeled observations cannot establish false positives or missed faults; label provenance must be independently verified.","Synthetic changes are demonstrations, not verified sensor failures; a single endpoint cannot establish accuracy or detection delay.","Thresholds are fit independently on validation data; 95th-percentile matching is approximate and does not equalize false alarm rates.","Both neural models are trained only on the first 60% and calibrated on the next 20%; the Isolation Forest is the existing rolling model and refits on earlier observations throughout the replay.","The split is within one station; it does not establish generalization to unseen stations.","If humidity is derived from temperature and dew point, independent synthetic changes can be physically inconsistent.","All models remain offline; no model is promoted or connected to operational alerts."] };
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [file,output]=process.argv.slice(2);
  if(!file || !output) { console.error("Usage: node scripts/compare-phase5-models.mjs <station.csv> <new-report.json>"); process.exitCode=1; }
  else compare(file).then(async report=>{ await fs.writeFile(output,JSON.stringify(report,null,2)+"\n",{flag:"wx"}); console.log(`Offline comparison written to ${output}`); }).catch(error=>{ console.error(`Comparison failed: ${error.message}`); process.exitCode=1; });
}
