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

                Text("iPhone 上点「配对设备」扫码，或手动输入：")
                    .font(.caption).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                VStack(spacing: 3) {
                    labelRow("地址", "\(model.host):\(model.port)")
                    labelRow("配对码", model.code ?? "")
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
}
