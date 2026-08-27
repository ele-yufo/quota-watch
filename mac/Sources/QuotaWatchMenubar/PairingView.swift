import SwiftUI

/// The pairing sheet shown from the menu bar: a scannable QR, the 6-digit code
/// for manual entry, and a countdown. Scanning fills host + code on the phone,
/// which exchanges the code for the token — the token is never shown.
struct PairingView: View {
    @ObservedObject var model: PairingModel
    var onClose: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Text("配对设备").font(.headline)
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }

            if let error = model.error {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.title2).foregroundStyle(.orange)
                    Text(error).font(.caption).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("重试") { model.start() }.controlSize(.small)
                }
                .padding(.vertical, 12)
            } else if let qr = model.qrImage {
                Image(nsImage: qr)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 176, height: 176)
                    .padding(8)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                Text(model.code ?? "")
                    .font(.system(size: 30, weight: .bold, design: .monospaced))
                    .kerning(6)
                    .foregroundStyle(.primary)

                Text("手机 App 里扫码，或手动输入：")
                    .font(.caption).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                VStack(spacing: 3) {
                    labelRow("地址", "\(model.host):\(model.port)")
                    labelRow("配对码", model.code ?? "")
                    if !model.caFingerprint.isEmpty {
                        HStack(alignment: .top) {
                            Text("指纹").font(.caption2).foregroundStyle(.secondary)
                            Spacer()
                            Text(grouped(model.caFingerprint))
                                .font(.system(size: 9, design: .monospaced))
                                .multilineTextAlignment(.trailing)
                                .textSelection(.enabled)
                            Button {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(model.caFingerprint, forType: .string)
                            } label: {
                                Image(systemName: "doc.on.doc").font(.caption2)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.secondary)
                            .help("复制指纹")
                        }
                    }
                }
                .padding(8)
                .frame(maxWidth: .infinity)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.gray.opacity(0.10)))

                HStack {
                    Image(systemName: "timer").font(.caption2)
                    Text(model.secondsLeft > 0 ? "\(model.secondsLeft)s 后过期" : "已过期，请重新生成")
                        .font(.caption2)
                    Spacer()
                    Button("重新生成") { model.start() }.controlSize(.small)
                }
                .foregroundStyle(model.secondsLeft > 0 ? Color.secondary : Color.red)
            } else {
                ProgressView().padding(.vertical, 40)
            }
        }
        .padding(18)
        .frame(width: 300)
    }

    private func labelRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.caption.monospaced())
        }
    }

    /// 64-hex fingerprint as two lines of 4×8 groups — typable, selectable.
    private func grouped(_ fp: String) -> String {
        let groups = stride(from: 0, to: fp.count, by: 8).map {
            String(fp.dropFirst($0).prefix(8))
        }
        return groups.chunked(into: 4).map { $0.joined(separator: " ") }
            .joined(separator: "\n")
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
