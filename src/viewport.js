// SPDX-License-Identifier: Apache-2.0
// Modified for SwiftBrowse; includes BareBrowse code. Attribution and changes: NOTICE.
/** Accept the CLI's WIDTHxHEIGHT and the library's documented object form. */
/** @param {string|{width:number,height:number}|undefined} value */
export function parseViewport(value) {
  if (value === undefined) return undefined;
  let width = 0, height = 0;
  if (typeof value === 'string' && /^\d+x\d+$/.test(value)) {
    [width, height] = value.split('x').map(Number);
  } else if (value && typeof value === 'object') {
    ({ width, height } = value);
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384) {
    throw new Error('viewport must be WIDTHxHEIGHT or {width, height}, with dimensions from 1 to 16384');
  }
  return { width, height };
}
