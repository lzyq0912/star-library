'use strict';

const { TextDecoder } = require('util');
const iconv = require('iconv-lite');

function responseHeaderValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '');
  const target = String(name || '').toLowerCase();
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === target);
  return key ? String(headers[key] || '') : '';
}

function normalizeTextEncoding(value) {
  const label = String(value || '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  if (!label) return '';
  if (['utf8', 'utf-8'].includes(label)) return 'utf-8';
  if (['utf16', 'utf-16', 'utf16le', 'utf-16le', 'ucs2', 'ucs-2'].includes(label)) return 'utf-16le';
  if (['utf16be', 'utf-16be'].includes(label)) return 'utf-16be';
  if (['iso-8859-1', 'iso8859-1', 'latin1', 'latin-1', 'cp1252', 'windows-1252'].includes(label)) {
    return 'windows-1252';
  }
  return label;
}

function supportedTextEncoding(value) {
  const encoding = normalizeTextEncoding(value);
  if (!encoding) return '';
  try {
    new TextDecoder(encoding);
    return encoding;
  } catch {
    return '';
  }
}

function declaredTextEncoding(buffer, headers) {
  const contentType = responseHeaderValue(headers, 'content-type');
  const headerMatch = /\bcharset\s*=\s*["']?\s*([^\s;"']+)/i.exec(contentType);
  const headerEncoding = headerMatch ? supportedTextEncoding(headerMatch[1]) : '';
  if (headerEncoding) return headerEncoding;

  // XML and HTML encoding declarations are ASCII-compatible, so a byte-preserving
  // Latin-1 scan can inspect them before the response itself has been decoded.
  const head = buffer.subarray(0, 8192).toString('latin1');
  const xmlMatch = /<\?xml\b[^>]{0,512}\bencoding\s*=\s*["']\s*([^\s"']+)/i.exec(head);
  const xmlEncoding = xmlMatch ? supportedTextEncoding(xmlMatch[1]) : '';
  if (xmlEncoding) return xmlEncoding;
  const metaTags = head.match(/<meta\b[^>]{0,1024}>/gi) || [];
  for (const tag of metaTags) {
    const metaMatch = /\bcharset\s*=\s*["']?\s*([^\s;"'/>]+)/i.exec(tag);
    const metaEncoding = metaMatch ? supportedTextEncoding(metaMatch[1]) : '';
    if (metaEncoding) return metaEncoding;
  }
  return '';
}

function decodeResponseBuffer(value, headers) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || '');
  if (!buffer.length) return '';

  let encoding = '';
  let offset = 0;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    encoding = 'utf-8';
    offset = 3;
  } else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    encoding = 'utf-16le';
    offset = 2;
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    encoding = 'utf-16be';
    offset = 2;
  }

  if (!encoding) encoding = declaredTextEncoding(buffer, headers);
  if (!encoding && buffer.length >= 4) {
    if (buffer[0] === 0x3c && buffer[1] === 0x00) encoding = 'utf-16le';
    else if (buffer[0] === 0x00 && buffer[1] === 0x3c) encoding = 'utf-16be';
  }
  if (!encoding) encoding = 'utf-8';

  try {
    if (encoding === 'windows-1252') return iconv.decode(buffer.subarray(offset), 'windows-1252');
    return new TextDecoder(encoding).decode(buffer.subarray(offset));
  } catch {
    return new TextDecoder('utf-8').decode(buffer.subarray(offset));
  }
}

module.exports = {
  responseHeaderValue,
  normalizeTextEncoding,
  supportedTextEncoding,
  declaredTextEncoding,
  decodeResponseBuffer,
};
