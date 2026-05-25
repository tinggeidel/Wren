import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

// Normalize any captured/picked photo into a resized JPEG base64 the Claude
// vision API can actually read. iPhone photos are often HEIC (unsupported) and
// full-res ones are too big — both cause "could not process image" 400s. We
// downscale to ~1568px (Claude's recommended max long edge) and re-encode JPEG.
export async function toJpegBase64(uri: string): Promise<string> {
  const res = await manipulateAsync(uri, [{ resize: { width: 1568 } }], {
    compress: 0.7,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!res.base64) throw new Error("Couldn't prepare the image.");
  return res.base64;
}
