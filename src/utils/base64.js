/**
 * @fileoverview Binary <-> text conversion for saving typed arrays in JSON.
 *
 * JSON has no binary type. `JSON.stringify(new Uint8Array([1, 2]))` gives
 * `{"0":1,"1":2}` — about 8 characters per byte! Base64 packs 3 bytes into
 * 4 printable characters (~1.33 chars per byte), so a 100x100 grid layer
 * (10 000 bytes) becomes ~13 KB of text instead of ~80 KB.
 *
 * C++ analogy: like writing a `std::vector<uint8_t>` into a text file with
 * a base64 encoder instead of printing each number separately.
 *
 * @module utils/base64
 */

/**
 * Size of the slices passed to String.fromCharCode. Passing a whole large
 * array as arguments (`fromCharCode(...bytes)`) puts every byte on the call
 * stack and throws "Maximum call stack size exceeded" for big arrays.
 * @type {number}
 */
const CHUNK = 0x8000;

/**
 * Encodes bytes as a base64 string.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Decodes a base64 string into bytes.
 * Throws (DOMException) if the string is not valid base64.
 *
 * @param {string} text
 * @returns {Uint8Array}
 */
export function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
