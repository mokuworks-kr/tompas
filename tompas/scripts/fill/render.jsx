// fill(InDesign 쪽): 패스트 트랙의 채우기 층(D-47). 도식, 바탕 사진과 막, 아이콘 글리프의 문자 스타일.
// 엔진(render/)은 layout.json에 그 데이터가 있을 때만 이 함수들을 부른다

// 라벨 앞 아이콘 글자: 아이콘 서체와 라벨의 색(문자 스타일은 겹치지 않아 색도 함께 담는다)
function iconChar(doc, tone, role) {
  var name = "아이콘 글자" + (tone == "dark" ? " 어두운 쪽" : "") + (role == "글자" ? "" : " " + role), cs = doc.characterStyles.itemByName(name);
  return cs.isValid ? cs : doc.characterStyles.add({ name: name, appliedFont: L.icon.family, fontStyle: L.icon.weight,
    pointSize: L.icon.inline + "pt", fillColor: swatch(doc, L.tones[tone][role] || role) });
}

// 도식: InDesign 도형으로 그려 도식 레이어에 둔다(D-45). 색은 쪽 톤의 색 역할(글자·보조·강조·바탕)이나 색상 견본 이름이다.
// 글은 문서 단락 스타일을 바탕으로 한 "도식 …" 스타일(격자 정렬 없음). 그린 것은 items에 더해 picture가 자리 이름으로 묶는다
function drawing(doc, page, P, F, b, layers, items) {
  var ox = b[1], oy = b[0], ds = F.pic.draw;
  function col(c) { return swatch(doc, c ? (L.tones[P.tone][c] || c) : "None"); }
  function box(r) { return [oy + r[1], ox + r[0], oy + r[1] + r[3], ox + r[0] + r[2]]; }
  function stroke(o, d) { o.strokeColor = col(d.stroke); o.strokeWeight = d.stroke ? (d.weight || 0.5) + "pt" : 0; }
  for (var i = 0; i < ds.length; i++) {
    var d = ds[i], it = null;
    if (d.rect || d.oval) {
      it = (d.rect ? page.rectangles : page.ovals).add(layers.도식, undefined, undefined, { geometricBounds: box(d.rect || d.oval), fillColor: col(d.fill) });
      if (d.tint) it.fillTint = d.tint;
      if (d.opacity) it.transparencySettings.blendingSettings.opacity = d.opacity;
      stroke(it, d);
      if (d.round) it.properties = { topLeftCornerOption: CornerOptions.ROUNDED_CORNER, topRightCornerOption: CornerOptions.ROUNDED_CORNER,
        bottomLeftCornerOption: CornerOptions.ROUNDED_CORNER, bottomRightCornerOption: CornerOptions.ROUNDED_CORNER,
        topLeftCornerRadius: d.round, topRightCornerRadius: d.round, bottomLeftCornerRadius: d.round, bottomRightCornerRadius: d.round };
    } else if (d.line) {
      it = page.graphicLines.add(layers.도식);
      var pts = [];
      for (var k = 0; k < d.line.length; k++) pts.push([ox + d.line[k][0], oy + d.line[k][1]]);
      it.paths[0].entirePath = pts;
      stroke(it, { stroke: d.stroke || "글자", weight: d.weight });
      if (d.arrow == "end" || d.arrow == "both") it.rightLineEnd = ArrowHead.TRIANGLE_ARROW_HEAD;
      if (d.arrow == "start" || d.arrow == "both") it.leftLineEnd = ArrowHead.TRIANGLE_ARROW_HEAD;
    } else if (d.text !== undefined) {
      it = page.textFrames.add(layers.도식, undefined, undefined, { geometricBounds: box(d.at) });
      it.textFramePreferences.insetSpacing = [0, 0, 0, 0];
      // ExtendScript는 겹친 ?:를 잘못 읽어 괄호로 묶는다
      it.textFramePreferences.verticalJustification = d.valign == "center" ? VerticalJustification.CENTER_ALIGN
        : (d.valign == "bottom" ? VerticalJustification.BOTTOM_ALIGN : VerticalJustification.TOP_ALIGN);
      it.contents = d.text;
      it.parentStory.paragraphs.everyItem().appliedParagraphStyle = diagramStyle(doc, d.style, d.align);
      var c = paint(doc, P.tone, d.color || "글자");
      if (c) it.parentStory.texts[0].appliedCharacterStyle = c;
      if (it.overflows) WARN.push("도식 넘침: " + P.page + F.letter + " " + String(d.text).slice(0, 30));
    } else if (d.image) {
      it = page.rectangles.add(layers.도식, undefined, undefined, { geometricBounds: box(d.at), strokeWeight: 0 });
      place(it, d.image, d.fit);
    }
    if (it) items.push(it);
  }
}
function diagramStyle(doc, name, align) {
  var n = "도식 " + name + (align == "center" ? " 가운데" : (align == "right" ? " 오른쪽" : "")), s = doc.paragraphStyles.itemByName(n);
  if (s.isValid) return s;
  s = doc.paragraphStyles.add({ name: n, basedOn: doc.paragraphStyles.itemByName(name), spaceAfter: 0, spaceBefore: 0, keepWithNext: 0, hyphenation: false,
    justification: align == "center" ? Justification.CENTER_ALIGN : (align == "right" ? Justification.RIGHT_ALIGN : Justification.LEFT_ALIGN) });
  s.gridAlignment = GridAlignment.NONE;
  return s;
}

// 바탕 사진: 도련까지 채운 사진 위에 쪽 바탕색 막(veil). 막은 위에서 아래로 불투명도가 달라질 수 있다(D-46)
function backdrop(doc, page, P, F, b, layers) {
  var ph = page.rectangles.add(layers.바탕, undefined, undefined, { geometricBounds: b, strokeWeight: 0, name: P.page + " 바탕 사진" });
  place(ph, F.pic.file, "fill");
  var veil = page.rectangles.add(layers.바탕, undefined, undefined, { geometricBounds: b, fillColor: swatch(doc, L.tones[P.tone].바탕), strokeWeight: 0, name: P.page + " 바탕 막" });
  var v = F.pic.veil || [70, 70];
  veil.transparencySettings.blendingSettings.opacity = Math.max(v[0], v[1]);
  if (v[0] != v[1]) try {
    var gf = veil.transparencySettings.gradientFeatherSettings;
    gf.applied = true; gf.type = GradientType.LINEAR; gf.angle = v[0] < v[1] ? -90 : 90;
    gf.opacityGradientStops[0].opacity = Math.min(v[0], v[1]) / Math.max(v[0], v[1]) * 100; gf.opacityGradientStops[1].opacity = 100;
  } catch (e) { WARN.push("바탕 막: " + e.message); }
}
