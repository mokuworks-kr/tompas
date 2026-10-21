// 2차 변수: 색(C), 배치(L), 흐름(F). 스프레드 단위로 잰다.
import type { Doc, Line, Page } from "./read.ts";
import { hexL, lab, type Look } from "./look.ts";
import { furniture } from "./vars.ts";
import { sides } from "./near.ts";
import { rows } from "./rows.ts";

const MM = 25.4 / 72;
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const chars = (s: string) => s.replace(/\s/g, "").length;
function quantile(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
const spreadOf = (xs: number[]) => xs.length ? { p10: round(quantile(xs, 0.1)), p50: round(quantile(xs, 0.5)), p90: round(quantile(xs, 0.9)) } : null;

// 스프레드: 스프레드로 저장된 PDF는 원본 쪽 하나, 세로 낱쪽은 이어지는 왼쪽·오른쪽 쪽, 가로 낱쪽은 쪽 하나
export function spreads(doc: Doc): Page[][] {
  if (doc.layout === "스프레드") return [...new Set(doc.pages.map(p => p.src))].map(s => doc.pages.filter(p => p.src === s));
  const out: Page[][] = [];
  for (let i = 0; i < doc.pages.length; i++) {
    const p = doc.pages[i], q = doc.pages[i + 1];
    if (p.side === "L" && q?.side === "R") { out.push([p, q]); i++; } else out.push([p]);
  }
  return out;
}

// 글 덩어리: 왼끝이 같고 위아래로 이어지는 줄들
function blocks(lines: Line[]) {
  const out: Line[][] = [];
  for (const l of [...lines].sort((a, b) => a.y - b.y)) {
    const b = out.find(b => Math.abs(b[0].x0 - l.x0) < 1.5 && l.y - b.at(-1)!.y <= 2.2 * l.size && l.y > b.at(-1)!.y);
    if (b) b.push(l); else out.push([l]);
  }
  return out;
}

// 강조색: 쪽마다 쓴 유채색(C* 20 이상)을 색상 10° 칸에 표시하고,
// 쪽의 10% 넘게 나오는 칸들을 이어진 색상끼리(한 칸 빈틈까지) 묶어 센다. 몇 쪽에만 나오는 도표 색은 빠진다.
function accents(swatches: string[][]) {
  const pages = new Array(36).fill(0);
  for (const sw of swatches) {
    const bins = new Set<number>();
    for (const hex of sw) {
      const [, a, b] = lab(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
      if (Math.hypot(a, b) >= 20) bins.add(Math.floor(((Math.atan2(b, a) * 180 / Math.PI + 360) % 360) / 10));
    }
    bins.forEach(i => pages[i]++);
  }
  const floor = 0.1 * swatches.length, groups: { from: number; to: number; pages: number }[] = [];
  const start = pages.findIndex(n => n < floor); // 원을 끊을 자리
  if (start < 0) return [{ hue: 0, pages: 1 }];
  for (let j = 1; j <= 36; j++) {
    const i = (start + j) % 36;
    if (pages[i] < floor) continue;
    const g = groups.at(-1);
    // 한 칸(10°)짜리 빈틈은 같은 색 계열로 잇는다
    if (g && (g.to === (i + 35) % 36 || g.to === (i + 34) % 36)) { g.to = i; g.pages = Math.max(g.pages, pages[i]); } else groups.push({ from: i, to: i, pages: pages[i] });
  }
  return groups.map(g => ({ hue: g.from * 10, pages: round(g.pages / swatches.length) }));
}

// 정렬선: 글 덩어리(20자 이상, 본문의 0.8배 이상)와 사진의 왼끝을 1mm 안으로 묶은 자리(스프레드 왼끝부터 pt).
// 쪽 가장자리에 붙은 사진은 뺀다.
export function axes(s: Page[], body: number, content: (p: Page) => Line[]) {
  const xs: number[] = [];
  let off = 0;
  for (const p of s) {
    for (const b of blocks(content(p).filter(l => l.size >= 0.8 * body)))
      if (b.reduce((a, l) => a + chars(l.text), 0) >= 20) xs.push(off + b[0].x0);
    for (const im of p.images) if (im.x0 * MM > 1) xs.push(off + im.x0);
    off += p.w;
  }
  xs.sort((a, b) => a - b);
  return xs.filter((x, i) => i === 0 || (x - xs[i - 1]) * MM > 1);
}

export function measure2(doc: Doc, looks: Map<Page, Look>, body: number) {
  const furn = furniture(doc.pages);
  const content = (p: Page) => p.lines.filter(l => !furn.has(l));

  // C: 강조색과 본문 글자·바탕 명도 차. 본문색은 본문 서체·크기로 가장 많이 쓴 글자색이다.
  const acc = accents(doc.swatches);
  const bodyFont = Object.entries(doc.pages.flatMap(content).filter(l => Math.abs(l.size - body) < 0.06)
    .reduce((m, l) => (m[l.font] = (m[l.font] ?? 0) + chars(l.text), m), {} as Record<string, number>)).sort((a, b) => b[1] - a[1])[0]?.[0];
  const ink = Object.entries(doc.inks).filter(([k]) => { const [f, sz] = k.split("|"); return f === bodyFont && Math.abs(+sz - body) < 0.15; })
    .sort((a, b) => b[1] - a[1])[0]?.[0].split("|").at(-1);
  const lightBg = [...looks.values()].filter(v => v.bg >= 50).map(v => v.bg);
  const toneText = ink && lightBg.length ? round(quantile(lightBg, 0.5) - hexL(ink), 0) : null;

  // L·F: 스프레드마다
  const sp = spreads(doc), align: number[] = [], balance: number[] = [], density: number[] = [];
  let tones = "";
  for (const s of sp) {
    const w = s.reduce((a, p) => a + p.w, 0), h = s[0].h;
    align.push(axes(s, body, content).length);
    // 균형: 왼쪽과 오른쪽의 무게 차 ÷ 합. 쪽이 하나면 그 쪽의 두 절반을 비교한다.
    const lk = s.map(p => looks.get(p)!);
    const [L, R] = s.length === 2 ? [lk[0].weight[0] + lk[0].weight[1], lk[1].weight[0] + lk[1].weight[1]] : lk[0].weight;
    balance.push(round(Math.abs(R - L) / Math.max(1e-6, R + L)));
    // 톤: 어두운 바탕(L* 50 미만)인 쪽의 비율. L 밝음, M 반반, D 어두움
    const dark = lk.filter(v => v.bg < 50).length / lk.length;
    tones += dark === 0 ? "L" : dark === 1 ? "D" : "M";
    // 밀도: 100cm²마다 글자 수
    density.push(Math.round(s.reduce((a, p) => a + content(p).reduce((b, l) => b + chars(l.text), 0), 0) / (w * h * MM * MM / 10000)));
  }

  // L4 근접성: 성격이 다른 이웃 사이에 낀 요소마다 넓은 쪽 ÷ 좁은 쪽 간격(near.ts)
  const side = doc.pages.flatMap(p => sides(p, content(p))).map(c => c.ratio);
  // 가로 정렬: 큰 요소 중 다른 요소와 윗선이나 아랫선을 함께 쓰는 비율(rows.ts)
  const rs = sp.map(s => rows(s, content, body));
  const judged = rs.reduce((a, r) => a + r.judged, 0), alone = rs.reduce((a, r) => a + r.alone.length, 0);

  return {
    "accents": acc.length, "accent.hues": acc,
    "ink": ink ?? null, "tone.text": toneText,
    "spreads": sp.length,
    "align.lines": spreadOf(align), "balance": spreadOf(balance),
    "rows.shared": judged ? round(1 - alone / judged) : null,
    "gap.side": spreadOf(side), "gap.side.clear": side.length ? round(side.filter(r => r >= 1.5).length / side.length) : null,
    "dark.share": round(tones.split("").reduce((a, t) => a + (t === "D" ? 1 : t === "M" ? 0.5 : 0), 0) / Math.max(1, tones.length)),
    "tones": tones, "density": density,
  };
}
