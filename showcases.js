const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function createShowcaseService({
  send, readJson, rateLimited, isAdmin,
}) {
  const DATA_DIR = path.join(__dirname, 'data');
  const SHOWCASES_FILE = path.join(DATA_DIR, 'showcases.json');
  const UPLOAD_DIR = path.join(DATA_DIR, 'showcases');

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const DEFAULT_SHOWCASES = [
    {
      id: 'showcase-a1',
      title: 'Auto-Publishing không bị chặn cache Facebook cho dân Marketing',
      course: 'mkt',
      category: 'AI Marketing · Đồ án tốt nghiệp',
      badge: 'Live Demo',
      description: 'Tự động lấy dữ liệu từ CSV, chạy quy trình đăng bài lên Fanpage & Instagram đúng khung giờ mỗi ngày mà không tốn token AI.',
      studentName: 'Phương Thanh',
      studentRole: 'Khoá MKT_001',
      mediaType: 'video',
      videoFile: null,
      videoStaticSrc: 'assets/videos/A1.mp4',
      videoWebmSrc: 'assets/videos/A1_web.mp4',
      posterFile: null,
      posterStaticSrc: 'assets/images/A1_frame.jpg',
      imageFile: null,
      imageStaticSrc: null,
      avatarFile: null,
      avatarDraft: 'PT',
      avatarColor: 'orange',
      videoKey: 'a1',
      createdAt: '2026-04-01T08:00:00.000Z',
      updatedAt: '2026-04-01T08:00:00.000Z',
    },
    {
      id: 'showcase-q1',
      title: 'Video Motion Graphic dài không tốn token qua Remotion Skills',
      course: 'mkt',
      category: 'AI Marketing · Đồ án tốt nghiệp',
      badge: 'Live Demo',
      description: 'Xây dựng nhận diện Branding Gemini Spark, kịch bản rõ ràng và quảng cáo công năng sản phẩm, kết hợp AI Agent để tối ưu branding.',
      studentName: 'Lương Thị Thủy Tiên',
      studentRole: 'Khoá MKT_001',
      mediaType: 'video',
      videoFile: null,
      videoStaticSrc: 'assets/videos/Q1.mp4',
      videoWebmSrc: 'assets/videos/Q1_web.mp4',
      posterFile: null,
      posterStaticSrc: 'assets/images/Q1_poster.jpg',
      imageFile: null,
      imageStaticSrc: null,
      avatarFile: null,
      avatarDraft: 'TT',
      avatarColor: 'teal',
      videoKey: 'q1',
      createdAt: '2026-04-02T09:00:00.000Z',
      updatedAt: '2026-04-02T09:00:00.000Z',
    },
    {
      id: 'showcase-ats',
      title: 'Hồ sơ tuyển dụng ATS & Mock Interview STAR',
      course: 'eng',
      category: 'English Track · Kết quả học viên',
      badge: 'Kết quả thật',
      description: 'CV tiếng Anh chuẩn ATS vượt vòng lọc hồ sơ tự động của MNC, cùng bộ câu trả lời phỏng vấn theo khung STAR có số liệu định lượng.',
      studentName: 'Phạm Đức Anh',
      studentRole: 'Khoá ENG_002',
      mediaType: 'image',
      videoFile: null,
      videoStaticSrc: null,
      videoWebmSrc: null,
      posterFile: null,
      posterStaticSrc: 'assets/images/project_ats_resume.png',
      imageFile: null,
      imageStaticSrc: 'assets/images/project_ats_resume.png',
      avatarFile: null,
      avatarDraft: 'ĐA',
      avatarColor: 'blue',
      videoKey: null,
      createdAt: '2026-04-03T10:00:00.000Z',
      updatedAt: '2026-04-03T10:00:00.000Z',
    },
  ];

  let showcases = [];
  function loadShowcases() {
    try {
      if (fs.existsSync(SHOWCASES_FILE)) {
        showcases = JSON.parse(fs.readFileSync(SHOWCASES_FILE, 'utf8'));
      } else {
        showcases = [...DEFAULT_SHOWCASES];
        fs.writeFileSync(SHOWCASES_FILE, JSON.stringify(showcases, null, 2), 'utf8');
      }
    } catch (e) {
      console.error('Không tải được showcases.json, dùng fallback mặc định:', e.message);
      showcases = [...DEFAULT_SHOWCASES];
    }
  }
  loadShowcases();

  function saveShowcases() {
    fs.writeFileSync(SHOWCASES_FILE, JSON.stringify(showcases, null, 2), 'utf8');
  }

  const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
  const fail = (status, error) => Object.assign(new Error(error), { status });
  const startsWith = (buf, sig) => buf.length >= sig.length && buf.slice(0, sig.length).equals(sig);

  const IMAGE_TYPES = {
    png: { mime: 'image/png', magic: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])] },
    jpg: { mime: 'image/jpeg', magic: [Buffer.from([0xff, 0xd8, 0xff])] },
    jpeg: { mime: 'image/jpeg', magic: [Buffer.from([0xff, 0xd8, 0xff])] },
    webp: {
      mime: 'image/webp',
      magic: [Buffer.from([0x52, 0x49, 0x46, 0x46])],
      extra: (b) => b.length >= 12 && b.slice(8, 12).equals(Buffer.from([0x57, 0x45, 0x42, 0x50])),
    },
  };

  const MEDIA_TYPES = {
    ...IMAGE_TYPES,
    mp4: {
      mime: 'video/mp4',
      magic: [],
      extra: (b) => b.length >= 8 && b.slice(4, 8).equals(Buffer.from([0x66, 0x74, 0x79, 0x70])),
    },
    webm: {
      mime: 'video/webm',
      magic: [Buffer.from([0x1a, 0x45, 0xdf, 0xa3])],
    },
  };

  function receiveFile(req, destPath, max, types, ext) {
    return new Promise((resolve, reject) => {
      const type = types[ext];
      if (!type) return reject(fail(400, 'Loại tệp không được hỗ trợ: ' + ext));
      const declared = Number(req.headers['content-length']);
      if (declared > max) return reject(fail(413, 'Tệp quá dung lượng cho phép'));
      const tmp = destPath + '.tmp';
      const out = fs.createWriteStream(tmp);
      let size = 0; let done = false;
      const abort = (err) => { if (done) return; done = true; out.destroy(); fs.unlink(tmp, () => {}); reject(err); };
      req.on('data', (c) => { size += c.length; if (size > max) abort(fail(413, 'Tệp quá dung lượng cho phép')); });
      req.on('error', abort);
      out.on('error', abort);
      out.on('finish', () => {
        if (done) return;
        done = true;
        try {
          const fd = fs.openSync(tmp, 'r');
          const head = Buffer.alloc(16);
          fs.readSync(fd, head, 0, 16, 0);
          fs.closeSync(fd);
          const hasMagic = Array.isArray(type.magic) && type.magic.length > 0;
          const magicMatch = hasMagic ? type.magic.some((m) => startsWith(head, m)) : true;
          const ok = size > 0 && magicMatch && (!type.extra || type.extra(head));
          if (!ok) {
            fs.unlinkSync(tmp);
            return reject(fail(400, 'Nội dung tệp không khớp với định dạng ' + ext));
          }
          fs.renameSync(tmp, destPath);
          resolve(size);
        } catch (e) { reject(e); }
      });
      req.pipe(out);
    });
  }

  function publicShowcase(s) {
    const avatarUrl = s.avatarFile ? `/api/showcases/${s.id}/avatar?v=${encodeURIComponent(s.updatedAt || s.createdAt)}` : null;
    const posterUrl = s.posterFile
      ? `/api/showcases/${s.id}/thumb?v=${encodeURIComponent(s.updatedAt || s.createdAt)}`
      : s.posterStaticSrc || s.imageStaticSrc || null;
    const mediaUrl = s.mediaFile
      ? `/api/showcases/${s.id}/media?v=${encodeURIComponent(s.updatedAt || s.createdAt)}`
      : s.mediaType === 'video' ? s.videoStaticSrc : s.imageStaticSrc;

    return {
      id: s.id,
      title: s.title,
      course: s.course,
      category: s.category || '',
      badge: s.badge || 'Live Demo',
      description: s.description || '',
      studentName: s.studentName,
      studentRole: s.studentRole || '',
      mediaType: s.mediaType || 'video',
      mediaUrl,
      videoStaticSrc: s.videoStaticSrc || null,
      videoWebmSrc: s.videoWebmSrc || null,
      posterUrl,
      avatarUrl,
      avatarDraft: s.avatarDraft || (s.studentName ? s.studentName.split(' ').map((p) => p[0]).slice(-2).join('').toUpperCase() : 'HV'),
      avatarColor: s.avatarColor || 'orange',
      videoKey: s.videoKey || s.id,
      createdAt: s.createdAt,
    };
  }

  function serveMediaWithRange(req, res, filePath, mimeType) {
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      return res.end('Tệp không tồn tại');
    }
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        return res.end();
      }

      const chunkSize = (end - start) + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  }

  return {
    async handle(req, res, pathname) {
      // 1. PUBLIC APIS
      if (pathname === '/api/showcases' && req.method === 'GET') {
        res.setHeader('Cache-Control', 'no-store');
        return send(res, 200, {
          showcases: showcases.map(publicShowcase),
        });
      }

      // Serve public media / avatar / thumb
      const mPub = pathname.match(/^\/api\/showcases\/([^/]+)\/(media|thumb|avatar)$/);
      if (mPub && (req.method === 'GET' || req.method === 'HEAD')) {
        const [, id, type] = mPub;
        const item = showcases.find((s) => s.id === id);
        if (!item) { res.writeHead(404); return res.end('Not found'); }

        if (type === 'avatar') {
          if (!item.avatarFile) { res.writeHead(404); return res.end(); }
          const fPath = path.join(UPLOAD_DIR, item.avatarFile);
          const ext = path.extname(fPath).slice(1).toLowerCase();
          return serveMediaWithRange(req, res, fPath, IMAGE_TYPES[ext]?.mime || 'image/jpeg');
        }

        if (type === 'thumb') {
          if (item.posterFile) {
            const fPath = path.join(UPLOAD_DIR, item.posterFile);
            const ext = path.extname(fPath).slice(1).toLowerCase();
            return serveMediaWithRange(req, res, fPath, IMAGE_TYPES[ext]?.mime || 'image/jpeg');
          }
          if (item.posterStaticSrc) {
            const fPath = path.join(__dirname, item.posterStaticSrc);
            const ext = path.extname(fPath).slice(1).toLowerCase();
            return serveMediaWithRange(req, res, fPath, IMAGE_TYPES[ext]?.mime || 'image/jpeg');
          }
          res.writeHead(404); return res.end();
        }

        if (type === 'media') {
          if (item.mediaFile) {
            const fPath = path.join(UPLOAD_DIR, item.mediaFile);
            const ext = path.extname(fPath).slice(1).toLowerCase();
            return serveMediaWithRange(req, res, fPath, MEDIA_TYPES[ext]?.mime || (item.mediaType === 'video' ? 'video/mp4' : 'image/jpeg'));
          }
          if (item.mediaType === 'video' && item.videoStaticSrc) {
            const fPath = path.join(__dirname, item.videoStaticSrc);
            return serveMediaWithRange(req, res, fPath, 'video/mp4');
          }
          if (item.imageStaticSrc) {
            const fPath = path.join(__dirname, item.imageStaticSrc);
            return serveMediaWithRange(req, res, fPath, 'image/jpeg');
          }
          res.writeHead(404); return res.end();
        }
      }

      // 2. ADMIN APIS
      if (pathname.startsWith('/api/admin/showcases')) {
        if (!isAdmin(req)) return send(res, 401, { error: 'Login required' });
        if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'erasight-admin') {
          return send(res, 403, { error: 'Bad request' });
        }

        const mAdm = pathname.match(/^\/api\/admin\/showcases(?:\/([^/]+)(?:\/(avatar|thumb|media))?)?$/);
        if (!mAdm) return send(res, 404, { error: 'Not found' });
        const [, id, sub] = mAdm;

        // GET all / POST new
        if (!id) {
          if (req.method === 'GET') {
            return send(res, 200, { showcases: showcases.map(publicShowcase) });
          }
          if (req.method === 'POST') {
            const b = await readJson(req);
            const title = cleanText(b.title, 150);
            const studentName = cleanText(b.studentName, 100);
            if (!title) throw fail(400, 'Vui lòng nhập tên đồ án');
            if (!studentName) throw fail(400, 'Vui lòng nhập tên học viên');

            const now = new Date().toISOString();
            const newId = 'shc_' + crypto.randomBytes(6).toString('hex');
            const item = {
              id: newId,
              title,
              course: cleanText(b.course, 30) || 'mkt',
              category: cleanText(b.category, 100) || (b.course === 'eng' ? 'English Track · Kết quả học viên' : 'AI Marketing · Đồ án tốt nghiệp'),
              badge: cleanText(b.badge, 50) || (b.mediaType === 'video' ? 'Live Demo' : 'Kết quả thật'),
              description: cleanText(b.description, 400),
              studentName,
              studentRole: cleanText(b.studentRole, 100) || (b.course === 'eng' ? 'Khoá ENG_002' : 'Khoá MKT_001'),
              mediaType: b.mediaType === 'image' ? 'image' : 'video',
              videoFile: null,
              videoStaticSrc: null,
              videoWebmSrc: null,
              posterFile: null,
              posterStaticSrc: null,
              imageFile: null,
              imageStaticSrc: null,
              avatarFile: null,
              avatarDraft: studentName.split(' ').map((p) => p[0]).slice(-2).join('').toUpperCase(),
              avatarColor: b.course === 'eng' ? 'blue' : 'orange',
              videoKey: newId,
              createdAt: now,
              updatedAt: now,
            };

            showcases.unshift(item);
            saveShowcases();
            return send(res, 201, { showcase: publicShowcase(item) });
          }
          return send(res, 405, { error: 'Method not allowed' });
        }

        const item = showcases.find((s) => s.id === id);
        if (!item) return send(res, 404, { error: 'Showcase not found' });

        // PUT file (avatar, thumb, media)
        if (sub && req.method === 'PUT') {
          const url = new URL(req.url, 'http://x');
          const ext = (url.searchParams.get('ext') || '').toLowerCase().replace(/^\./, '');
          if (!ext) throw fail(400, 'Thiếu đuôi tệp ?ext=');

          if (sub === 'avatar') {
            if (!IMAGE_TYPES[ext]) throw fail(400, 'Ảnh đại diện phải là PNG, JPG hoặc WebP');
            const filename = `${id}_avatar.${ext}`;
            const dest = path.join(UPLOAD_DIR, filename);
            await receiveFile(req, dest, 5 * 1024 * 1024, IMAGE_TYPES, ext);
            if (item.avatarFile && item.avatarFile !== filename) {
              fs.unlink(path.join(UPLOAD_DIR, item.avatarFile), () => {});
            }
            item.avatarFile = filename;
            item.updatedAt = new Date().toISOString();
            saveShowcases();
            return send(res, 200, { showcase: publicShowcase(item) });
          }

          if (sub === 'thumb') {
            if (!IMAGE_TYPES[ext]) throw fail(400, 'Ảnh bìa / Poster phải là PNG, JPG hoặc WebP');
            const filename = `${id}_thumb.${ext}`;
            const dest = path.join(UPLOAD_DIR, filename);
            await receiveFile(req, dest, 12 * 1024 * 1024, IMAGE_TYPES, ext);
            if (item.posterFile && item.posterFile !== filename) {
              fs.unlink(path.join(UPLOAD_DIR, item.posterFile), () => {});
            }
            item.posterFile = filename;
            item.updatedAt = new Date().toISOString();
            saveShowcases();
            return send(res, 200, { showcase: publicShowcase(item) });
          }

          if (sub === 'media') {
            if (!MEDIA_TYPES[ext]) throw fail(400, 'Tệp media phải là Video (mp4, webm) hoặc Ảnh (png, jpg, webp)');
            const filename = `${id}_media.${ext}`;
            const dest = path.join(UPLOAD_DIR, filename);
            await receiveFile(req, dest, 60 * 1024 * 1024, MEDIA_TYPES, ext);
            if (item.mediaFile && item.mediaFile !== filename) {
              fs.unlink(path.join(UPLOAD_DIR, item.mediaFile), () => {});
            }
            item.mediaFile = filename;
            item.mediaType = (ext === 'mp4' || ext === 'webm') ? 'video' : 'image';
            item.updatedAt = new Date().toISOString();
            saveShowcases();
            return send(res, 200, { showcase: publicShowcase(item) });
          }
        }

        // DELETE
        if (req.method === 'DELETE') {
          if (item.avatarFile) fs.unlink(path.join(UPLOAD_DIR, item.avatarFile), () => {});
          if (item.posterFile) fs.unlink(path.join(UPLOAD_DIR, item.posterFile), () => {});
          if (item.mediaFile) fs.unlink(path.join(UPLOAD_DIR, item.mediaFile), () => {});
          showcases = showcases.filter((s) => s.id !== id);
          saveShowcases();
          return send(res, 200, { ok: true });
        }

        return send(res, 405, { error: 'Method not allowed' });
      }

      return send(res, 404, { error: 'Not found' });
    },
  };
};
