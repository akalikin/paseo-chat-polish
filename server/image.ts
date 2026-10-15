import type { RpcInput } from "@getpaseo/plugin";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { readImage } from "../shared/image";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const MAX_BYTES = 12 * 1024 * 1024;

// Only image files are served: this RPC must not become a general file reader for the client.
export async function readImageFile({ path }: RpcInput<typeof readImage>) {
  const file = path.startsWith("file://") ? fileURLToPath(path) : path;
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) throw new Error(`Not an image: ${file}`);
  if ((await stat(file)).size > MAX_BYTES) throw new Error(`Image larger than ${MAX_BYTES / 1024 / 1024} MB: ${file}`);
  return { dataUrl: `data:${mime};base64,${(await readFile(file)).toString("base64")}` };
}
