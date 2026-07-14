function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('El archivo es muy pesado.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function splitBuffer(buffer, separator) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(separator, start);
  while (index !== -1) {
    parts.push(buffer.slice(start, index));
    start = index + separator.length;
    index = buffer.indexOf(separator, start);
  }
  parts.push(buffer.slice(start));
  return parts;
}

function parseMultipart(buffer, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(buffer, boundaryBuffer).slice(1, -1);
  const parsed = [];
  for (const rawPart of parts) {
    let part = rawPart;
    if (part.slice(0, 2).toString('latin1') === '\r\n') part = part.slice(2);
    if (part.slice(-2).toString('latin1') === '\r\n') part = part.slice(0, -2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;
    const rawHeaders = part.slice(0, headerEnd).toString('latin1');
    const content = part.slice(headerEnd + 4);
    const disposition = rawHeaders.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || '';
    const name = disposition.match(/name="([^"]+)"/i)?.[1] || '';
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1] || '';
    const contentType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() || '';
    parsed.push({ name, filename, contentType, content });
  }
  return parsed;
}

function extractBoundary(contentTypeHeader) {
  const match = String(contentTypeHeader || '').match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
  return match?.[1] || match?.[2] || '';
}

module.exports = { readRawBody, parseMultipart, extractBoundary };
