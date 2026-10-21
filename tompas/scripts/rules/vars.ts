// 규칙의 변수를 모은다. 출처는 셋이다: 계획(layout·와이어프레임·페이지 맵), InDesign 측정(render.json), PDF 측정(measure).
// 아직 없는 출처의 변수는 비워 둔다. 그 규칙은 "잴 수 없음"이 된다.
import fs from "node:fs";
import path from "node:path";
import { load } from "../wireframe/parse.ts";
import { theme, references } from "../layout/index.ts";
import { colorVars } from "./color.ts";
import type { Vars } from "./engine.ts";
import { read as readPdf } from "../measure/read.ts";
import { furniture } from "../measure/vars.ts";
import { sides } from "../measure/near.ts";
import { rows } from "../measure/rows.ts";
import { spreads as pdfSpreads } from "../measure/spread.ts";

const read = (f: string) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
const r2 = (v: number) => Math.round(v * 100) / 100;

// 물리 스프레드: 1쪽은 홀로, 그다음은 짝수·홀수 쪽이 마주 본다
export const spreadOf = (p: number) => p === 1 ? 0 : Math.floor(p / 2);

export async function collect(project: string, pdf?: (file: string) => Promise<any>): Promise<{ vars: Vars; lang: string }> {
  const data = path.join(project, "data");
  const L = read(path.join(data, "layout.json"));
  const t = theme(project);
  const wfs = load(path.join(data, "wireframes"));
  const g = L.grid, m = g.margin, MM = 25.4 / 72;
  const at: Record<string, string[]> = {};
  const v: Vars = { at };

  // 판·글자·격자: 테마와 계산된 격자
  const tw = L.page.w - m.inner - m.outer, th = L.page.h - m.top - m.bottom;
  Object.assign(v, {
    "page.w": L.page.w, "page.h": L.page.h, "pages": L.total, "page.ratio": r2(L.page.w / L.page.h),
    "margin.inner": m.inner, "margin.outer": m.outer, "margin.top": m.top, "margin.bottom": r2(m.bottom),
    "margin.ends": r2(Math.max(m.top, m.bottom)), "margin.sides": Math.max(m.inner, m.outer),
    "text.ratio": r2(tw / th), "text.share": r2(tw * th / (L.page.w * L.page.h)),
    "body.size": t.body.size, "body.leading": t.body.leading, "scale.ratio": t.scale,
    "baseline": r2(g.baseline), "row.h": r2(g.rowH), "row.gap": r2(g.baseline), "col.gutter": r2(g.gutter),
  });

  // 색: 테마의 색 역할을 흑백 계획(기본 테마)과 견준다
  Object.assign(v, colorVars(t, JSON.parse(fs.readFileSync(path.join(references, "theme.json"), "utf8"))));

  // 배치: 프레임 모서리가 필드선에서 벗어난 거리(L1)
  const fx = (left: number) => Array.from({ length: g.cols }, (_, c) => [left + c * (g.colW + g.gutter), left + c * (g.colW + g.gutter) + g.colW]).flat();
  const fy = Array.from({ length: g.rows }, (_, r) => [m.top + r * (g.rowH + g.baseline), m.top + r * (g.rowH + g.baseline) + g.rowH]).flat();
  const near = (x: number, lines: number[]) => Math.min(...lines.map(l => Math.abs(l - x)));
  const frames: number[] = [], frameAt: string[] = [];
  for (const p of L.pages) {
    const xs = fx(p.side === "L" ? m.outer : m.inner);
    for (const f of p.frames.filter((f: any) => f.kind !== "tone")) {
      const right = f.x + f.w > L.page.w ? [] : [near(f.x + f.w, xs)];   // 가운데를 넘는 사진의 오른끝은 맞은쪽 격자에 있다
      frames.push(r2(Math.max(near(f.x, xs), ...right, near(f.y, fy), near(f.y + f.h, fy))));
      frameAt.push(`${p.page}쪽 ${f.letter}`);
    }
  }
  v.frames = frames; v.fields = [0]; at.frames = frameAt;

  // 와이어프레임이 정하는 것: 주인공, 영역 수, 빈 곳, 톤, 와이어프레임 수
  const spreads = new Map<number, any[]>();
  for (const p of L.pages) spreads.set(spreadOf(p.page), [...(spreads.get(spreadOf(p.page)) ?? []), p]);
  const sp = [...spreads.values()];
  const label = (ps: any[]) => ps.map(p => p.page).join("–") + "쪽";
  const half = (p: any) => {
    const wf = wfs[p.wireframe], per = wf.spread ? wf.cols / 2 : wf.cols;
    const i = wf.spread ? (p.side === "L" ? 0 : 1) : 0;
    return wf.cells.map(r => r.slice(i * per, i * per + per));
  };
  const letters = (p: any) => [...new Set(p.frames.filter((f: any) => f.kind !== "tone").map((f: any) => f.letter))];
  // L6 주인공 수: *를 단 영역 중, 같은 종류(사진끼리, 글끼리)의 다른 요소가 1.5배 넘게 무겁지 않은 것만 센다.
  // 무게는 사진이 면적, 글이 가장 큰 글자 크기(눈은 많은 글보다 큰 글에 먼저 간다).
  // 주인공을 키우라는 뜻이 아니다. 표시와 실제 화면이 크게 어긋난 곳만 잡는다
  const heroes = sp.map(ps => {
    const els = new Map<string, { kind: string; w: number; hero: boolean; name: string }>();
    for (const p of ps) for (const f of p.frames.filter((f: any) => f.kind !== "tone")) {
      // 표만 든 상자는 사진처럼 면적으로 잰다
      const kind = f.kind === "image" || f.paras?.length && f.paras.every((x: any) => x.table) ? "image" : f.kind;
      const key = `${p.page}${f.letter}`, e = els.get(key) ?? { kind, w: 0, hero: !!f.hero, name: `${p.page}쪽 ${f.letter}` };
      e.w = kind === "image" ? e.w + f.w * f.h : Math.max(e.w, ...(f.paras ?? []).map((x: any) => L.styles[x.style]?.size ?? 0));
      els.set(key, e);
    }
    const all = [...els.values()], weak: string[] = [];
    const n = all.filter(e => e.hero).filter(e => {
      const big = all.filter(o => o !== e && o.kind === e.kind && o.w >= e.w * 1.5).sort((a, b) => b.w - a.w)[0];
      if (big) weak.push(`주인공 ${e.name}보다 ${big.name}가 ${(big.w / e.w).toFixed(1)}배 무겁다`);
      return !big;
    }).length;
    return { n, weak };
  });
  // 흐르는 본문(→)만 있는 스프레드는 재지 않는다. 긴 글을 읽는 쪽에는 주인공이 없는 게 자연스럽다
  const prose = sp.map(ps => ps.every((p: any) => p.frames.filter((f: any) => f.kind !== "tone").every((f: any) => f.flow)));
  v.heroes = heroes.map(h => h.n).filter((_, i) => !prose[i]);
  at.heroes = sp.map((ps, i) => [label(ps), ...heroes[i].weak].join(": ")).filter((_, i) => !prose[i]);
  v.areas = L.pages.map((p: any) => letters(p).length); at.areas = L.pages.map((p: any) => `${p.page}쪽`);
  v["space.lump"] = sp.map(ps => lump(ps.map(half).reduce((a, b) => a.map((r: string[], i: number) => [...r, ...b[i]]))));
  at["space.lump"] = sp.map(label);
  const tone = (ps: any[]) => { const d = ps.filter(p => p.tone === "dark").length / ps.length; return d === 1 ? "D" : d ? "M" : "L"; };
  v.tones = sp.map(tone).join("");
  v["dark.share"] = r2(sp.reduce((a, ps) => a + ps.filter((p: any) => p.tone === "dark").length / ps.length, 0) / sp.length);
  v.wireframes = new Set(L.pages.map((p: any) => p.wireframe)).size;
  const kinds = new Map<string, Set<string>>();
  for (const p of L.pages) kinds.set(p.kind, (kinds.get(p.kind) ?? new Set()).add(p.wireframe));
  v["wireframe.mix"] = [...kinds.values()].filter(s => s.size > 1).length;

  // InDesign 측정
  const R = read(path.join(data, "render.json"));
  if (R && !R.error) {
    Object.assign(v, { sizes: R.sizes, "sizes.n": R.sizes.length, leadings: R.leadings.map((x: number) => r2(x * MM)), families: R.families.length, "title.step": titleStep(R.sizes, t.body.size) });
    const bl = (y: number) => { const k = (y - m.top) / g.baseline; return r2(Math.abs(k - Math.round(k)) * g.baseline); };
    const firsts = R.frames.filter((f: any) => f.firstBaseline != null);
    v.firstlines = firsts.map((f: any) => bl(f.firstBaseline)); v.baselines = [0]; at.firstlines = firsts.map((f: any) => `${f.page}쪽 ${f.name}`);
    const paras = R.frames.flatMap((f: any) => f.paras.map((p: any) => ({ ...p, at: `${f.page}쪽 ${f.name}` })));
    const body = paras.filter((p: any) => p.role === "본문" && p.lines.length > 2);
    v.measure = body.map((p: any) => Math.round(p.lines.slice(0, -1).reduce((a: number, b: number) => a + b, 0) / (p.lines.length - 1)));
    at.measure = body.map((p: any) => p.at);
    const multi = paras.filter((p: any) => ["본문", "핵심", "부제"].includes(p.role) && p.lines.length > 1);
    v["lastline.chars"] = multi.map((p: any) => p.lines.at(-1)); at["lastline.chars"] = multi.map((p: any) => p.at);
    // 한글(H): 문단마다 센 줄바꿈. 자리는 문단이 든 상자로 알린다
    const hs = paras.filter((p: any) => p.breaks);
    for (const [k, key, of] of [["breaks.midword", "midword", (p: any) => p.breaks.midword], ["kinsoku", "kinsoku", (p: any) => p.breaks.kinsoku],
      ["widows", "widow", (p: any) => +p.widow], ["title.splits", "splits", (p: any) => p.breaks.splits]] as const) {
      const xs = hs.filter((p: any) => of(p) != null);
      v[k] = key === "splits" && !xs.length ? null : xs.map(of); at[k] = xs.map((p: any) => p.at);
    }
  }

  // PDF 측정: 아카이브와 같은 자로 잰다
  const file = path.join(project, "out", `${path.basename(project)}.pdf`);
  if (pdf && fs.existsSync(file)) {
    const M = await pdf(file);
    if (!M.skip) for (const k of ["col.n", "align.lines", "balance", "density"]) v[k] = M.vars[k];
    // L4: 요소마다 잰다. 어느 쪽 어느 영역인지 layout의 프레임과 겹쳐 이름을 붙인다
    const doc = await readPdf(file), furn = furniture(doc.pages);
    // 표는 사진처럼 요소 하나다. 표 안의 글·그림·괘선을 빼고 표가 차지한 자리를 그림 하나로 둔다(render.json의 tables, mm)
    for (const tb of R?.tables ?? []) {
      const p = doc.pages.find(x => x.n === tb.page);
      if (!p) continue;
      const box = { x0: tb.x / MM, y0: tb.y / MM, x1: (tb.x + tb.w) / MM, y1: (tb.y + tb.h) / MM };
      const out = (b: { x0: number; x1: number; y0: number; y1: number }) => !(b.x0 >= box.x0 - 1 && b.x1 <= box.x1 + 1 && b.y0 >= box.y0 - 2 && b.y1 <= box.y1 + 2);
      p.lines = p.lines.filter(l => out({ x0: l.x0, x1: l.x1, y0: l.y - l.size * 0.8, y1: l.y }));
      p.images = [...p.images.filter(out), box];
      p.marks = p.marks.filter(out);
    }
    // 채운 사진 자리(도식, 놓은 그림)도 요소 하나다. 도식 속 점·선·글을 따로 세지 않고, 실제로 그려진 자리를 그림 하나로 둔다(layout의 pic, mm)
    for (const pg of L.pages) for (const f of pg.frames.filter((f: any) => f.pic)) {
      const p = doc.pages.find(x => x.n === pg.page);
      if (!p) continue;
      const area = { x0: f.x / MM, y0: f.y / MM, x1: (f.x + f.w) / MM, y1: (f.y + f.h) / MM };
      const out = (b: { x0: number; x1: number; y0: number; y1: number }) => !(b.x0 >= area.x0 - 1 && b.x1 <= area.x1 + 1 && b.y0 >= area.y0 - 2 && b.y1 <= area.y1 + 2);
      const lineBox = (l: any) => ({ x0: l.x0, x1: l.x1, y0: l.y - l.size * 0.8, y1: l.y });
      const inside = [...p.lines.map(lineBox), ...p.images, ...p.marks].filter(b => !out(b));
      const box = inside.length ? {
        x0: Math.min(...inside.map(b => b.x0)), y0: Math.min(...inside.map(b => b.y0)),
        x1: Math.max(...inside.map(b => b.x1)), y1: Math.max(...inside.map(b => b.y1)),
      } : area;
      p.lines = p.lines.filter(l => out(lineBox(l)));
      p.images = [...p.images.filter(out), box];
      p.marks = p.marks.filter(out);
    }
    // 1에 가까운(가장 모호한) 자리부터
    const cases = doc.pages.flatMap(p => sides(p, p.lines.filter(l => !furn.has(l)))).sort((a, b) => a.ratio - b.ratio);
    const name = (n: number, e: any) => {
      const page = L.pages.find((p: any) => p.page === n);
      const box = { x0: e.x0 * MM, x1: e.x1 * MM, y0: e.y0 * MM, y1: e.y1 * MM };
      const hit = page?.frames.filter((f: any) => f.kind !== "tone")
        .map((f: any) => ({ f, area: Math.max(0, Math.min(box.x1, f.x + f.w) - Math.max(box.x0, f.x)) * Math.max(0, Math.min(box.y1, f.y + f.h) - Math.max(box.y0, f.y)) }))
        .sort((a: any, b: any) => b.area - a.area)[0];
      return hit?.area > 0 ? `${hit.f.role}(${hit.f.letter})` : e.kind;
    };
    // L11: 비슷한 높이에서 시작하는 묶음이 선을 함께 쓰는가(1·0). 함께 쓰지 않는 것부터
    const starts = pdfSpreads(doc).flatMap(s => { const r = rows(s, p => p.lines.filter(l => !furn.has(l)), t.body.size); return r.starts.map(x => ({ ...x, alone: r.alone.includes(x) })); })
      .sort((a, b) => +b.alone - +a.alone);
    v["rows.share"] = starts.map(x => x.alone ? 0 : 1);
    at["rows.share"] = starts.map(x => `${x.page.n}쪽 ${name(x.page.n, x.e)}: 윗선 ${(x.e.y0 * MM).toFixed(1)}mm, 높이를 함께 쓰는 요소 없음`);
    v["gap.side"] = cases.map(c => c.ratio);
    at["gap.side"] = cases.map(c => {
      const [before, after] = c.axis === "세로" ? ["위", "아래"] : ["왼쪽", "오른쪽"];
      return `${c.page}쪽 ${name(c.page, c.el)}: ${before} ${name(c.page, c.a)} ${c.ga}mm · ${after} ${name(c.page, c.b)} ${c.gb}mm`;
    });
  }
  return { vars: v, lang: L.lang };
}

// 제목 크기(본문의 1.15배 이상)끼리 이웃한 비율 중 가장 작은 값
function titleStep(sizes: number[], body: number) {
  const s = [...new Set(sizes.filter(x => x >= body * 1.15))].sort((a, b) => a - b);
  return s.length < 2 ? null : r2(Math.min(...s.slice(1).map((x, i) => x / s[i])));
}

// 빈 칸(.)의 가장 큰 덩어리 ÷ 빈 칸 전체
function lump(cells: string[][]) {
  const seen = new Set<string>(); let total = 0, best = 0;
  cells.forEach((r, y) => r.forEach((c, x) => {
    if (c !== "." || seen.has(`${x},${y}`)) return;
    let n = 0; const stack = [[x, y]];
    while (stack.length) {
      const [a, b] = stack.pop()!; const k = `${a},${b}`;
      if (seen.has(k) || cells[b]?.[a] !== ".") continue;
      seen.add(k); n++; stack.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
    }
    total += n; best = Math.max(best, n);
  }));
  return total ? r2(best / total) : 1;
}
