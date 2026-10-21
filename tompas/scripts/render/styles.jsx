// 스타일: 단락·문자 스타일, 색, 한글·라틴 조판, 제목 덩어리, 쪽번호, 사진 자리 메모

// 단락 스타일: layout이 이름 붙인 것(H1, Body, Caption…)만. 크기·굵기·간격만 담고 모두 기준선 격자에 붙인다(L2).
// 크기는 pt로 적는다(스크립트 단위가 mm라서). 글자색은 밝은 쪽의 글자색이고, 다른 색은 문자 스타일이 건다(paint)
function styles(doc) {
  var missing = {};
  for (var name in L.colors) {
    var v = L.colors[name];
    doc.colors.add({ name: name, model: ColorModel.PROCESS, space: ColorSpace.CMYK, colorValue: v });
  }
  var body = L.styles.Body ? L.styles.Body.size : 9;
  for (var name in L.styles) {
    var s = L.styles[name];
    if (!app.fonts.itemByName(s.font + "\t" + s.weight).isValid) missing[s.font + " " + s.weight] = 1;
    if (s.latin) { var lw = (s.latin.weights && s.latin.weights[s.weight]) || s.weight; if (!app.fonts.itemByName(s.latin.family + "\t" + lw).isValid) missing[s.latin.family + " " + lw] = 1; }
    var ps = doc.paragraphStyles.add({
      name: name, appliedFont: s.font, fontStyle: s.weight, pointSize: s.size + "pt", leading: s.leading + "pt",
      fillColor: swatch(doc, L.tones.light.글자),
      justification: Justification.LEFT_ALIGN, alignToBaseline: true, hyphenation: false, balanceRaggedLines: s.size > body * 1.15,
      // 문단 뒤는 기준선 몇 줄(테마의 after). 상자 끝 문단의 간격은 보이지 않는다
      spaceAfter: s.after * L.grid.baseline, spaceBefore: (s.before || 0) * L.grid.baseline, keepWithNext: s.keep ? 2 : 0,
      // 쪽이나 상자가 바뀌는 자리에 문단 첫 줄이나 끝줄이 홀로 남지 않게(H4)
      keepLinesTogether: true, keepFirstLines: 2, keepLastLines: 2
    });
    if (s.list) {
      // 목록: 항목 사이는 붙이고 목록 끝에만 간격. 글머리 폭만큼 내어 쓴다
      var indent = s.size * 1.4 / 72 * 25.4;
      ps.properties = { bulletsAndNumberingListType: s.list == "number" ? ListType.NUMBERED_LIST : ListType.BULLET_LIST,
        leftIndent: indent, firstLineIndent: -indent, sameParaStyleSpacing: 0 };
    }
    ps.gridAlignment = GridAlignment.ALIGN_BASELINE;
    if (s.firstLine) ps.gridAlignFirstLineOnly = true;   // 표 칸: 첫 줄만 기준선에, 다음 줄은 제 행간으로
    hangul(ps, s, body);
    if (s.latin) latin(doc, ps, s);
  }
  // 아이콘(L.icon, 아이콘을 쓰는 문서만): 항목 위에 크게 놓는 단락 스타일 "아이콘". 기준선에 맞추고 라벨과 붙인다.
  // 아이콘 서체(패스트 트랙)가 없으면 이 문단에는 회색 자리가 들어가고 서체는 본문 서체다
  if (L.icon) {
    var iconFont = L.icon.family || (L.styles.Body || L.styles[keys(L.styles)[0]]).font, iconWeight = L.icon.family ? L.icon.weight : "Regular";
    if (L.icon.family && !app.fonts.itemByName(iconFont + "\t" + iconWeight).isValid) missing[iconFont + " " + iconWeight] = 1;
    var ip = doc.paragraphStyles.add({ name: "아이콘", appliedFont: iconFont, fontStyle: iconWeight, pointSize: L.icon.size + "pt", leading: L.icon.leading + "pt",
      fillColor: swatch(doc, L.tones.light.글자), justification: Justification.LEFT_ALIGN, hyphenation: false, spaceAfter: 0, spaceBefore: 0, keepWithNext: 2, keepLinesTogether: true });
    ip.gridAlignment = GridAlignment.ALIGN_BASELINE;
  }
  // 표를 든 문단: 표 뒤에 한 줄을 띄운다. 표는 쪽을 넘어 나뉜다. 앞 문단과 붙이기(keep)는 걸지 않는다:
  // InDesign은 표를 한 줄로 보아 표 전체를 앞 글과 붙이려 하고, 장 첫머리부터 이어진 붙이기면 쪽 하나를 통째로 비운다(2026-10-06 영업2팀)
  for (var p = 0; p < L.pages.length; p++) for (var f = 0; f < L.pages[p].frames.length; f++) {
    var ps0 = L.pages[p].frames[f].paras || [];
    for (var k = 0; k < ps0.length; k++) if (ps0[k].table && !doc.paragraphStyles.itemByName("Table").isValid)
      doc.paragraphStyles.add({ name: "Table", pointSize: body + "pt", leading: L.grid.baseline / MM + "pt", alignToBaseline: true, gridAlignment: GridAlignment.ALIGN_BASELINE,
        spaceAfter: L.grid.baseline, spaceBefore: 0, keepLinesTogether: false, keepWithNext: 0 });
  }
  return keys(missing);
}

// 색 역할의 문자 스타일: 밝은 쪽은 "강조"·"보조", 어두운 쪽은 "어두운 쪽"(글자)·"어두운 쪽 강조"… 쓰는 것만 만든다.
// 밝은 쪽 글자색은 단락 스타일 그대로라 없다
function paint(doc, tone, role) {
  if (tone != "dark" && role == "글자") return null;
  var name = tone == "dark" ? (role == "글자" ? "어두운 쪽" : "어두운 쪽 " + role) : role;
  var cs = doc.characterStyles.itemByName(name);
  return cs.isValid ? cs : doc.characterStyles.add({ name: name, fillColor: swatch(doc, L.tones[tone][role] || role) });   // 색 역할이 아니면 색상 견본 이름(도식의 금색 글 등)
}

function swatch(doc, name) { return doc.swatches.itemByName(name); }
// 아이콘을 왼쪽에 거는 목록(hang): 원래 스타일을 바탕으로 "… 아이콘옆". 라벨 줄은 아이콘이 들여쓰기 밖에 걸리고(첫 줄 내어쓰기, 탭),
// 설명 줄은 같은 들여쓰기 선에 선다
function hangStyle(doc, name, first) {
  var n = name + " 아이콘옆" + (first ? "" : " 설명"), s = doc.paragraphStyles.itemByName(n), ind = L.icon.indent;
  if (s.isValid) return s;
  s = doc.paragraphStyles.add({ name: n, basedOn: doc.paragraphStyles.itemByName(name), leftIndent: ind, firstLineIndent: first ? -ind : 0 });
  if (first) s.tabStops.add({ position: ind, alignment: TabStopAlignment.LEFT_ALIGN });
  return s;
}
// 아이콘 자리(■): 쪽 글자색의 40% 회색. 라벨 앞 자리는 아이콘 크기(L.icon.inline)로, 위에 놓는 자리는 단락 스타일 "아이콘"의 크기 그대로
function slotChar(doc, tone, above) {
  var name = "아이콘 자리" + (above ? "" : " 앞") + (tone == "dark" ? " 어두운 쪽" : ""), cs = doc.characterStyles.itemByName(name);
  if (cs.isValid) return cs;
  cs = doc.characterStyles.add({ name: name, fillColor: swatch(doc, L.tones[tone].글자), fillTint: 40 });
  if (!above) cs.pointSize = L.icon.inline + "pt";
  return cs;
}

// 사진 자리 메모(인쇄 안 함): 디자이너에게 한국어로 적으니 한글이 보이는 서체를 쓴다(본문 서체가 라틴 서체일 때도)
function note(doc, page, layers, b, text) {
  var t = page.textFrames.add(layers.메모, undefined, undefined, { geometricBounds: [b[0] + 2, b[1] + 2, b[2] - 2, b[3] - 2] });
  t.contents = text;
  var s = doc.paragraphStyles.itemByName("사진 메모");
  if (!s.isValid) {
    // 원고에 시각 방향 메모가 없으면 메모 스타일이 없다(L.memo). 그때는 기본 단락에 작은 크기로
    s = L.memo ? doc.paragraphStyles.add({ name: "사진 메모", basedOn: doc.paragraphStyles.itemByName(L.memo), alignToBaseline: false })
      : doc.paragraphStyles.add({ name: "사진 메모", basedOn: doc.paragraphStyles[1], pointSize: "7pt", leading: "9pt", alignToBaseline: false });
    s.gridAlignment = GridAlignment.NONE;
    s.appliedLanguage = korean();   // 한글 글은 InDesign이 한국어로 바꿔 재정의가 된다
    var fs = ["Pretendard\tRegular", "Apple SD Gothic Neo\tRegular"];
    for (var i = 0; i < fs.length; i++) if (app.fonts.itemByName(fs[i]).isValid) { s.appliedFont = fs[i].split("\t")[0]; s.fontStyle = "Regular"; break; }
  }
  t.paragraphs[0].applyParagraphStyle(s, true);
}

// 한글 조판(H): 어느 컴포저도 한글을 어절 가운데서 끊는다(2026-10-05 InDesign 2026에서 시험). 그래서 단락 스타일 안의
// GREP 스타일로 한글 어절마다 '줄바꿈 없음'을 건다(재정의 없이 H1). 컴포저는 테마가 고른다. 기본은 Adobe 단락 컴포저다:
// CJK 컴포저에 이 GREP을 더하면 줄이 기준선 한 칸씩 건너뛴다(같은 날 시험). 문장부호는 어절에 붙어 금칙(H2)은 대개 지켜지고, 검사가 잰다
function hangul(ps, s, body) {
  if (L.lang != "한글") { ps.composer = "$ID/HL Composer"; english(ps, s, body); return; }
  var doc = DOC, word = doc.characterStyles.itemByName("어절");
  if (!word.isValid) word = doc.characterStyles.add({ name: "어절", noBreak: true });
  try {
    ps.composer = L.hangul.composer;
    ps.kinsokuSet = KinsokuSet.KOREAN_KINSOKU;
    ps.appliedLanguage = korean();
    // 한글이 든 어절만. 메일 주소처럼 상자보다 긴 라틴 덩어리까지 묶으면 줄을 못 바꿔 넘친다
    ps.nestedGrepStyles.add({ grepExpression: "[^\\s]*[가-힣][^\\s]*", appliedCharacterStyle: word });
  } catch (e) { WARN.push("한글 설정: " + e.message); }
}
// 라틴 원고의 곧은 아포스트로피(organization's)를 인쇄용 ’로. 원고의 낱말은 그대로다
function quotes(doc) {
  app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
  app.findGrepPreferences.findWhat = "(?<=[A-Za-z])'(?=[A-Za-z])";
  app.changeGrepPreferences.changeTo = "\u2019";
  doc.changeGrep();
  app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
}
// 라틴 원고: 영어 사전을 건다(하이픈·맞춤법). 하이픈은 테마가 켜면 본문 크기 글에만, 긴 낱말을 조심스럽게 나눈다
function english(ps, s, body) {
  try {
    for (var i = 0; i < app.languagesWithVendors.length; i++) if (/English: USA|영어: 미국/.test(app.languagesWithVendors[i].name)) { ps.appliedLanguage = app.languagesWithVendors[i]; break; }
    if (L.hyphenate && s.size <= body * 1.15) ps.properties = { hyphenation: true, hyphenateWordsLongerThan: 7, hyphenateAfterFirst: 3, hyphenateBeforeLast: 3,
      hyphenateLadderLimit: 2, hyphenateCapitalizedWords: false, hyphenateLastWord: false, hyphenateAcrossColumns: false };
  } catch (e) { WARN.push("영문 설정: " + e.message); }
}
function korean() {
  for (var i = 0; i < app.languagesWithVendors.length; i++) if (/Korean|한국/.test(app.languagesWithVendors[i].name)) return app.languagesWithVendors[i];
  return NothingEnum.NOTHING;
}
// 한영 혼용: 한글 서체에 라틴 서체를 짝지으면 로마자·숫자 덩어리에 "<스타일> 라틴" 문자 스타일을 GREP 스타일로 건다.
// 크기와 기준선 보정은 그 문자 스타일에 있다. 합성 글꼴은 스크립트로 걸 때 InDesign이 멈춰(2026-10-05 시험) 쓰지 않는다
function latin(doc, ps, s) {
  var lw = (s.latin.weights && s.latin.weights[s.weight]) || s.weight;
  var cs = doc.characterStyles.add({ name: ps.name + " 라틴", appliedFont: s.latin.family, fontStyle: lw,
    pointSize: (s.size * (s.latin.size || 1)) + "pt", baselineShift: (s.latin.baseline || 0) + "pt" });
  ps.nestedGrepStyles.add({ grepExpression: "[A-Za-z0-9][A-Za-z0-9.,%&/+\\-]*", appliedCharacterStyle: cs });
}

// H5: 제목의 의미 덩어리마다 '줄바꿈 없음' 문자 스타일을 건다. 강제 줄바꿈은 쓰지 않는다
// 글자 하나에는 문자 스타일이 하나만 걸려서, 색 문자 스타일이 있으면 그 색을 이은 "<색> 덩어리"를 쓴다
function chunk(t, k, chunks, color) {
  var para = t.parentStory.paragraphs[k], text = String(para.contents), from = 0, ranges = [];
  var name = color ? color.name + " 덩어리" : "덩어리", cs = DOC.characterStyles.itemByName(name);
  if (!cs.isValid) cs = DOC.characterStyles.add(color ? { name: name, basedOn: color, noBreak: true } : { name: name, noBreak: true });
  for (var c = 0; c < chunks.length; c++) {
    var i = text.indexOf(chunks[c], from);
    if (i < 0) continue;
    ranges.push([i, i + chunks[c].length]);
    para.characters.itemByRange(i, i + chunks[c].length - 1).appliedCharacterStyle = cs;
    from = i + chunks[c].length;
  }
  (CHUNKS[t.parentStory.id] = CHUNKS[t.parentStory.id] || {})[k] = ranges;
}

// 쪽번호: 마스터의 아래 여백 안, 바깥쪽
function folios(doc, master, g, tone) {
  var m = g.margin, s = doc.paragraphStyles.itemByName("쪽번호"), color = paint(doc, tone, L.folioColor);
  if (!s.isValid) s = doc.paragraphStyles.add({ name: "쪽번호", basedOn: doc.paragraphStyles.itemByName(L.folio), justification: Justification.AWAY_FROM_BINDING_SIDE });
  for (var i = 0; i < master.pages.length; i++) {
    var pg = master.pages[i], left = pg.side == PageSideOptions.LEFT_HAND;
    var x0 = left ? 0 : L.page.w;
    var y = L.page.h - m.bottom + g.baseline;
    var b = left ? [y, x0 + m.outer, y + 3 * g.baseline, x0 + m.outer + 20] : [y, x0 + L.page.w - m.outer - 20, y + 3 * g.baseline, x0 + L.page.w - m.outer];
    var t = pg.textFrames.add({ geometricBounds: b });
    t.contents = SpecialCharacters.AUTO_PAGE_NUMBER;
    t.paragraphs[0].applyParagraphStyle(s, true);
    if (color) t.texts[0].appliedCharacterStyle = color;
  }
}
