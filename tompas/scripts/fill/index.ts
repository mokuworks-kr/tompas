// fill: 패스트 트랙의 채우기 층(D-47). 엔진은 자리를 잡고 받은 파일을 놓기까지만 한다.
// 여기서는 그 위에 아이콘 글리프, 도식(draw), 어두운 쪽의 바탕 사진(쪽+바탕)을 더한다. 데이터가 없으면 아무것도 하지 않는다.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "../layout/index.ts";

const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));

// 아이콘 글리프: 테마에 아이콘 서체(icon.family)가 있고 이름이 data/icons.json(기본 위에 프로젝트 표)에 있으면 글자 하나.
// 아니면 undefined라 엔진이 회색 자리를 둔다
export function glyphs(data: string, references: string, t: any) {
  if (!t.icon?.family) return () => undefined;
  const own = path.join(data, "icons.json");
  const table: Record<string, string> = { ...read(path.join(references, "icons.json")), ...(fs.existsSync(own) ? read(own) : {}) };
  return (name: unknown) => typeof name === "string" ? String.fromCodePoint(parseInt(table[name] ?? name, 16)) : undefined;
}

// 바탕 사진 자리: 어두운 쪽마다 "쪽+바탕"(예: 2바탕)
export const backdrops = (pages: Page[]) => pages.flatMap(p => p.frames.some(f => f.kind === "tone") ? [`${p.page}바탕`] : []);

// 도식과 바탕 사진을 자리에 붙인다. 도식 좌표는 자리 왼쪽 위에서 mm. 도식의 글은 원고에 있는 글만 쓴다(사실을 지어내지 않는다).
// 글의 크기는 역할과 단계(role, step)로 고른다(styleOf가 스타일 키를 준다). 바탕 사진 위에는 쪽 바탕색 막(veil, 불투명도 %)을 덮는다
export function drawings(pages: Page[], pics: Record<string, any>, data: string, blocks: any[], styleOf: (role: string, step: number) => string, errors: string[]) {
  const flat = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();   // 대소문자는 가리지 않는다(대문자 라벨도 같은 말이다)
  const source = flat(blocks.filter((b: any) => !["메모", "방향"].includes(b.role))
    .map((b: any) => [b.text ?? "", ...(b.rows ?? []).flat(), ...(b.items ?? [])].join("\n")).join("\n"));
  for (const p of pages) for (const f of p.frames) {
    const pic = f.kind === "image" ? pics[`${p.page}${f.letter}`] : f.kind === "tone" ? pics[`${p.page}바탕`] : null;
    if (!pic) continue;
    if (f.kind === "tone") { f.pic = { file: path.resolve(data, pic.file), veil: pic.veil }; continue; }
    if (!pic.draw) continue;
    f.pic = { ...f.pic, draw: pic.draw.map((d: any) => {
      if (d.image) return { ...d, image: path.resolve(data, d.image) };
      if (d.text === undefined) return d;
      if (!source.includes(flat(d.text))) errors.push(`${p.page}${f.letter} 도식: 원고에 없는 글 "${d.text}"`);
      return { ...d, style: styleOf(d.role ?? "라벨", d.step ?? 0) };
    }) };
  }
  return pages.flatMap(p => p.frames.flatMap(f => (f.pic?.draw ?? []).filter((d: any) => d.style)));
}
