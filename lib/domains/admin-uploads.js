const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const uploadsLib = require('../uploads');
const { readRawBody, parseMultipart, extractBoundary } = require('../multipart');
const { json } = require('../helpers');
const { USE_SUPABASE, UPLOAD_DIR, MAX_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_BYTES } = require('../config');

const IMAGE_UPLOAD_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const VIDEO_UPLOAD_TYPES = { 'video/mp4': '.mp4', 'video/webm': '.webm' };

// Local-disk upload path, used only in demo/local mode (no Supabase
// configured). In multi-tenant mode, lib/uploads.js's Supabase Storage
// path is used instead — see below.
async function readUploadedImage(req) {
  const boundary = extractBoundary(req.headers['content-type']);
  if (!boundary) throw new Error('Solicitud de archivo inválida.');
  const buffer = await readRawBody(req, MAX_VIDEO_UPLOAD_BYTES);
  const parts = parseMultipart(buffer, boundary);
  const file = parts.find(p => p.name === 'image' && p.filename && p.content.length);
  if (!file) throw new Error('Selecciona un archivo para subir.');
  const imageExt = IMAGE_UPLOAD_TYPES[file.contentType];
  const videoExt = VIDEO_UPLOAD_TYPES[file.contentType];
  const ext = imageExt || videoExt;
  if (!ext) throw new Error('Formato no permitido. Usa JPG, PNG, WEBP, GIF, MP4 o WEBM.');
  const kind = videoExt ? 'video' : 'image';
  const maxBytes = kind === 'video' ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (file.content.length > maxBytes) {
    throw new Error(kind === 'video' ? 'El video es muy pesado. Máximo 25 MB.' : 'El archivo es muy pesado. Máximo 6 MB.');
  }
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, file.content);
  const url = `/uploads/${filename}`;
  return { imageUrl: url, url, kind, filename, sizeBytes: file.content.length, contentType: file.contentType };
}

async function handleAdminRoutes({ req, res, pathname, salon }) {
  if (req.method === 'POST' && pathname === '/api/admin/uploads') {
    const uploaded = USE_SUPABASE
      ? await uploadsLib.readUploadedMedia(req, salon.slug)
      : await readUploadedImage(req);
    json(res, 201, uploaded);
    return true;
  }
  return false;
}

module.exports = { handleAdminRoutes };
