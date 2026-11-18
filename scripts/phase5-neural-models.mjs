// Small dependency-free educational neural networks for offline experiments only.
// Model parameters never leave this process and are not used by the live detector.
class Value {
  constructor(data, parents = [], step = () => {}) { this.data = data; this.grad = 0; this.parents = parents; this.step = step; }
  add(other) { const b = asValue(other), out = new Value(this.data + b.data, [this,b]); out.step = () => { this.grad += out.grad; b.grad += out.grad; }; return out; }
  mul(other) { const b = asValue(other), out = new Value(this.data * b.data, [this,b]); out.step = () => { this.grad += b.data * out.grad; b.grad += this.data * out.grad; }; return out; }
  tanh() { const n = Math.tanh(this.data), out = new Value(n,[this]); out.step = () => { this.grad += (1 - n*n) * out.grad; }; return out; }
  sigmoid() { const n = 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, this.data)))), out = new Value(n,[this]); out.step = () => { this.grad += n * (1-n) * out.grad; }; return out; }
  backward() { const seen = new Set(), ordered = []; const visit = node => { if (seen.has(node)) return; seen.add(node); node.parents.forEach(visit); ordered.push(node); }; visit(this); this.grad = 1; for (let i=ordered.length-1;i>=0;i--) ordered[i].step(); }
}
const asValue = value => value instanceof Value ? value : new Value(value);
function seeded(seed) { let state=seed>>>0; return () => { state=(Math.imul(state,1664525)+1013904223)>>>0; return state/4294967296; }; }
function matrix(rows, columns, random, scale = 0.12) { return Array.from({length:rows}, () => Array.from({length:columns}, () => new Value((random()*2-1)*scale))); }
function dot(weights, inputs, bias) { return weights.reduce((sum, weight, index) => sum.add(weight.mul(inputs[index])), bias); }
function lossFor(output, target) { return output.reduce((sum,value,index) => { const d=value.add(-target[index]); return sum.add(d.mul(d)); },new Value(0)).mul(1/output.length); }
function update(parameters, rate) { for (const p of parameters) { if (!Number.isFinite(p.grad)) throw Error("Non-finite gradient."); p.data -= rate * Math.max(-2,Math.min(2,p.grad)); p.grad=0; if (!Number.isFinite(p.data)) throw Error("Non-finite model parameter."); } }

export function createLstm(seed = 7, hidden = 5) {
  const random = seeded(seed), width = 3 + hidden;
  const gates = Array.from({length:4},()=>({ weights:matrix(hidden,width,random), bias:Array.from({length:hidden},()=>new Value(0)) }));
  const output=matrix(3,hidden,random), bias=Array.from({length:3},()=>new Value(0));
  const parameters=[...gates.flatMap(g=>[...g.weights.flat(),...g.bias]),...output.flat(),...bias];
  const forward = sequence => {
    let h=Array.from({length:hidden},()=>new Value(0)), c=Array.from({length:hidden},()=>new Value(0));
    for (const row of sequence) {
      const input=[...row.map(asValue),...h];
      const activate = (gate, index) => { const z=dot(gates[gate].weights[index],input,gates[gate].bias[index]); return gate===2 ? z.tanh() : z.sigmoid(); };
      const nextC=[], nextH=[];
      for(let i=0;i<hidden;i++) { const forget=activate(0,i), incoming=activate(1,i), candidate=activate(2,i), out=activate(3,i); const state=forget.mul(c[i]).add(incoming.mul(candidate)); nextC.push(state); nextH.push(out.mul(state.tanh())); }
      h=nextH; c=nextC;
    }
    return output.map((row,index)=>dot(row,h,bias[index]));
  };
  return { train(sequence,target,rate=0.008) { const loss=lossFor(forward(sequence),target); loss.backward(); update(parameters,rate); return loss.data; }, predict(sequence) { return forward(sequence).map(value=>value.data); }, parameterCount:parameters.length };
}

export function createAutoencoder(length = 8, seed = 11, hidden = 6) {
  const random=seeded(seed), width=length*3, encoder=matrix(hidden,width,random), eb=Array.from({length:hidden},()=>new Value(0)), decoder=matrix(width,hidden,random), db=Array.from({length:width},()=>new Value(0));
  const parameters=[...encoder.flat(),...eb,...decoder.flat(),...db];
  const forward = sequence => { const input=sequence.flat().map(asValue), code=encoder.map((row,index)=>dot(row,input,eb[index]).tanh()); return decoder.map((row,index)=>dot(row,code,db[index])); };
  return { train(sequence,rate=0.01) { const loss=lossFor(forward(sequence),sequence.flat()); loss.backward(); update(parameters,rate); return loss.data; }, reconstruct(sequence) { return forward(sequence).map(value=>value.data); }, parameterCount:parameters.length };
}

export function mse(a,b) { if (!a.length || a.length!==b.length || a.some((value,index)=>!Number.isFinite(value)||!Number.isFinite(b[index]))) throw Error("Invalid comparison vectors."); return a.reduce((sum,value,index)=>sum+(value-b[index])**2,0)/a.length; }
