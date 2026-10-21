// 잠긴 사실: 숫자, 날짜, 이름. 조판 뒤 출력물에 원문 그대로 있는지 검사하는 목록이다.
// 기계로 확실히 잡히는 것만 잡는다. 한글 고유명사처럼 기계가 못 잡는 이름은 에이전트가 더한다.

// 인쇄하지 않는 블록(메모, 방향)과 메모 줄은 건너뛴다.

type Fact = { text: string; kind: "number" | "date" | "name"; blocks: string[]; by?: string };
const unprinted = ["메모", "방향"];

const month = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";
const date = new RegExp([
  "(?:19|20)\\d{2}[.\\-/]\\s?\\d{1,2}(?:[.\\-/]\\s?\\d{1,2})?\\.?",   // 2026.03.15, 2026-03
  "(?:19|20)\\d{2}년(?:\\s?\\d{1,2}월)?(?:\\s?\\d{1,2}일)?",          // 2026년 3월 15일
  "\\d{1,2}월(?:\\s?\\d{1,2}일)?",                                     // 3월 15일
  `${month}\\s\\d{1,2},?\\s(?:19|20)\\d{2}`, `${month}\\s(?:19|20)\\d{2}`, // March 15, 2026 / March 2026
  "\\b(?:19|20)\\d{2}\\b",                                             // 2026
].join("|"), "g");
// 번호: 특허·출원·인증 번호와 전화번호처럼 숫자가 기호로 이어진 것은 한 덩어리로 잠근다
const code = /\+?\d{2,4}(?:[\s-]\d{3,4}){1,3}\b|\b[A-Z0-9]*\d[A-Z0-9]*(?:[-/][A-Z0-9]+)+|\b[A-Z]+(?:[-/][A-Z0-9]+)*[-/][A-Z0-9]*\d[A-Z0-9]*/g;
const address = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?:https?:\/\/|www\.)[^\s,]+[^\s,.]/g;
// 주소 번지처럼 글자에 붙은 숫자(공단1대로)는 잠그지 않는다. 단위는 긴 것부터
const number = /(?<![가-힣A-Za-z])[$₩€£]?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|\+|[xX]\b|배|개|명|건|곳|억|만|천|원|년|개월|톤|kWh|MWh|kW|MW|GW|kg|mm|cm|km|㎡|K\b|M\b|B\b|t\b|m\b|g\b))*/g;
const company = /\(주\)\s?[^\s,.]+|㈜\s?[^\s,.]+|주식회사\s?[^\s,.]+|[가-힣A-Za-z][^\s,.(]*\s?(?:\(주\)|㈜)/g;
const caps = /\b[A-Z][A-Z0-9&]*[A-Z0-9]\b/g;   // ACME, AI, R&D
const camel = /\b[A-Za-z]*[a-z][A-Z][A-Za-z]*\b/g;  // iPhone, SaaS

// 제목처럼 단어마다 대문자로 시작하면 대문자로 이름을 가릴 수 없다
const titleCase = (s: string) => {
  const words = s.match(/\b[A-Za-z]{4,}\b/g) ?? [];
  return words.length > 0 && words.filter(w => /^[A-Z]/.test(w)).length / words.length > 0.6;
};

const names = (s: string) => s.split("\n").flatMap(line);

function line(s: string) {
  const found = [...s.matchAll(camel)].map(m => m[0]);
  // 대문자로 쓴 라벨(ON-PREMISES AND sLM)에서는 대문자로 이름을 가릴 수 없다
  const words = s.match(/[A-Za-z]{2,}/g) ?? [];
  if (words.filter(w => w === w.toUpperCase()).length / words.length >= 0.5) return found;
  found.push(...[...s.matchAll(caps)].map(m => m[0]).filter(w => w !== "I"));
  if (titleCase(s)) return found;
  // 문장 첫 단어가 아닌 대문자 단어 묶음: Seoul National University
  for (const sentence of s.split(/(?<=[.!?:;])\s+/)) {
    for (const m of sentence.matchAll(/\b[A-Z][a-z]+(?:[\s-][A-Z][A-Za-z]+)*\b/g))
      if (m.index! > 0 && !m[0].match(camel)) found.push(m[0]);
  }
  return found;
}

export function facts(blocks: { id: string; text?: string; rows?: string[][]; items?: string[]; role?: string; memoRows?: number[] }[]): Fact[] {
  const seen = new Map<string, Fact>();
  const add = (text: string, kind: Fact["kind"], id: string) => {
    text = text.trim().replace(/[.,]$/, "");
    if (!text) return;
    const f = seen.get(text) ?? { text, kind, blocks: [] };
    if (!f.blocks.includes(id)) f.blocks.push(id);
    seen.set(text, f);
  };
  for (const b of blocks) {
    if (unprinted.includes(b.role!) || (b as any).kind === "image") continue;   // 그림 블록의 글은 파일 이름이다
    const rows = (b.rows ?? []).filter((_, i) => !b.memoRows?.includes(i));
    for (let s of [b.text ?? "", ...rows.flat(), ...(b.items ?? [])]) {
      for (const m of s.matchAll(address)) add(m[0], "name", b.id);
      s = s.replace(address, " ");
      for (const m of s.matchAll(code)) add(m[0], "number", b.id);
      s = s.replace(code, " ");
      for (const m of s.matchAll(date)) add(m[0], "date", b.id);
      s = s.replace(date, " ");                  // 날짜 안의 숫자를 숫자로 다시 세지 않는다
      for (const m of s.matchAll(number)) add(m[0], "number", b.id);
      for (const m of s.matchAll(company)) add(m[0], "name", b.id);
      for (const n of names(s)) add(n, "name", b.id);
    }
  }
  return [...seen.values()];
}
