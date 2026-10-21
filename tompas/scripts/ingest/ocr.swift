// 그림 속 글을 맥 Vision으로 읽는다. 깨진 기호를 풀 때만 쓴다(decode.ts).
//   tompas-ocr <그림>...   그림마다 한 줄: {"file": …, "lines": […]}
import Vision
import AppKit
import Foundation

for path in CommandLine.arguments.dropFirst() {
  var lines: [String] = []
  if let img = NSImage(contentsOf: URL(fileURLWithPath: path)) {
    var rect = CGRect(origin: .zero, size: img.size)
    if let cg = img.cgImage(forProposedRect: &rect, context: nil, hints: nil) {
      let req = VNRecognizeTextRequest { r, _ in
        for o in (r.results as? [VNRecognizedTextObservation]) ?? [] { if let t = o.topCandidates(1).first { lines.append(t.string) } }
      }
      req.recognitionLanguages = ["ko-KR", "en-US"]
      req.recognitionLevel = .accurate
      req.usesLanguageCorrection = false
      try? VNImageRequestHandler(cgImage: cg).perform([req])
    }
  }
  let out = try! JSONSerialization.data(withJSONObject: ["file": path, "lines": lines])
  print(String(data: out, encoding: .utf8)!)
}
