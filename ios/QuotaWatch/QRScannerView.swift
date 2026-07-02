import SwiftUI
import VisionKit
import Vision
import AVFoundation

/// Full-screen QR pairing scanner. Uses VisionKit's DataScannerViewController
/// (the modern, live-camera scanner). Calls `onScan` with the first parseable
/// `qw://pair` payload, then dismisses. Falls back to a guidance screen when
/// scanning isn't available (Simulator, no camera, or permission denied) so the
/// user can still pair manually.
struct QRScannerView: View {
    let onScan: (PairingPayload) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    DataScannerRepresentable { payload in
                        onScan(payload)
                        dismiss()
                    }
                    .ignoresSafeArea()
                    .overlay(alignment: .bottom) {
                        Text("将二维码对准取景框")
                            .font(.footnote)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(.ultraThinMaterial, in: Capsule())
                            .padding(.bottom, 40)
                    }
                } else {
                    ScannerUnavailableView()
                }
            }
            .navigationTitle("扫码配对")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("取消") { dismiss() }
                }
            }
        }
    }
}

/// UIViewControllerRepresentable wrapper around DataScannerViewController.
private struct DataScannerRepresentable: UIViewControllerRepresentable {
    let onPayload: (PairingPayload) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        try? scanner.startScanning()
    }

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onPayload: onPayload)
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let onPayload: (PairingPayload) -> Void
        private var handled = false

        init(onPayload: @escaping (PairingPayload) -> Void) {
            self.onPayload = onPayload
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            handle(addedItems)
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didTapOn item: RecognizedItem
        ) {
            handle([item])
        }

        private func handle(_ items: [RecognizedItem]) {
            guard !handled else { return }
            for item in items {
                if case let .barcode(barcode) = item,
                   let string = barcode.payloadStringValue,
                   let payload = PairingPayload(scanned: string) {
                    handled = true
                    onPayload(payload)
                    return
                }
            }
        }
    }
}

private struct ScannerUnavailableView: View {
    var body: some View {
        ContentUnavailableView {
            Label("无法使用扫码", systemImage: "camera.metering.unknown")
        } description: {
            Text("此设备不支持相机扫码（如模拟器），或未授予相机权限。\n请返回手动填写主机 / 端口 / Token。")
        }
    }
}
