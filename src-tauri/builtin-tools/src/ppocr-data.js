// Geometry and CTC adapted from the user-provided 图片文字识别.html.
export const DET={threshold:.2,boxThreshold:.4,unclipRatio:1.4,maxCandidates:3000,mean:[.485,.456,.406],std:[.229,.224,.225]}
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v))
export function convexHull(flat){
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i+1]]);
  if (pts.length < 3) return pts;
  pts.sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const cross = (o,a,b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
  const lower = [];
  for (const q of pts){
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--){
    const q = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

export function minAreaRect(flat){
  const hull = convexHull(flat);
  const n = hull.length;
  if (n === 0) return null;
  if (n < 3){
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for (let i=0;i<flat.length;i+=2){
      x0=Math.min(x0,flat[i]); x1=Math.max(x1,flat[i]);
      y0=Math.min(y0,flat[i+1]); y1=Math.max(y1,flat[i+1]);
    }
    return { cx:(x0+x1)/2, cy:(y0+y1)/2, w:Math.max(1,x1-x0), h:Math.max(1,y1-y0),
             ux:1, uy:0, nx:0, ny:1 };
  }
  let best = null;
  for (let i = 0; i < n; i++){
    const a = hull[i], b = hull[(i+1) % n];
    const ex = b[0]-a[0], ey = b[1]-a[1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    const ux = ex/len, uy = ey/len, nx = -uy, ny = ux;
    let minU=Infinity, maxU=-Infinity, minV=Infinity, maxV=-Infinity;
    for (const q of hull){
      const du = (q[0]-a[0])*ux + (q[1]-a[1])*uy;
      const dv = (q[0]-a[0])*nx + (q[1]-a[1])*ny;
      if (du < minU) minU = du; if (du > maxU) maxU = du;
      if (dv < minV) minV = dv; if (dv > maxV) maxV = dv;
    }
    const w = maxU - minU, h = Math.max(1e-6, maxV - minV);
    const area = w * h;
    if (!best || area < best.area){
      const cu = (minU+maxU)/2, cv = (minV+maxV)/2;
      best = { area, w, h, ux, uy, nx, ny,
               cx: a[0] + ux*cu + nx*cv, cy: a[1] + uy*cu + ny*cv };
    }
  }
  if (best.w < best.h){                       // 统一 w >= h
    const t = best.w; best.w = best.h; best.h = t;
    const ux = best.ux, uy = best.uy;
    best.ux = best.nx; best.uy = best.ny; best.nx = -ux; best.ny = -uy;
  }
  return best;
}

export function rectCorners(cx, cy, w, h, u, n){
  const hw = w/2, hh = h/2;
  const pt = (su, sn) => [cx + u[0]*hw*su + n[0]*hh*sn, cy + u[1]*hw*su + n[1]*hh*sn];
  return [ pt(-1,-1), pt(1,-1), pt(1,1), pt(-1,1) ];
}

export function orderQuad(pts){
  const e = pts.slice().sort((a,b) => a[0]-b[0]);
  const left  = e.slice(0,2).sort((a,b) => a[1]-b[1]);
  const right = e.slice(2,4).sort((a,b) => a[1]-b[1]);
  return [ left[0], right[0], right[1], left[1] ];   // tl, tr, br, bl
}

export function dbPostProcess(prob, dims, scale, sourceW, sourceH){
  if(dims.length!==4||dims[0]!==1||dims[1]!==1||!Number.isInteger(dims[2])||!Number.isInteger(dims[3])||dims[2]<1||dims[3]<1||prob.length!==dims[2]*dims[3]||!Number.isFinite(scale)||scale<=0)throw new Error('Invalid detector tensor');
  const H = dims[2], W = dims[3];
  const N = H * W;
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = prob[i] > DET.threshold ? 1 : 0;

  const label = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  const comps = [];
  for (let i = 0; i < N; i++){
    if (!mask[i] || label[i] !== -1) continue;
    const id = comps.length;
    let sp = 0; stack[sp++] = i; label[i] = id;
    const pts = []; let sum = 0, count = 0;
    while (sp > 0){
      const p = stack[--sp];
      const x = p % W, y = (p / W) | 0;
      sum += prob[p]; count++;
      if(x===0||y===0||x===W-1||y===H-1||!mask[p-1]||!mask[p+1]||!mask[p-W]||!mask[p+W])pts.push(x,y);
      for (let dy = -1; dy <= 1; dy++){
        const ny = y + dy; if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++){
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx; if (nx < 0 || nx >= W) continue;
          const q = ny * W + nx;
          if (mask[q] && label[q] === -1){ label[q] = id; stack[sp++] = q; }
        }
      }
    }
    const cnt = count;
    if (cnt >= 16 && comps.length < DET.maxCandidates) comps.push({ pts, score: sum / cnt, area: cnt });
  }

  const boxes = [];
  for (const c of comps){
    if (c.score < DET.boxThreshold) continue;
    const rect = minAreaRect(c.pts);
    if (!rect) continue;
    const perimeter = 2 * (rect.w + rect.h);
    const delta = c.area * DET.unclipRatio / perimeter;
    const corners = rectCorners(rect.cx, rect.cy, rect.w + 2*delta, rect.h + 2*delta,
                                [rect.ux, rect.uy], [rect.nx, rect.ny]);
    const mapped = corners.map(p => [ clamp(p[0]/scale, 0, sourceW), clamp(p[1]/scale, 0, sourceH) ]);
    const quad = orderQuad(mapped);
    const xs = quad.map(p => p[0]), ys = quad.map(p => p[1]);
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    if (bw <= 0 || bh <= 0) continue;
    boxes.push({ quad, score: c.score, cx: xs.reduce((a,b)=>a+b,0)/4, cy: ys.reduce((a,b)=>a+b,0)/4, w: bw, h: bh });
  }
  return boxes;
}

export function ctcDecode(data, dims, charList){
  if(dims.length!==3||dims[0]!==1||!Number.isInteger(dims[1])||dims[1]<1||dims[2]!==charList.length||data.length!==dims[1]*dims[2])throw new Error('Invalid recognition tensor or dictionary');
  const T = dims[1], C = dims[2];
  let text = '', sum = 0, cnt = 0, prev = -1;
  for (let t = 0; t < T; t++){
    const off = t * C;
    let bestVal = -Infinity, bestIdx = -1;
    for (let c = 0; c < C; c++){
      const v = data[off + c];
      if (v > bestVal){ bestVal = v; bestIdx = c; }
    }
    if (bestIdx !== 0 && bestIdx !== -1 && bestIdx !== prev){
      if (bestIdx < charList.length){ text += charList[bestIdx]; sum += bestVal; cnt++; }
    }
    prev = bestIdx;
  }
  return { text, score: cnt > 0 ? sum / cnt : 0 };
}

export function sortBoxes(boxes){
  const heights = boxes.map(b => b.h).sort((a,b) => a-b);
  const medH = heights.length ? heights[heights.length >> 1] : 20;
  const tol = Math.max(6, medH * 0.6);
  const arr = boxes.slice().sort((a,b) => a.cy - b.cy || a.cx - b.cx);
  const rows = [];
  let cur = null;
  for (const b of arr){
    if (!cur || Math.abs(b.cy - cur.cy) > tol){ cur = { cy: b.cy, items: [b] }; rows.push(cur); }
    else { cur.items.push(b); cur.cy = (cur.cy * (cur.items.length-1) + b.cy) / cur.items.length; }
  }
  const out = [];
  for (const row of rows){
    row.items.sort((a,b) => a.cx - b.cx);
    out.push(...row.items);
  }
  return out;
}
