// 표와 표 칸 속 그림

// 표(역할 "표"): 빈 문단에 InDesign 표를 넣는다. 칸 경계는 layout이 격자 단에 맞춘 폭이다.
// 표 스타일 "표"가 위아래 굵은 선을, 칸 스타일이 줄 사이 가는 선(칸)과 머리 아래 굵은 선(머리 칸)을 건다. 세로선은 없다.
// 머리 줄과 옆 머리(첫 칸)의 글은 머리 스타일. 그림이 든 줄은 "사진 칸"(선 없음, 아래 맞춤)이고 그림은 칸 글 속에 놓는다(한 칸에 여럿도)
function table(doc, at, T, tone) {
  var R = T.rows.length, C = T.rows[0].length, head = Math.min(T.head, R - 1), g = L.grid;
  var tb = at.tables.add({ headerRowCount: head, bodyRowCount: R - head, columnCount: C });
  tb.appliedTableStyle = tableStyle(doc);
  tb.clearTableStyleOverrides(true);
  for (var c = 0; c < C; c++) tb.columns[c].width = T.widths[c];
  // 병합: 뒤에서부터. 머리와 몸을 가로지르는 병합은 InDesign이 받지 않는다(빈 칸이라 그대로 둔다)
  var merge = T.merge || [];
  for (var i = merge.length - 1; i >= 0; i--) {
    var m = merge[i];
    try { tb.cells.itemByName(m[1] + ":" + m[0]).merge(tb.cells.itemByName((m[1] + m[3] - 1) + ":" + (m[0] + m[2] - 1))); } catch (e) {}
  }
  var pics = {}, picRows = {};
  for (var i = 0; i < (T.pics || []).length; i++) { var p = T.pics[i]; (pics[p[0] + "," + p[1]] = pics[p[0] + "," + p[1]] || []).push(p[2]); picRows[p[0]] = 1; }
  // 몸 칸에서 그림 줄 바로 아래 줄은 그 그림의 이름 줄이다(한 표에 제품 묶음이 둘일 때). 머리 줄처럼 짠다
  var color = paint(doc, tone, "글자"), photo = doc.cellStyles.itemByName("사진 칸"), named = doc.cellStyles.itemByName("머리 칸");
  for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) {
    var cell = tb.cells.itemByName(c + ":" + r), name = r >= head && picRows[r - 1] && !picRows[r];
    if (!cell.isValid) continue;   // 병합으로 사라진 칸
    if (picRows[r]) cell.appliedCellStyle = photo;
    else if (name) cell.appliedCellStyle = named;
    if (T.rows[r][c]) {
      cell.contents = T.rows[r][c];   // 칸 속 줄바꿈은 강제 줄바꿈(\n)이라 한 문단으로 남아 제 행간을 쓴다
      cell.texts[0].appliedParagraphStyle = doc.paragraphStyles.itemByName(r < head || picRows[r] || name || (T.stub && c == 0) ? T.headCell : T.cell);
      if (color) cell.texts[0].appliedCharacterStyle = color;
    }
    var files = pics[r + "," + c];
    if (!files) continue;
    // 그림: 칸 폭(병합이면 합친 폭)을 그림 수로 나누고, 높이는 필드 하나 안에서 비율대로
    var w = (cell.width - g.gutter - (files.length - 1) * g.gutter) / files.length;
    if (T.rows[r][c]) cell.insertionPoints[-1].contents = "\r";
    cell.insertionPoints[-1].appliedParagraphStyle = imageStyle(doc);   // 빈 칸에는 아직 문단이 없다
    for (var f = 0; f < files.length; f++) {
      if (f) cell.insertionPoints[-1].contents = " ";
      // 넘친 글 속의 틀은 크기를 받지 않는다. 흐르는 상자를 다 이은 뒤에 그림을 넣는다(pictures)
      PICS.push({ rect: cell.insertionPoints[-1].rectangles.add(), file: files[f], w: w, h: g.rowH });
    }
  }
}
// 칸 속 그림: 틀을 칸 폭과 필드 높이로 잡고 그림을 비율대로 맞춘 뒤 틀을 그림에 붙인다.
// 아직 넘친 글 속에 있는 틀은 크기를 받지 않아 남겨 두고, 흐르는 글이 쪽을 더할 때마다 다시 부른다(measureFlows)
function pictures(doc) {
  var left = [];
  for (var i = 0; i < PICS.length; i++) {
    var p = PICS[i], b = safe(function () { return p.rect.geometricBounds; });
    if (!b) { left.push(p); continue; }
    try {
      p.rect.geometricBounds = [b[0], b[1], b[0] + p.h, b[1] + p.w];
      p.rect.place(File(p.file)); p.rect.fit(FitOptions.PROPORTIONALLY); p.rect.fit(FitOptions.FRAME_TO_CONTENT);
      p.rect.properties = { strokeWeight: 0, strokeColor: swatch(doc, "None") };   // 기본 그래픽 프레임의 선을 뺀다
    } catch (e) { WARN.push("표 그림: " + p.file + " " + e.message); }
  }
  PICS = left;
  doc.recompose();
}
function tableStyle(doc) {
  var ts = doc.tableStyles.itemByName("표");
  if (ts.isValid) return ts;
  var T = L.table, ink = swatch(doc, L.tones.light.글자), g = L.grid;
  // 아래 여백: 가는 선이 위 글의 기준선과 아래 글의 대문자 윗선 사이 가운데쯤 오게(기준선 한 칸의 1/4쯤)
  // 칸 위아래 여백은 테마 table.pad(기준선 몇 줄, 기본 0)만큼 더한다
  var pad = (T.pad || 0) * g.baseline;
  var edges = { topEdgeStrokeWeight: 0, leftEdgeStrokeWeight: 0, rightEdgeStrokeWeight: 0, topInset: pad, leftInset: 0, rightInset: g.gutter, bottomInset: g.baseline * 0.27 + pad };
  var body = doc.cellStyles.add(extend({ name: "칸", bottomEdgeStrokeWeight: T.rule + "pt", bottomEdgeStrokeColor: ink }, edges));
  var head = doc.cellStyles.add({ name: "머리 칸", basedOn: body, bottomEdgeStrokeWeight: T.strong + "pt" });
  // 사진 칸: 첫 기준선을 행간(그림 높이)으로 잡아야 그림이 칸 위로 솟지 않는다
  doc.cellStyles.add({ name: "사진 칸", basedOn: body, bottomEdgeStrokeWeight: 0, verticalJustification: VerticalJustification.BOTTOM_ALIGN,
    bottomInset: g.baseline / 2, firstBaselineOffset: FirstBaseline.LEADING_OFFSET });
  return doc.tableStyles.add({ name: "표", headerRegionCellStyle: head, bodyRegionCellStyle: body,
    topBorderStrokeWeight: T.strong + "pt", topBorderStrokeColor: ink, bottomBorderStrokeWeight: T.strong + "pt", bottomBorderStrokeColor: ink,
    leftBorderStrokeWeight: 0, rightBorderStrokeWeight: 0, spaceBefore: g.baseline / 2, spaceAfter: 0 });   // 앞 글의 간격이 없을 때(소제목 바로 뒤) 그림이 글에 닿지 않게
}
// 칸 속 그림의 문단: 기준선에 붙이지 않고 행간은 그림 높이 그대로
function imageStyle(doc) {
  var ps = doc.paragraphStyles.itemByName("Image");
  return ps.isValid ? ps : doc.paragraphStyles.add({ name: "Image", leading: Leading.AUTO, autoLeading: 100,
    alignToBaseline: false, gridAlignment: GridAlignment.NONE, spaceAfter: 0, spaceBefore: 0 });
}
