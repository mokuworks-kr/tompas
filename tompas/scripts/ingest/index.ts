// ingest: 원고를 읽어 블록으로 나누고 사실을 잠근다.
//   node ingest/index.ts <원고 파일>   원고가 있는 폴더를 프로젝트 폴더로 삼아 data/content.json을 쓴다
// 분류는 하지 않는다. 그건 에이전트의 판단이다. 에이전트가 적은 분류(role, page, memoRows, chunks, icons, sections)와
// 에이전트가 더한 사실은 다시 읽어도 남긴다. 글이 바뀐 블록의 분류만 지운다.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parse, type IRBlock } from "kordoc";
import { facts } from "./facts.ts";
import { run as decode, odd } from "./decode.ts";

type Block = {
  id: string;
  kind: "heading" | "text" | "table" | "list" | "image" | "rule";
  level?: number;
  text?: string;
  emphasis?: string[];       // 블록 전체가 굵거나 기울었을 때
  rows?: string[][];         // 표. 병합된 칸의 나머지 자리는 빈 글
  merge?: number[][];        // 표의 병합 [줄, 칸, 줄 수, 칸 수]
  pics?: [number, number, string][];   // 표 칸 속 그림 [줄, 칸, data/ 기준 경로]. 한 칸에 여럿일 수 있다
  head?: number;             // 표의 머리 줄 수(쪽이 바뀌면 되풀이한다). 에이전트가 적는다. 없으면 1
  items?: string[];          // 목록
  ordered?: boolean;
  image?: string;            // data/ 기준 경로
  from?: number;             // 원본의 쪽·슬라이드(PDF, PPTX)
  role?: string;             // 에이전트가 적는다
  page?: number;
  memoRows?: number[];
  icons?: string[];          // 표의 줄마다 아이콘 이름(data/icons.json). 에이전트가 적는다
  chunks?: string[];         // 제목의 의미 덩어리(H5). 에이전트가 적는다
};

const same = (a: Block, b: Block) => JSON.stringify([a.kind, a.text, a.rows, a.items]) === JSON.stringify([b.kind, b.text, b.rows, b.items]);

// DOCX 표 칸 속 그림: kordoc은 그림을 문서 끝에 모아 주고 칸 자리를 버린다. document.xml에서 맨 바깥 표마다 [줄, 칸, 그림 파트]를 찾는다
function docxPics(file: string) {
  const unzip = (f: string) => execFileSync("unzip", ["-p", file, f], { maxBuffer: 1 << 28 }).toString("utf8");
  const target = new Map([...unzip("word/_rels/document.xml.rels").matchAll(/<Relationship [^>]*>/g)]
    .map(m => [m[0].match(/Id="([^"]+)"/)?.[1], "word/" + m[0].match(/Target="([^"]+)"/)?.[1]?.replace(/^\/?word\//, "")]));
  const xml = unzip("word/document.xml"), tables: [number, number, string][][] = [];
  // 맨 바깥 표만: 여는 태그와 닫는 태그의 깊이를 센다
  let depth = 0, start = 0;
  for (const m of xml.matchAll(/<w:tbl>|<\/w:tbl>/g)) {
    if (m[0] === "<w:tbl>") { if (!depth++) start = m.index!; continue; }
    if (--depth) continue;
    const pics: [number, number, string][] = [];
    [...xml.slice(start, m.index).matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].forEach((tr, r) => {
      let c = 0;
      for (const tc of tr[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)) {
        for (const e of tc[0].matchAll(/r:embed="([^"]+)"/g)) pics.push([r, c, target.get(e[1]) ?? ""]);
        c += +(tc[0].match(/<w:gridSpan w:val="(\d+)"/)?.[1] ?? 1);
      }
    });
    tables.push(pics);
  }
  return tables;
}

const kinds: Record<string, Block["kind"]> = { heading: "heading", paragraph: "text", table: "table", list: "list", image: "image", separator: "rule" };

// 같은 경고는 한 줄로. 앞의 개수("3개 …")는 더한다
const merge = (ws: string[]) => {
  const m = new Map<string, number>();
  for (const w of ws) { const n = w.match(/^(\d+)개 /); const k = n ? w.slice(n[0].length) : w; m.set(k, (m.get(k) ?? 0) + (n ? +n[1] : 1)); }
  return [...m].map(([k, n]) => n > 1 ? `${n}개 ${k}` : k);
};

export async function ingest(file: string) {
  const project = path.dirname(path.resolve(file));
  const data = path.join(project, "data");
  const result = await parse(fs.readFileSync(file));
  if (!result.success) throw new Error(result.error);

  const blocks: Block[] = [];
  // 그림 파일: kordoc이 블록에 바이트를 싣지 않은 포맷(DOCX)은 따로 준 그림(images)에서 이름으로 찾는다
  const images = new Map(((result as any).images ?? []).map((i: any) => [i.filename, i]));
  const sources = new Map(((result as any).images ?? []).map((i: any) => [i.source, i]));
  const save = (name: string, bytes: Uint8Array) => {
    fs.mkdirSync(path.join(data, "images"), { recursive: true });
    fs.writeFileSync(path.join(data, "images", name), bytes);
    return `images/${name}`;
  };
  const cellPics = /\.docx$/i.test(file) ? docxPics(file) : [];
  const inCells = new Set<string>();
  let nth = 0;
  for (const b of result.blocks as IRBlock[]) {
    const id = `b${blocks.length + 1}`;
    const block: Block = { id, kind: kinds[b.type] ?? "text" };   // 번호는 넣을 때 다시 붙인다
    if (b.type === "heading") block.level = b.level;
    if (b.type === "table" && b.table) {
      block.rows = b.table.cells.map(row => row.map(c => c.text.trim()));
      const merge = b.table.cells.flatMap((row, r) => row.flatMap((c, k) => c.colSpan > 1 || c.rowSpan > 1 ? [[r, k, c.rowSpan, c.colSpan]] : []));
      if (merge.length) block.merge = merge;
      // 칸 속 그림: 칸의 블록에 있으면 그것을, DOCX면 document.xml에서 찾은 자리를 쓴다
      const pics: [number, number, string][] = [];
      b.table.cells.forEach((row, r) => row.forEach((c, k) => (c.blocks ?? []).forEach((x, j) => {
        if (x.type === "image" && x.imageData) pics.push([r, k, save(`${id}-${r}-${k}-${j}.${x.imageData.mimeType.split("/")[1]}`, x.imageData.data)]);
      })));
      for (const [r, k, part] of cellPics[nth] ?? []) {
        const img: any = sources.get(part);
        if (!img) continue;
        pics.push([r, k, save(img.filename, img.data)]);
        inCells.add(img.filename);
      }
      nth++;
      if (pics.length) block.pics = pics;
    }
    else if (b.type === "list") {
      // kordoc은 목록 항목을 블록 하나씩 준다(글은 text). 이어진 같은 종류의 항목은 목록 하나로 묶는다
      const items = (b.children?.length ? b.children.map(c => c.text?.trim() ?? "") : [b.text?.trim() ?? ""]).filter(Boolean);
      const prev = blocks.at(-1), ordered = b.listType === "ordered";
      if (prev?.kind === "list" && prev.ordered === ordered && prev.from === (b as any).pageNumber) { prev.items!.push(...items); continue; }
      block.items = items; block.ordered = ordered;
    }
    else if (b.type === "image" && b.imageData) block.image = save(`${id}.${b.imageData.mimeType.split("/")[1]}`, b.imageData.data);
    else if (b.type === "image" && images.has(b.text?.trim())) {
      // 표 칸에 놓인 그림은 표가 갖는다(kordoc이 문서 끝에 다시 준다)
      const img: any = images.get(b.text!.trim());
      if (inCells.has(img.filename)) continue;
      block.image = save(img.filename, img.data);
    }
    else if (b.text?.trim()) block.text = b.text.trim();
    else if (b.type !== "separator") continue;  // 빈 문단
    if ((b as any).pageNumber) block.from = (b as any).pageNumber;
    const em = ["bold", "italic"].filter(k => (b.style as any)?.[k]);
    if (em.length) block.emphasis = em;
    // 빈 줄로 나뉜 문단은 블록 하나씩. 본문 안에 숨은 구조(VISION/MISSION 같은)를 따로 분류할 수 있게
    const parts = block.text?.split(/\n\s*\n/).map(t => t.trim()).filter(Boolean) ?? [];
    if (parts.length > 1) for (const text of parts) blocks.push({ ...block, id: `b${blocks.length + 1}`, text });
    else blocks.push({ ...block, id: `b${blocks.length + 1}` });
  }

  // 표 개수가 다르면(kordoc이 틀 표를 글로 풀었을 때) 칸 속 그림 자리를 믿을 수 없다
  const warnings = (result.warnings ?? []).map((w: any) => w.message ?? String(w));
  if (cellPics.length && cellPics.length !== nth) warnings.push(`표 칸 속 그림의 자리를 확인할 것: 원고의 표 ${cellPics.length}개, 읽은 표 ${nth}개`);

  const out = path.join(data, "content.json");
  const old = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};

  // 깨진 기호 풀기(PDF). 처음 보는 기호가 있을 때만 글자 인식을 돌린다. 에이전트가 적은 답은 그대로 둔다
  const table: Record<string, { to: string | null; by?: string; seen?: number; context?: string }> = { ...(old.decode ?? {}) };
  const texts = (b: Block) => [b.text ?? "", ...(b.rows ?? []).flat(), ...(b.items ?? [])];
  const found = new Set(blocks.flatMap(b => texts(b).join(" ").match(odd) ?? []));
  const sheet = path.join(data, "decode.png");
  if (/\.pdf$/i.test(file) && [...found].some(ch => !(ch in table))) {
    fs.mkdirSync(data, { recursive: true });
    for (const d of decode(file, sheet))
      if (!table[d.char]?.to) table[d.char] = { to: d.to, ...(d.to ? { by: "인식" } : {}), seen: d.seen, context: d.context };
  }
  // 깨진 기호를 풀고, kordoc이 남긴 링크 표기([글](주소))는 글만 남긴다
  const fix = (t: string) => t.replace(odd, ch => table[ch]?.to ?? ch).replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, "$1");
  for (const b of blocks) {
    if (b.text) b.text = fix(b.text);
    if (b.rows) b.rows = b.rows.map(r => r.map(fix));
    if (b.items) b.items = b.items.map(fix);
  }
  const unsolved = [...found].filter(ch => !table[ch]?.to);
  if (!unsolved.length) fs.rmSync(sheet, { force: true });
  // 분류는 번호가 아니라 글로 잇는다(문단을 나누면 번호가 밀린다). 같은 글이 없으면 그 글을 품은 옛 블록을 따른다
  const used = new Set<Block>();
  for (const b of blocks) {
    const o = old.blocks?.find((x: Block) => !used.has(x) && same(x, b))
      ?? (b.text ? old.blocks?.find((x: Block) => x.kind === b.kind && x.text?.includes(b.text!)) : undefined);
    if (!o) continue;
    if (same(o, b)) used.add(o);
    Object.assign(b, { role: o.role, page: o.page, memoRows: o.memoRows, chunks: o.chunks, head: o.head, icons: o.icons });
  }
  // 에이전트가 더한 사실은 지금 블록 번호로 다시 잇는다
  const agentFacts = (old.facts ?? []).filter((f: any) => f.by === "에이전트").map((f: any) => ({
    ...f, blocks: blocks.filter(b => [b.text ?? "", ...(b.rows ?? []).flat()].some(t => t.includes(f.text))).map(b => b.id),
  }));

  const content = {
    source: { file: path.basename(file), type: result.fileType, title: result.metadata?.title, ingested: new Date().toISOString().slice(0, 10) },
    sections: old.sections,
    ...(Object.keys(table).length ? { decode: table } : {}),
    blocks,
    facts: [...facts(blocks), ...agentFacts],
    warnings: merge(warnings),
  };
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(out, JSON.stringify(content, null, 1) + "\n");
  return content;
}

for (const f of process.argv.slice(2)) {
  const c = await ingest(f);
  const count = (k: string) => c.blocks.filter(b => b.kind === k).length;
  const fact = (k: string) => c.facts.filter(x => x.kind === k).length;
  console.log(`${c.source.file}: 블록 ${c.blocks.length}(제목 ${count("heading")}, 글 ${count("text")}, 표 ${count("table")}, 목록 ${count("list")}, 그림 ${count("image")})`
    + `, 잠긴 사실 ${c.facts.length}(숫자 ${fact("number")}, 날짜 ${fact("date")}, 이름 ${fact("name")})`);
  for (const w of c.warnings) console.log(`  경고: ${w}`);
  // 깨진 기호: 엔진이 푼 것은 한 줄로, 못 푼 것은 에이전트가 data/decode.png를 보고 content.json의 decode에 적는다
  const d = Object.entries(c.decode ?? {}) as [string, any][];
  if (d.length) console.log(`  깨진 기호 ${d.length}종: 풀림 ${d.filter(([, v]) => v.to).length}(${d.filter(([, v]) => v.to).map(([k, v]) => `${k}→${v.to}`).join(" ")})`);
  const left = d.filter(([, v]) => !v.to);
  if (left.length) console.log(`  못 푼 기호 ${left.length}종: ${left.map(([k]) => k).join(" ")}. `
    + `data/decode.png에서 모양을 보고 content.json decode의 to에 글자를, by에 "에이전트"를 적은 뒤 ingest를 다시 돌린다. `
    + "모양으로도 모르면 디자이너에게 묻는다");
}
