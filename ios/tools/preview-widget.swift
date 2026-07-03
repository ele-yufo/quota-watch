// preview-widget.swift — offline widget layout check.
//
// Renders the real widget SwiftUI views (OverviewWidgetView / SmallWidgetView)
// off-screen at the exact widget point sizes, WITH the real brand fonts
// registered, and draws a red border at the widget bounds. This catches
// clipping/overflow that only appears with the real (taller-than-system) fonts —
// something a screenshot on device would otherwise be the only way to see.
//
// Run via ios/tools/preview-widgets.sh; outputs PNGs to /tmp and opens them.
// This is the mandatory pre-ship check for any widget layout change.
import SwiftUI
import WidgetKit
import AppKit
import CoreText

@main
struct PreviewWidget {
    @MainActor
    static func main() {
        registerFonts()
        let entry = QuotaEntry(
            date: Date(), providers: DemoData.providers(),
            selectedProviderId: nil, lastUpdated: Date(), isStale: false, page: 0)

        // Smallest iPhone medium (329×155) — if it fits here with real fonts it
        // fits on bigger phones. (widgetFamily can't be forced off-device, so
        // the overview renders its default/medium page size.)
        render(OverviewWidgetView(entry: entry), CGSize(width: 329, height: 155), "/tmp/qw-widget-medium.png")
        render(SmallWidgetView(entry: entry), CGSize(width: 158, height: 158), "/tmp/qw-widget-small.png")
    }

    /// Register the bundled brand fonts so the render matches on-device metrics.
    static func registerFonts() {
        let fontsDir = ProcessInfo.processInfo.environment["QW_FONTS_DIR"] ?? "QuotaWatch/Fonts"
        let fm = FileManager.default
        for file in (try? fm.contentsOfDirectory(atPath: fontsDir)) ?? [] where file.hasSuffix(".ttf") {
            CTFontManagerRegisterFontsForURL(
                URL(fileURLWithPath: "\(fontsDir)/\(file)") as CFURL, .process, nil)
        }
    }

    @MainActor
    static func render<V: View>(_ view: V, _ size: CGSize, _ path: String) {
        let bounded = view
            .frame(width: size.width, height: size.height)
            .background(Color.black)
            .overlay(Rectangle().strokeBorder(.red, lineWidth: 2)) // exact widget bounds
        let renderer = ImageRenderer(content: bounded)
        renderer.scale = 2
        guard let img = renderer.nsImage, let tiff = img.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
            print("✗ render failed: \(path)"); return
        }
        try? png.write(to: URL(fileURLWithPath: path))
        print("✓ \(path)")
    }
}
