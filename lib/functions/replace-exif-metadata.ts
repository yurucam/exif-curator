export async function replaceExifMetadata(
  imageData: Uint8Array<ArrayBufferLike>,
  dumpedExifMetadata: string
): Promise<ArrayBuffer> {
  return (
    (await replaceExifInWebp(imageData, dumpedExifMetadata)) ??
    (await replaceExifInJpeg(imageData, dumpedExifMetadata))
  );
}

async function replaceExifInWebp(
  imageData: Uint8Array<ArrayBufferLike>,
  dumpedExifMetadata: string
): Promise<ArrayBuffer | undefined> {
  const webpArrayBuffer = imageData.buffer.slice(
    imageData.byteOffset,
    imageData.byteOffset + imageData.byteLength
  );
  const exifArrayBuffer = binaryStringToArrayBuffer(dumpedExifMetadata);

  const dataView = new DataView(webpArrayBuffer);
  // RIFF 헤더 검사 ("RIFF" + 파일 크기 + "WEBP")
  if (
    getString(dataView, 0, 4) !== "RIFF" ||
    getString(dataView, 8, 4) !== "WEBP"
  ) {
    return;
  }

  // VP8X 청크 존재 여부 체크
  const vp8xOffset = findChunk(webpArrayBuffer, "VP8X");
  let newBuffer;
  if (vp8xOffset !== null) {
    // --- VP8X 청크가 이미 있는 경우 ---
    // VP8X 청크의 전체 크기 계산
    const vp8xSize = dataView.getUint32(vp8xOffset + 4, true);
    const vp8xTotalSize = 8 + vp8xSize + (vp8xSize % 2);
    const insertionPoint = vp8xOffset + vp8xTotalSize;
    const exifChunk = createEXIFChunk(exifArrayBuffer);

    const before = new Uint8Array(webpArrayBuffer.slice(0, insertionPoint));
    const after = new Uint8Array(webpArrayBuffer.slice(insertionPoint));
    const combined = new Uint8Array(
      webpArrayBuffer.byteLength + exifChunk.byteLength
    );
    combined.set(before, 0);
    combined.set(exifChunk, before.length);
    combined.set(after, before.length + exifChunk.byteLength);
    // RIFF 헤더 파일 크기 업데이트: (전체 파일 크기 - 8)
    new DataView(combined.buffer).setUint32(4, combined.byteLength - 8, true);
    newBuffer = combined.buffer;
  } else {
    // --- VP8X 청크가 없는 경우 (기본 WebP) ---
    // 원래 파일의 나머지 청크들을 살펴 ALPH나 XMP 청크가 있는지 체크
    const alphOffset = findChunk(webpArrayBuffer, "ALPH");
    const xmpOffset = findChunk(webpArrayBuffer, "XMP ");
    let flags = 0;
    flags |= 0x08; // EXIF 플래그 (bit 3) 항상 설정
    if (xmpOffset !== null) flags |= 0x04; // XMP 플래그
    if (alphOffset !== null) flags |= 0x10; // ALPH 플래그

    // 이미지 크기를 얻기 위해 Blob과 Image를 사용 (비동기)
    const webpBlob = new Blob([webpArrayBuffer], { type: "image/webp" });
    const dimensions = await getWebPDimensions(webpBlob);

    // 새 VP8X 청크 생성
    const vp8xChunk = createVP8XChunk(
      dimensions.width,
      dimensions.height,
      flags
    );
    // EXIF 청크 생성
    const exifChunk = createEXIFChunk(exifArrayBuffer);
    // 새로운 파일 구성: RIFF 헤더(12바이트) + VP8X 청크 + EXIF 청크 + 나머지 원본 데이터 (offset 12 이후)
    const header = new Uint8Array(webpArrayBuffer.slice(0, 12));
    const rest = new Uint8Array(webpArrayBuffer.slice(12));
    const totalLength =
      header.byteLength +
      vp8xChunk.byteLength +
      exifChunk.byteLength +
      rest.byteLength;
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    combined.set(header, offset);
    offset += header.byteLength;
    combined.set(vp8xChunk, offset);
    offset += vp8xChunk.byteLength;
    combined.set(exifChunk, offset);
    offset += exifChunk.byteLength;
    combined.set(rest, offset);
    // RIFF 헤더의 파일 크기 갱신 (전체 크기 - 8)
    new DataView(combined.buffer).setUint32(4, combined.byteLength - 8, true);
    newBuffer = combined.buffer;
  }
  return newBuffer;
}

// DataView에서 문자열 읽기
function getString(dataView: any, offset: any, length: any) {
  let str = "";
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(dataView.getUint8(offset + i));
  }
  return str;
}

// Uint8Array에 문자열 쓰기
function writeString(uint8Array: any, offset: any, str: any) {
  for (let i = 0; i < str.length; i++) {
    uint8Array[offset + i] = str.charCodeAt(i);
  }
}

// 바이너리 문자열을 ArrayBuffer로 변환
function binaryStringToArrayBuffer(binary: string) {
  const len = binary.length;
  const buffer = new ArrayBuffer(len);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < len; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return buffer;
}

// 지정한 타입의 청크를 찾아서 해당 청크의 시작 offset을 반환 (없으면 null)
function findChunk(arrayBuffer: ArrayBuffer, chunkType: string) {
  const dataView = new DataView(arrayBuffer);
  let offset = 12; // RIFF 헤더(12바이트) 이후부터 시작
  while (offset < arrayBuffer.byteLength) {
    const type = getString(dataView, offset, 4);
    const size = dataView.getUint32(offset + 4, true);
    if (type === chunkType) {
      return offset;
    }
    // 각 청크: 8바이트(타입+크기) + 데이터 크기; 데이터 크기가 홀수면 1바이트 패딩
    offset += 8 + size + (size % 2);
  }
  return null;
}

// WebP Blob로부터 이미지 크기를 가져옵니다.
function getWebPDimensions(blob: Blob): any {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = function () {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = function (e) {
      reject(e);
    };
    img.src = URL.createObjectURL(blob);
  });
}

// VP8X 청크 생성 (payload는 10바이트: flags, 3바이트 예약, 3바이트 (width-1), 3바이트 (height-1))
function createVP8XChunk(width: number, height: number, flags: number) {
  const payload = new Uint8Array(10);
  payload[0] = flags; // 플래그 (EXIF: 0x08, XMP: 0x04, ALPH: 0x10)
  payload[1] = 0;
  payload[2] = 0;
  payload[3] = 0;
  // canvas width - 1를 24비트 리틀 엔디안으로 기록
  const w = width - 1;
  payload[4] = w & 0xff;
  payload[5] = (w >> 8) & 0xff;
  payload[6] = (w >> 16) & 0xff;
  // canvas height - 1를 24비트 리틀 엔디안으로 기록
  const h = height - 1;
  payload[7] = h & 0xff;
  payload[8] = (h >> 8) & 0xff;
  payload[9] = (h >> 16) & 0xff;

  // 전체 VP8X 청크: 4바이트 타입("VP8X") + 4바이트 크기(10) + 10바이트 payload
  const chunk = new Uint8Array(4 + 4 + 10);
  writeString(chunk, 0, "VP8X");
  new DataView(chunk.buffer).setUint32(4, 10, true);
  chunk.set(payload, 8);
  return chunk;
}

// EXIF 청크 생성
function createEXIFChunk(exifArrayBuffer: ArrayBuffer) {
  const exifDataSize = exifArrayBuffer.byteLength;
  const padding = exifDataSize % 2 === 1 ? 1 : 0;
  const totalSize = 8 + exifDataSize + padding;
  const chunk = new Uint8Array(totalSize);
  writeString(chunk, 0, "EXIF");
  new DataView(chunk.buffer).setUint32(4, exifDataSize, true);
  chunk.set(new Uint8Array(exifArrayBuffer), 8);
  // 패딩(필요시 0으로 채워짐)
  return chunk;
}

async function replaceExifInJpeg(
  imageData: Uint8Array<ArrayBufferLike>,
  dumpedExifMetadata: string
) {
  const data = new Uint8Array(imageData);

  // 1. SOI (Start Of Image) 체크 (0xFFD8)
  if (data[0] !== 0xff || data[1] !== 0xd8) {
    throw new Error("유효한 JPEG 파일이 아닙니다.");
  }

  // 2. 삽입 위치 결정: 보통 SOI(0~1) 이후, APP0(JFIF) 세그먼트가 있다면 그 뒤
  const offset = 2; // SOI 뒤부터 시작
  let insertionIndex = offset;
  if (data[offset] === 0xff && data[offset + 1] === 0xe0) {
    // APP0 세그먼트 길이 (2바이트: length 포함)
    const app0Length = (data[offset + 2] << 8) | data[offset + 3];
    insertionIndex = offset + 2 + app0Length;
  }

  // 3. 기존의 APP1 (EXIF) 세그먼트 제거 후 나머지 세그먼트 수집
  const header = data.slice(0, insertionIndex);
  const tailSegments = [];
  let pos = insertionIndex;
  while (pos < data.length) {
    // 각 세그먼트는 0xFF로 시작해야 함
    if (data[pos] !== 0xff) {
      // 이상한 데이터가 나오면 나머지를 그대로 복사하고 종료
      tailSegments.push(data.slice(pos));
      break;
    }

    const marker = data[pos + 1];
    // SOS (Start Of Scan) 마커(0xDA)를 만나면 이미지 데이터부터 끝까지 그대로 복사
    if (marker === 0xda) {
      tailSegments.push(data.slice(pos));
      break;
    }

    // 일반 세그먼트는 길이 필드(2바이트)가 있음
    const segLength = (data[pos + 2] << 8) | data[pos + 3];
    // 만약 APP1 (0xE1) 세그먼트라면 EXIF 헤더("Exif\0\0")가 있는지 확인
    if (marker === 0xe1) {
      if (
        data[pos + 4] === 0x45 && // 'E'
        data[pos + 5] === 0x78 && // 'x'
        data[pos + 6] === 0x69 && // 'i'
        data[pos + 7] === 0x66 && // 'f'
        data[pos + 8] === 0x00 &&
        data[pos + 9] === 0x00
      ) {
        // 기존 EXIF 세그먼트이므로 건너뛰기
        pos += 2 + segLength;
        continue;
      }
    }
    // 그 외의 세그먼트는 그대로 보존
    tailSegments.push(data.slice(pos, pos + 2 + segLength));
    pos += 2 + segLength;
  }

  // 4. 새 EXIF 세그먼트 생성
  // dumpedExifMetadata는 각 문자 코드가 한 바이트인 "바이너리 문자열"이어야 합니다.
  const exifBytes = new Uint8Array(dumpedExifMetadata.length);
  for (let i = 0; i < dumpedExifMetadata.length; i++) {
    exifBytes[i] = dumpedExifMetadata.charCodeAt(i);
  }
  // APP1 세그먼트 구조: [0xFF, 0xE1] + [길이(2바이트)] + exifBytes
  // 길이 필드는 exifBytes 길이 + 2 (자기 자신을 포함)
  const exifSegmentLength = exifBytes.length + 2;
  const exifSegment = new Uint8Array(2 + 2 + exifBytes.length);
  exifSegment[0] = 0xff;
  exifSegment[1] = 0xe1;
  exifSegment[2] = (exifSegmentLength >> 8) & 0xff;
  exifSegment[3] = exifSegmentLength & 0xff;
  exifSegment.set(exifBytes, 4);

  // 5. 새 JPEG 파일 데이터 생성: header + 새 EXIF 세그먼트 + tail 세그먼트들을 이어붙임
  let totalLength = header.length + exifSegment.length;
  for (const seg of tailSegments) {
    totalLength += seg.length;
  }
  const result = new Uint8Array(totalLength);
  let offsetResult = 0;
  result.set(header, offsetResult);
  offsetResult += header.length;
  result.set(exifSegment, offsetResult);
  offsetResult += exifSegment.length;
  for (const seg of tailSegments) {
    result.set(seg, offsetResult);
    offsetResult += seg.length;
  }

  return result.buffer;
}
