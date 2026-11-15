// Repro for a bug Josh reported (2026-11-15): drawing a segment that merges two lines can recolor an UNRELATED line (js/pathcolors.js).
// Random segment adds/removes on a strip; whenever an added segment leaves an untouched line with a different color, print the sequence.
// Today it finds failures (with more than 8 lines the colors are shared and the conflict resolution reshuffles them when a merge frees one).
import { makeColorKeeper, assignPathColors } from '../js/pathcolors.js';
let seed=12345; const rnd=()=>{seed=(seed*1664525+1013904223)>>>0; return seed/4294967296};
function comps(on,N){ const parent=[...Array(N).keys()]; const find=a=>{while(parent[a]!==a)a=parent[a];return a}; on.forEach((v,x)=>{ if(v){const a=find(x),b=find(x+1); if(a!==b) parent[Math.max(a,b)]=Math.min(a,b)} }); const m=new Map(); on.forEach((v,x)=>{ if(v){const r=find(x); if(!m.has(r)) m.set(r,[]); m.get(r).push(x)} }); return {find,m}; }
let fails=0;
for (let trial=0; trial<400 && fails<3; trial++) {
  const N=60, keeper=makeColorKeeper(N), on=new Uint8Array(N); const log=[];
  const recolor=()=>{ const {find,m}=comps(on,N); const cm=assignPathColors(keeper,on,x=>find(x),8); const out=new Map(); for(const [r,xs] of m) out.set(xs.join(','),cm.get(r)); return out; };
  let prev=recolor();
  for (let step=0; step<60; step++) {
    const x=(rnd()*(N-1))|0; const wasOn=on[x]; on[x]=wasOn?0:1; log.push((wasOn?'-':'+')+x);
    const cur=recolor();
    // an edge addition that merges two components: every component not containing x and unchanged in content must keep its color
    if(!wasOn){ for(const [k,c] of cur) { if(prev.has(k) && prev.get(k)!==c && !k.split(',').includes(String(x))) { // an untouched component changed color
          console.log('RECOLORED an unrelated line after',log.join(' '),'| component',k,prev.get(k),'->',c); fails++; step=999; break; } } }
    prev=cur;
  }
}
console.log('fuzz done, failures:',fails);
