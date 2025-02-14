# exif-curator

💾 Preserve and read original image EXIF metadata.

Install:

```sh
npm i exif-curator
```

Usage:

```typescript
const jpegFile = (document.getElementById('jpegInput')! as HTMLInputElement).files![0];

const jpegDataUrl: string = await new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => resolve(e.target!.result as string);
  reader.onerror = reject;
  reader.readAsDataURL(jpegFile);
});

const dumpedExifMetadata = await dumpExifMetadata(jpegDataUrl);

console.log(await loadExifMetadata(jpegDataUrl));

// generate image by svg-wasm

await replaceExifMetadata(imageData, dumpedExifMetadata)
```
