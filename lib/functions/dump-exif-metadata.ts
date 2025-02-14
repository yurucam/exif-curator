import { dump, load } from "piexifjs";

export async function dumpExifMetadata(dataUrl: string): Promise<string> {
  return dump(load(dataUrl));
}
