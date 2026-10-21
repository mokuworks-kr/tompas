// layout: 와이어프레임 칸을 mm로 바꾸고 원고를 영역에 붓는다.
//   node layout/index.ts <프로젝트 폴더>   data/layout.json을 쓴다
// 격자는 테마와 규칙(P·G 층)에서 계산한다. 판단은 하지 않는다.
import fs from "node:fs";
import path from "node:path";
import { load, type Wireframe } from "../wireframe/parse.ts";
import { glyphs, backdrops, drawings } from "../fill/index.ts";

const MM = 25.4 / 72;
const round = (v: number) => Math.round(v * 1000) / 1000;
const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));
export const references = path.resolve(import.meta.dirname, "../../references");

// 문단: 원고의 역할(role), InDesign 단락 스타일(style), 색 역할(color, 글자가 아니면)
export type Para = { role: string; style: string; text: string; color?: string; chunks?: string[]; list?: "bullet" | "number"; table?: Table; icon?: any };
// 표: 역할이 "표"인 원고 표는 InDesign 표로 짠다. 표는 빈 문단 하나(단락 스타일 Table)에 들고,
// 흐르는 글에서는 쪽을 넘으며 머리 줄(head)을 되풀이한다.
// cell·headCell은 칸 글의 단락 스타일, widths는 칸 폭(mm), pics는 칸 속 그림 [줄, 칸, 파일]
export type Table = { rows: string[][]; merge?: number[][]; pics?: [number, number, string][]; head: number; stub: boolean; cell: string; headCell: string; widths?: number[] };
// group: 아래에 붙는 글(↓)이 시작 높이를 함께 쓰는 묶음. 같은 와이어프레임의 같은 영역, 같은 줄의 칸
// flow: 다음 쪽으로 흐르는 이야기 이름(→). 이야기의 첫 상자만 글을 갖고, render가 상자를 잇는다
export type Frame = {
  kind: "text" | "image" | "tone"; letter?: string; role?: string; hero?: boolean; bottom?: boolean; group?: string; flow?: string;
  x: number; y: number; w: number; h: number; paras?: Para[]; memo?: string; pic?: any;
};
export type Page = { page: number; side: "L" | "R"; x0: number; tone: string; wireframe: string; kind: string; content: number; folio: boolean; frames: Frame[] };

// 원고의 문자: 한글이 글자의 20%를 넘으면 한글
export function language(project: string) {
  const text = read(path.join(project, "data/content.json")).blocks.map((b: any) => [b.text ?? "", ...(b.rows ?? []).flat()].join(" ")).join(" ");
  return (text.match(/[가-힣]/g)?.length ?? 0) > text.length * 0.2 ? "한글" : "라틴";
}

// 테마: 기본 위에 프로젝트 테마를 덮는다. 문자마다 다른 값({한글, 라틴})은 원고의 문자로 고른다(rules.json의 value와 같은 표기)
export function theme(project: string) {
  const base = read(path.join(references, "theme.json"));
  const own = path.join(project, "data/theme.json");
  const lang = language(project);
  const pick = (v: any): any => v && typeof v === "object" && !Array.isArray(v)
    ? ("한글" in v || "라틴" in v ? v[lang] ?? v["라틴"] : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pick(x)])))
    : v;
  // 프로젝트 테마는 바꿀 값만 적는다. 객체는 겹쳐 합치고, 수·글자·배열(CMYK)은 바꾼다
  const merge = (a: any, b: any): any => b && typeof b === "object" && !Array.isArray(b) && a && typeof a === "object" && !Array.isArray(a)
    ? Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(k => [k, k in b ? merge(a[k], b[k]) : a[k]])) : b;
  return { ...pick(fs.existsSync(own) ? merge(base, read(own)) : base), lang };
}

// 격자: 기준선(=본문 행간)으로 필드 높이를 정수배로 잡고(G2), 필드 사이는 한 줄(G3), 남는 높이는 아래 여백에 둔다
export function grid(t: any, page: { w: number; h: number }) {
  const bl = t.body.leading * MM;
  const { cols, rows } = t.grid;
  const lines = Math.floor((page.h - t.margin.top - t.margin.bottom) / bl);
  const k = Math.floor((lines - (rows - 1)) / rows);
  const textH = (rows * k + rows - 1) * bl;
  const gutter = t.grid.gutter * bl;
  const textW = page.w - t.margin.inner - t.margin.outer;
  return {
    baseline: bl, rowLines: k, cols, rows, gutter,
    colW: (textW - (cols - 1) * gutter) / cols, rowH: k * bl,
    margin: { ...t.margin, bottom: page.h - t.margin.top - textH },
  };
}

// 글자 크기는 한 척도 위에서(T4), 행간은 기준선의 정수배로(G1)
// 서체는 테마의 서체 조합(fonts)에서 역할이 고른 것(font, 없으면 본문), 색은 색 역할(color, 없으면 글자)
// 문단 뒤 간격(after)·앞 간격(before)은 기준선 몇 줄인가(없으면 뒤 한 줄, 앞 없음), keep은 다음 문단과 붙이기
// list는 목록(글머리표·번호) 스타일. 항목 사이는 붙이고 목록 끝에만 간격을 둔다
// firstLine: 첫 줄만 기준선에 맞추고 행간은 글 크기의 비율(테마의 leading)로. 표 칸처럼 작은 글이 여러 줄일 때
export type Style = {
  size: number; leading: number; weight: string; font: string; capHeight: number; color: string;
  after: number; before?: number; keep?: boolean; list?: "bullet" | "number"; latin?: any; firstLine?: boolean;
};
export function styles(t: any) {
  const out: Record<string, Style> = {};
  const add = (role: string, step: number, list?: "bullet" | "number") => {
    const s = t.styles[role] ?? t.styles["본문"];
    const st = s.step + step;
    const size = round(t.body.size * t.scale ** st);
    const ratio = size > t.body.size * 1.15 ? t.titleLeading : 1;
    const f = t.fonts[s.font ?? "본문"] ?? t.fonts["본문"];
    out[key(role, step, list)] = {
      size, leading: s.leading ? Math.round(size * s.leading * 2) / 2 : Math.max(1, Math.ceil(size * ratio / t.body.leading - 0.01)) * t.body.leading, weight: s.weight,
      font: f.family, capHeight: f.capHeight ?? 0.73, color: s.color ?? "글자", after: s.after ?? 1, ...(s.before ? { before: s.before } : {}),
      // 제목 크기와 keep인 역할은 다음 문단과 붙여 쪽 끝에 홀로 남지 않게 한다
      ...(s.keep || size >= t.body.size * 1.15 ? { keep: true } : {}), ...(list ? { list } : {}), ...(f.latin ? { latin: f.latin } : {}), ...(s.leading ? { firstLine: true } : {}),
    };
  };
  for (const role of Object.keys(t.styles)) add(role, 0);
  return { out, add };
}
const key = (role: string, step: number, list?: string) => `${role}${step ? `${step > 0 ? "+" : ""}${step}` : ""}${list ? `·${list}` : ""}`;

// 본문 안의 짧은 대문자 줄(VISION 같은)은 라벨이다. 한글이 든 줄은 아니다(ATEX 같은 약어가 섞인 한글 문장)
const isLabel = (s: string) => s.length <= 40 && s === s.toUpperCase() && /[A-Z]/.test(s) && !/[가-힣]/.test(s);

// 블록 하나를 항목 하나로: 표는 줄마다 [라벨, 글], 목록은 항목마다 문단, 글은 줄마다 문단(본문·선언 안의 짧은 대문자 줄은 라벨).
// 역할 여럿(제목+부제, 소제목+본문)은 원고 순서대로 섞는다. 크기 단계는 첫 역할에만 붙는다.
// 여기서 style은 아직 역할과 크기 단계(예: 핵심+2)다. 끝에 InDesign 이름(H1, Body…)으로 바꾼다
function itemsOf(blocks: any[], cps: number[], roles: string[], step: number, st: ReturnType<typeof styles>): Para[][] {
  const styleOf = (role: string, list?: "bullet" | "number") => { const s = role === roles[0] ? step : 0; st.add(role, s, list); return key(role, s, list); };
  const para = (r: string, text: string, list?: "bullet" | "number") => ({ role: r, style: styleOf(r, list), text, ...(list ? { list } : {}) });
  return blocks.filter(b => cps.includes(b.page) && roles.includes(b.role)).flatMap(b => b.role === "표" && b.rows
    // 표의 메모 줄(원고의 칸 이름 같은 것)은 인쇄하지 않는다. 병합이나 칸 속 그림이 있으면 줄 번호가 어긋나니 그대로 둔다
    ? [[{ role: "표", style: "Table", text: "", table: { rows: b.merge || b.pics ? b.rows : b.rows.filter((_: any, i: number) => !b.memoRows?.includes(i)),
      merge: b.merge, pics: b.pics, head: b.head ?? 1, stub: b.rows[0].length > 1,
      cell: (st.add("표", 0), "표"), headCell: (st.add("표 머리", 0), "표 머리") } }]]
    : b.rows
    ? b.rows.filter((_: any, i: number) => !b.memoRows?.includes(i)).map((r: string[], j: number) => [
      { ...para(b.role === "서명" ? "서명" : "라벨", r[0]), ...(b.icons?.[j] ? { icon: b.icons[j] } : {}) },
      ...r.slice(1).filter(Boolean).map(c => para(b.role === "서명" ? "본문" : b.role, c))])
    : b.items ? [b.items.map((text: string) => para(b.role, text, b.ordered ? "number" : "bullet"))]
    : [(b.text ?? "").split(/\n+/).filter(Boolean).map((text: string) => {
      // 제목의 의미 덩어리(H5): 에이전트가 content.json의 chunks에 적는다
      const chunks = b.chunks?.filter((c: string) => text.includes(c));
      const p = ["본문", "선언"].includes(b.role) && isLabel(text) ? para("라벨", text) : para(b.role, text);
      return { ...p, ...(chunks?.length ? { chunks } : {}) };
    })]);
}

// 아이콘 자리: 원고 표의 줄마다 content.json의 icons(이름, 또는 자리만이면 true). 칸으로 나뉜 항목(×n)은 라벨 위에 크게(문단 "아이콘"),
// 쌓인 목록은 아이콘을 왼쪽에 걸고 라벨과 설명을 같은 들여쓰기 선에 쌓는다(내어쓰기, hang). 글리프(패스트 트랙, fill)가 없으면 회색 자리(slot): 아이콘 크기의 ■ 글자다.
// 글자라서 기준선 격자에 글리프와 똑같이 앉고, 디자이너가 그 자리에 아이콘을 쳐 넣으면 된다
function icons(item: Para[], above: boolean, glyph: (name: unknown) => string | undefined): Para[] {
  const i = item.findIndex((p: any) => p.icon);
  if (i < 0) return item;
  const { icon, ...label } = item[i] as any, g = glyph(icon), mark = g ?? "\u25A0", kind = g ? { icon: true } : { slot: true };
  const marked = above ? [{ role: "아이콘", style: "아이콘", text: mark, color: "강조", ...(g ? {} : { slot: true }) } as any, label]
    : [{ ...label, text: `${mark}\t${label.text}`, ...kind, hang: true }];
  const rest = item.slice(i + 1).map(p => above ? p : { ...p, hang: true } as any);
  return [...item.slice(0, i), ...marked, ...rest];
}

// 표의 칸 폭(mm): 칸 경계를 격자 단에 맞춘다. 옆 머리(첫 칸)는 가장 긴 글이 들어갈 만큼 단 몇 개(표의 1/3까지),
// 글도 그림도 없는 칸(사이 띄움)은 단 하나, 나머지 칸은 남은 단을 똑같이 나눈다. 나눠떨어지지 않으면 옆 머리를 한 단 넓혀 보고,
// 그래도 안 되면 폭만 같게 한다(옆 머리를 더 넓히면 자료 칸이 좁아져 글이 꺾인다).
// 글 길이는 어림이다: 한글 한 자 1em, 그 밖 0.55em. 여러 칸에 걸친 글은 재지 않는다
function widths(tb: Table, w: number, g: ReturnType<typeof grid>, size: number) {
  const n = tb.rows[0].length, step = g.colW + g.gutter, total = Math.max(1, Math.round((w + g.gutter) / step)), em = size * MM;
  const wide = new Set((tb.merge ?? []).filter(m => m[3] > 1).flatMap(([r, c, rs, cs]) => Array.from({ length: rs * cs }, (_, i) => `${r + Math.floor(i / cs)},${c + i % cs}`)));
  const len = (s: string) => Math.max(0, ...s.split("\n").map(l => [...l].reduce((a, ch) => a + (/[가-힣]/.test(ch) ? 1 : 0.55), 0))) * em;
  const need = (c: number) => Math.max(0, ...tb.rows.map((r, i) => wide.has(`${i},${c}`) ? 0 : len(r[c] ?? "")));
  const empty = (c: number) => tb.rows.every(r => !r[c]) && !(tb.pics ?? []).some(p => p[1] === c);
  const units: (number | null)[] = Array.from({ length: n }, (_, c) => empty(c) && n > 1 ? 1 : null);
  const free = units.filter(u => u === null).length - (tb.stub && units[0] === null ? 1 : 0);
  if (tb.stub && units[0] === null) {
    const least = Math.max(1, Math.ceil((need(0) + g.gutter) / step)), most = Math.max(least, Math.min(least + 1, Math.floor(total / 3)));
    const fixed = units.reduce((a: number, u) => a + (u ?? 0), 0);
    let u = least;
    while (u < most && free && (total - fixed - u) % free) u++;
    units[0] = (total - fixed - u) % (free || 1) ? least : u;
  }
  const rest = total - units.reduce((a: number, u) => a + (u ?? 0), 0);
  if (free && rest < free) return Array.from({ length: n }, (_, c) => round(c < n - 1 ? (w + g.gutter) / n : (w + g.gutter) / n - g.gutter));
  const each = free ? rest / free : 0;
  return units.map((u, c) => round((u ?? each) * step - (c === n - 1 ? g.gutter : 0)));
}

// InDesign 단락 스타일 이름: 크기와 굵기만 말한다. 이 문서에서 쓴 제목 크기(본문의 1.15배 이상)를 큰 순서로 H1, H2…,
// 본문 크기는 Body, 더 작으면 Caption. 맨 이름은 제목 크기에서는 가장 많이 쓴 것이, Body·Caption에서는 Regular가 갖는다.
// 나머지는 굵기를 붙인다(Body Bold). 설정이 같은 역할은 한 스타일이다.
// 색은 스타일에 넣지 않는다. 색 역할은 문단에 적고 render가 문자 스타일로 건다
export function names(used: Record<string, number>, all: Record<string, Style>, body: number) {
  const spec = (s: Style) => JSON.stringify([s.size, s.leading, s.weight, s.font, s.after, s.before ?? 0, !!s.keep, s.list ?? null, s.latin ?? null, !!s.firstLine]);
  const specs = new Map<string, string[]>();
  for (const k of Object.keys(used)) specs.set(spec(all[k]), [...(specs.get(spec(all[k])) ?? []), k]);
  const groups = [...specs.values()].map(keys => ({ keys, s: all[keys[0]] }));
  const sizes = [...new Set(groups.map(g => g.s.size))].sort((a, b) => b - a);
  const heads = sizes.filter(x => x >= body * 1.15), smalls = sizes.filter(x => x < body * 0.99);
  const base = (x: number) => x >= body * 1.15 ? `H${heads.indexOf(x) + 1}` : x < body * 0.99 ? `Caption${smalls.indexOf(x) ? ` ${smalls.indexOf(x) + 1}` : ""}` : "Body";
  const uses = (g: { keys: string[] }) => g.keys.reduce((a, k) => a + used[k], 0);
  const map: Record<string, string> = {}, styles: Record<string, Omit<Style, "color">> = {};
  for (const x of sizes) {
    const same = groups.filter(g => g.s.size === x).sort((a, b) => (x < body * 1.15 ? +(b.s.weight === "Regular") - +(a.s.weight === "Regular") : 0) || uses(b) - uses(a));
    same.forEach((g, i) => {
      let name = base(x);
      const like = same.slice(0, i).filter(o => !o.s.list === !g.s.list);   // 목록은 목록끼리 이름을 가른다
      if (like.length) name += like.some(o => o.s.weight === g.s.weight) ? ` ${like.length + 1}` : ` ${g.s.weight}`;
      if (g.s.list) name += g.s.list === "number" ? " 번호" : " 목록";
      const { color, ...rest } = g.s;
      styles[name] = rest;
      for (const k of g.keys) map[k] = name;
    });
  }
  return { map, styles };
}

// 페이지 맵의 쪽을 정한다. 흐르는 글(→)은 render가 재 본 쪽수(data/flows.json)가 있으면 그 이야기의 마지막 항목을 늘리거나 줄이고,
// 뒤 항목을 그만큼 민다. 뒤에 스프레드 와이어프레임이 있으면 좌우가 바뀌지 않게 두 쪽씩 바꾸고(빈 쪽이 하나 생길 수 있다),
// 쪽 와이어프레임뿐이면 한 쪽씩 바꾼다(좌우 여백은 쪽 번호로 다시 정해진다). 흐름 이름은 항목의 flow, 없으면 내용 종류(kind).
// 이름 없는 흐름 항목끼리 종류가 겹치면 "종류 n"(n은 항목 순서)으로 가른다
function paginate(map: any[], wfs: Record<string, Wireframe>, file: string) {
  const measured: Record<string, number> = fs.existsSync(file) ? read(file) : {};
  const flowing = (e: any) => wfs[e.wireframe]?.areas.some(a => a.flow);
  const twice = (e: any) => map.filter((o: any) => flowing(o) && !o.flow && o.kind === e.kind).length > 1;
  const entries = map.map((e: any, i: number) => ({ ...e, pages: [...e.pages], content: [...e.content],
    flow: flowing(e) ? e.flow ?? (twice(e) ? `${e.kind} ${i + 1}` : e.kind) : undefined }));
  let offset = 0;
  entries.forEach((e: any, i: number) => {
    e.pages = e.pages.map((p: number) => p + offset);
    if (!e.flow || entries.slice(i + 1).some((o: any) => o.flow === e.flow) || !(e.flow in measured)) return;
    const planned = entries.filter((o: any) => o.flow === e.flow).reduce((a: number, o: any) => a + o.pages.length, 0);
    let extra = measured[e.flow] - planned;
    const pairs = entries.slice(entries.findIndex((o: any) => o.flow === e.flow)).some((o: any) => wfs[o.wireframe]?.spread);
    if (pairs && extra % 2) extra += 1;
    extra = Math.max(extra, -(e.pages.length - 1));
    if (extra > 0) for (let k = 0; k < extra; k++) { e.pages.push(e.pages.at(-1) + 1); e.content.push(e.content.at(-1)); }
    else if (extra < 0) { e.pages = e.pages.slice(0, extra); e.content = e.content.slice(0, extra); }
    offset += extra;
  });
  return entries;
}

// 아이콘 크기(테마 icon): 위에 놓는 크기는 척도의 단계(step), 왼쪽에 거는 크기는 라벨보다 두 단계 크게. 행간은 기준선의 정수배.
// 왼쪽에 걸 때 글이 들어가는 들여쓰기(indent, mm)는 그 크기의 1.8배
// 서체(family)는 패스트 트랙이 테마에 적을 때만 있다. 없으면 회색 자리의 크기로만 쓴다
function iconStyle(t: any) {
  const size = (st: number) => round(t.body.size * t.scale ** st);
  const big = size(t.icon?.step ?? 3);
  return { ...(t.icon?.family ? { family: t.icon.family, weight: t.icon.weight ?? "Regular" } : {}),
    size: big, leading: Math.ceil(big / t.body.leading) * t.body.leading, inline: size((t.styles["라벨"]?.step ?? 0) + 2),
    indent: round(size((t.styles["라벨"]?.step ?? 0) + 2) * 1.8 * 25.4 / 72) };
}

export function layout(project: string) {
  const data = path.join(project, "data");
  const content = read(path.join(data, "content.json"));
  const map = read(path.join(data, "pagemap.json"));
  const wfs: Record<string, Wireframe> = load(path.join(data, "wireframes"));
  const t = theme(project);
  const g = grid(t, map.page);
  const st = styles(t);
  const lang = t.lang;
  const glyph = glyphs(data, references, t);
  const entries = paginate(map.pages, wfs, path.join(data, "flows.json"));
  const total = Math.max(...entries.flatMap((e: any) => e.pages));
  const pages: Page[] = [];
  const errors: string[] = [];
  const stories = new Map<string, { frames: Frame[]; roles: string[]; step: number; content: number[] }>();

  for (const e of entries) {
    const wf = wfs[e.wireframe];
    if (!wf) { errors.push(`${e.pages.join("·")}쪽: 와이어프레임 ${e.wireframe}이 없다`); continue; }
    errors.push(...wf.errors.map(m => `${wf.name}: ${m}`));
    const per = wf.spread ? wf.cols / 2 : wf.cols;
    if (per !== g.cols || wf.rows !== g.rows) errors.push(`${wf.name}: 격자 ${per}×${wf.rows}가 테마 격자 ${g.cols}×${g.rows}와 다르다`);
    if (wf.spread && !e.flow && e.pages[0] % 2) errors.push(`${e.pages[0]}쪽: 스프레드 와이어프레임 ${wf.name}은 왼쪽(짝수) 쪽에서 시작해야 한다`);
    e.pages.forEach((p: number, i: number) => {
      const side = p % 2 === 0 ? "L" : "R";
      const left = side === "L" ? t.margin.outer : t.margin.inner;
      const page: Page = {
        page: p, side, x0: p % 2 === 1 && p > 1 ? map.page.w : 0, tone: wf.tones[wf.spread ? (side === "L" ? 0 : 1) : i % wf.tones.length],
        wireframe: wf.name, kind: e.kind, content: e.content[i], folio: p !== 1 && p !== total, frames: [],
      };
      // 어두운 바탕: 도련은 바깥쪽과 위아래에만. 가운데를 넘으면 맞은쪽 쪽에 띠가 생긴다
      if (page.tone === "dark") page.frames.push({ kind: "tone", x: side === "L" ? -3 : 0, y: -3, w: map.page.w + 3, h: map.page.h + 6 });
      for (const a of wf.areas) {
        // 스프레드 와이어프레임은 왼쪽 쪽에 왼쪽 반, 오른쪽 쪽에 오른쪽 반을 둔다(흐르는 글이면 여러 스프레드).
        // 쪽 와이어프레임은 모든 쪽에 같다
        const on = wf.spread && a.c0 >= per ? 1 : 0;
        if (wf.spread && on !== (side === "L" ? 0 : 1)) continue;
        const c0 = a.c0 - on * per;
        const box = {
          x: round(left + c0 * (g.colW + g.gutter)), y: round(g.margin.top + a.r0 * (g.rowH + g.baseline)),
          w: round(a.cols * g.colW + (a.cols - 1) * g.gutter), h: round(a.rows * g.rowH + (a.rows - 1) * g.baseline),
        };
        // 가운데를 넘는 사진은 오른쪽 쪽의 여백까지 잇는다
        if (wf.spread && a.c0 < per && a.c0 + a.cols > per) {
          const right = a.c0 + a.cols - per;
          box.w = round(map.page.w - box.x + t.margin.inner + right * g.colW + (right - 1) * g.gutter);
        }
        const roles = a.role.split("+");
        const base = { letter: a.letter, role: a.role, hero: a.hero, bottom: a.bottom || undefined, ...(a.bottom ? { group: `${wf.name}:${a.letter}:0` } : {}), ...box };
        if (a.role === "사진") {
          const memo = content.blocks.filter((b: any) => b.page === page.content && b.role === "방향").map((b: any) => b.text).join(" ");
          page.frames.push({ kind: "image", ...base, memo });
          continue;
        }
        // 흐르는 글: 상자만 만들고, 글은 끝에 이야기의 첫 상자에 붓는다
        if (a.flow) {
          const story = stories.get(e.flow) ?? { frames: [], roles, step: a.step, content: [] };
          if (!story.content.includes(page.content)) story.content.push(page.content);
          const f: Frame = { kind: "text", ...base, flow: e.flow, paras: [] };
          story.frames.push(f); stories.set(e.flow, story); page.frames.push(f);
          continue;
        }
        const items = itemsOf(content.blocks, [page.content], roles, a.step, st).map(item => icons(item, !!a.per, glyph));
        if (!items.length) errors.push(`${p}쪽 ${a.letter}: 원고 ${page.content}쪽에 ${a.role}이 없다`);
        if (!a.per) { page.frames.push({ kind: "text", ...base, paras: items.flat() }); continue; }
        // 칸은 필드 단위로 나눈다. 나눠떨어지지 않으면 폭은 똑같이, 높이는 기준선 단위로 나눈다(L2는 지킨다)
        const n = Math.min(a.per, items.length), lines = Math.ceil(items.length / n);
        const w = a.cols % n === 0 ? (a.cols / n) * g.colW + (a.cols / n - 1) * g.gutter : (box.w - (n - 1) * g.gutter) / n;
        const h = a.rows % lines === 0 ? (a.rows / lines) * g.rowH + (a.rows / lines - 1) * g.baseline
          : (Math.floor((a.rows * (g.rowLines + 1)) / lines) - 1) * g.baseline;
        items.forEach((paras, j) => page.frames.push({ kind: "text", ...base, ...(a.bottom ? { group: `${wf.name}:${a.letter}:${Math.floor(j / n)}` } : {}),
          x: round(box.x + (j % n) * (w + g.gutter)), y: round(box.y + Math.floor(j / n) * (h + g.baseline)), w: round(w), h: round(h), paras }));
      }
      pages.push(page);
    });
  }

  // 이야기마다 상자를 쪽 순서, 쪽 안에서는 왼쪽·위부터 줄 세우고 첫 상자에 원고를 원고 순서대로 붓는다
  const pageOf = new Map<Frame, number>(pages.flatMap(p => p.frames.map(f => [f, p.page] as [Frame, number])));
  const flows: Record<string, { pages: number }> = {};
  for (const [name, s] of stories) {
    s.frames.sort((a, b) => pageOf.get(a)! - pageOf.get(b)! || a.x - b.x || a.y - b.y);
    s.frames[0].paras = itemsOf(content.blocks, s.content, s.roles, s.step, st).map(item => icons(item, false, glyph)).flat();
    if (!s.frames[0].paras.length) errors.push(`흐름 ${name}: 원고 ${s.content.join("·")}쪽에 ${s.roles.join("+")}이 없다`);
    flows[name] = { pages: new Set(s.frames.map(f => pageOf.get(f))).size };
  }

  // 원고에서 인쇄할 블록 중 어느 영역에도 들어가지 않은 것
  const placed = new Set(pages.flatMap(p => wfs[p.wireframe]?.areas.flatMap(a => a.role.split("+").map(r => `${p.content}:${r}`)) ?? []));
  for (const b of content.blocks)
    if (b.role && !["메모", "방향"].includes(b.role) && !placed.has(`${b.page}:${b.role}`)) errors.push(`원고 ${b.page}쪽 ${b.role}(${b.id})이 놓일 자리가 없다`);
    else if (!b.role && b.kind === "image") errors.push(`원고 그림 ${b.id}(${b.image ?? b.text ?? ""})이 놓일 자리가 없다. 흐르는 글 속 그림은 아직 넣지 못한다`);
    else if (!b.role && b.kind !== "image")
      errors.push(`원고 블록 ${b.id}에 역할이 없다(글이 바뀌어 분류가 지워졌을 수 있다): ${(b.text ?? b.items?.[0] ?? "").slice(0, 30)}`);

  // 사진 자리에 받은 파일 놓기(data/pictures.json, 자리 이름은 쪽+글자 예: 8P): file, 맞춤(fit), 안쪽 들이기(inset), 임시 그림 표시(fpo).
  // 도식(draw)과 어두운 쪽의 바탕 사진(쪽+바탕)은 패스트 트랙 층(fill)이 붙인다
  const picFile = path.join(data, "pictures.json"), pics = fs.existsSync(picFile) ? read(picFile) : {};
  const spots = new Set([...pages.flatMap(p => p.frames.filter(f => f.kind === "image").map(f => `${p.page}${f.letter}`)), ...backdrops(pages)]);
  for (const k of Object.keys(pics)) if (!spots.has(k)) errors.push(`그림 ${k}: 그런 사진 자리가 없다`);
  for (const p of pages) for (const f of p.frames.filter(f => f.kind === "image")) {
    const pic = pics[`${p.page}${f.letter}`];
    if (pic?.file || pic?.fpo) f.pic = { ...(pic.file ? { file: path.resolve(data, pic.file) } : {}), fit: pic.fit, inset: pic.inset, fpo: pic.fpo };
  }
  const drawn = drawings(pages, pics, data, content.blocks, (role, step) => (st.add(role, step), key(role, step)), errors);

  // 쓴 스타일만 이름을 붙인다. 쪽번호는 늘, 메모는 사진 메모가 있을 때
  const paras = pages.flatMap(p => p.frames.flatMap(f => f.paras ?? []));
  const used: Record<string, number> = { 쪽번호: 0, ...(pages.some(p => p.frames.some(f => f.memo)) ? { 메모: 0 } : {}) };
  for (const p of paras) for (const k of p.table ? [p.table.cell, p.table.headCell] : [p.style]) if (k !== "아이콘") used[k] = (used[k] ?? 0) + 1;
  for (const d of drawn) used[d.style] = used[d.style] ?? 0;   // 도식 글은 이름 순서(많이 쓴 것이 맨 이름)에 셈하지 않는다
  const named = names(used, st.out, t.body.size);
  for (const p of paras.filter(p => !p.table && p.style !== "아이콘")) {
    const color = st.out[p.style].color;
    p.style = named.map[p.style];
    if (color !== "글자") p.color = color;
  }
  for (const d of drawn) { d.color = d.color ?? st.out[d.style].color; d.style = named.map[d.style]; }
  // 표: 칸 폭은 표가 든 상자(흐르는 글이면 첫 상자)의 폭으로, 그림은 프로젝트 안 경로로
  for (const f of pages.flatMap(p => p.frames)) for (const p of f.paras ?? []) if (p.table) {
    const tb = p.table;
    tb.widths = widths(tb, f.w, g, st.out[tb.cell].size);
    tb.cell = named.map[tb.cell]; tb.headCell = named.map[tb.headCell];
    if (tb.pics) tb.pics = tb.pics.map(([r, c, file]) => [r, c, path.resolve(data, file)]);   // InDesign은 절대 경로만 받는다
  }
  const special = { folio: named.map["쪽번호"], folioColor: st.out["쪽번호"].color, memo: named.map["메모"] };
  const iconed = paras.some(p => p.style === "아이콘" || (p as any).icon || (p as any).slot);
  const out = { lang, page: map.page, total, grid: { ...g, margin: g.margin }, styles: named.styles, ...special, flows,
    colors: t.colors ?? {}, tones: t.tones, fit: t.fit, hangul: t.hangul, hyphenate: t.hyphenate, ...(iconed ? { icon: iconStyle(t) } : {}),
    table: t.table, pages: pages.sort((a, b) => a.page - b.page), errors: [...new Set(errors)] };
  fs.writeFileSync(path.join(data, "layout.json"), JSON.stringify(out, null, 1) + "\n");
  return out;
}

if (process.argv[1] === import.meta.filename) for (const p of process.argv.slice(2)) {
  const l = layout(p);
  const frames = l.pages.reduce((a, p) => a + p.frames.length, 0);
  console.log(`${l.pages.length}쪽, 격자 ${l.grid.cols}×${l.grid.rows}(필드 ${l.grid.rowLines}줄), 아래 여백 ${l.grid.margin.bottom.toFixed(1)}mm, 프레임 ${frames}개`);
  for (const e of l.errors) console.log(`  문제: ${e}`);
}
