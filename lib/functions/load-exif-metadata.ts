import { load, Tags } from "exifreader";

export async function loadExifMetadata(dataUrl: string): Promise<Tags> {
  return load(dataUrl);
}
