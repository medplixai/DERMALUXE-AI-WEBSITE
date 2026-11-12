// Cuts a machine (or any object) out of a photograph with Apple's Vision
// framework, on this Mac — the mask comes from the photo itself; nothing is
// generated or redrawn, so the machine in the catalog is the machine in the
// room. Used for the doctors' catalog, 12 Nov 2026.
//   swiftc -O print/cutout.swift -o /tmp/cutout && /tmp/cutout in.jpg out.png
// Vision sometimes keeps a piece of wall or floor that touches the object;
// those were erased by hand on the mask (see print/make-doctor-catalog.js).
import Foundation
import Vision
import CoreImage
import CoreImage.CIFilterBuiltins
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 3 else { print("usage: cut in.jpg out.png"); exit(1) }
let url = URL(fileURLWithPath: args[1])
guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
      let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { print("cannot read"); exit(1) }
let req = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do { try handler.perform([req]) } catch { print("vision failed:", error); exit(1) }
guard let obs = req.results?.first else { print("no foreground found"); exit(2) }
print("instances:", obs.allInstances.count)
do {
  let buf = try obs.generateMaskedImage(ofInstances: obs.allInstances, from: handler, croppedToInstancesExtent: true)
  let ci = CIImage(cvPixelBuffer: buf)
  let ctx = CIContext()
  guard let out = ctx.createCGImage(ci, from: ci.extent) else { print("render failed"); exit(1) }
  let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, out, nil); CGImageDestinationFinalize(dest)
  print("ok", out.width, out.height)
} catch { print("mask failed:", error); exit(1) }
