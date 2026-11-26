// Outgoing mail sent by this server itself. Zero dependencies.
//   - account mode (like the outreach app): log in to a Gmail / Outlook / custom SMTP account with an app password
//       465 = TLS from the start, 587 = STARTTLS; the password is only ever sent over an encrypted connection
//   - direct mode: delivers to each recipient's own mail server (MX lookup, port 25, STARTTLS when offered)
// Every message is DKIM-signed when a key is configured (DKIM_KEY_FILE + DKIM_SELECTOR for DKIM_DOMAIN).
'use strict';
const net = require('net');
const tls = require('tls');
const dns = require('dns').promises;
const crypto = require('crypto');

const CRLF = '\r\n';
const TIMEOUT_MS = 30_000;

const encodeHeader = (v) => (/^[\x20-\x7e]*$/.test(v) ? v : '=?UTF-8?B?' + Buffer.from(v, 'utf8').toString('base64') + '?=');
const b64Lines = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/.{1,76}/g, '$&' + CRLF);
const textOf = (html) => String(html)
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h2|h3|li|blockquote|div)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\n{3,}/g, '\n\n').trim();

// -> { headers: [string], body: string } (CRLF line endings)
function buildMessage({ from, fromName, to, subject, html, messageId, domain, unsubscribe, date = new Date() }) {
  const boundary = '=_' + crypto.randomBytes(12).toString('hex');
  const headers = [
    `From: ${fromName ? `${encodeHeader(fromName)} <${from}>` : from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (unsubscribe) headers.push(`List-Unsubscribe: <${unsubscribe}>`, 'List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  const body = [
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64Lines(textOf(html)),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64Lines(html),
    `--${boundary}--`, '',
  ].join(CRLF);
  return { headers, body };
}

// ---- DKIM (rsa-sha256, relaxed/relaxed) -----------------------------------------------------------------
function canonBody(body) {
  const lines = body.split(CRLF).map((l) => l.replace(/[ \t]+/g, ' ').replace(/ $/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length ? lines.join(CRLF) + CRLF : '';
}
const headerName = (h) => h.slice(0, h.indexOf(':')).toLowerCase();
const canonHeader = (h) => { const i = h.indexOf(':'); return headerName(h) + ':' + h.slice(i + 1).replace(/\s+/g, ' ').trim(); };
const SIGNED = ['from', 'to', 'subject', 'date', 'message-id', 'mime-version', 'content-type'];

// -> the "DKIM-Signature: ..." header line to put on top of the message
function dkimHeader(headers, body, { domain, selector, key }) {
  const bh = crypto.createHash('sha256').update(canonBody(body)).digest('base64');
  const present = SIGNED.filter((n) => headers.some((h) => headerName(h) === n));
  const t = Math.floor(Date.now() / 1000);
  const unsigned = `v=1; a=rsa-sha256; c=relaxed/relaxed; d=${domain}; s=${selector}; t=${t}; h=${present.join(':')}; bh=${bh}; b=`;
  const signed = present.map((n) => canonHeader(headers.find((h) => headerName(h) === n))).join(CRLF)
    + CRLF + 'dkim-signature:' + unsigned.trim();
  const b = crypto.sign('sha256', Buffer.from(signed, 'utf8'), key).toString('base64');
  return 'DKIM-Signature: ' + unsigned + b;
}

// -> the full message (headers + blank line + body), signed when a key is given
function assemble(msg, dkim) {
  const headers = dkim ? [dkimHeader(msg.headers, msg.body, dkim), ...msg.headers] : msg.headers;
  return headers.join(CRLF) + CRLF + CRLF + msg.body;
}

// ---- SMTP client ----------------------------------------------------------------------------------------
// Presets like the outreach app's mailer: host, port, and whether TLS starts on connect (465) or via STARTTLS (587)
const PROVIDERS = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
};

const smtpError = (code, text) => Object.assign(new Error(`SMTP ${code}: ${String(text).slice(0, 240)}`), { code, permanent: code >= 500, temporary: code >= 400 && code < 500 });
const netError = (e) => Object.assign(new Error(e.message || 'network error'), { code: 0, temporary: true });

class Conn {
  constructor(sock) {
    this.sock = sock; this.buf = ''; this.lines = []; this.waiter = null; this.err = null;
    sock.setEncoding('utf8');
    sock.setTimeout(TIMEOUT_MS, () => sock.destroy(new Error('timeout')));
    sock.on('data', (d) => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { this.lines.push(this.buf.slice(0, i).replace(/\r$/, '')); this.buf = this.buf.slice(i + 1); } this.pump(); });
    sock.on('error', (e) => this.fail(e));
    sock.on('close', () => this.fail(new Error('connection closed')));
  }
  fail(e) { if (!this.err) this.err = netError(e); this.pump(); }
  pump() {
    if (!this.waiter) return;
    const reply = [];
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i]; reply.push(l);
      if (/^\d{3}( |$)/.test(l)) { this.lines.splice(0, i + 1); const w = this.waiter; this.waiter = null; return w.res({ code: Number(l.slice(0, 3)), text: reply.join('\n') }); }
    }
    if (this.err) { const w = this.waiter; this.waiter = null; w.rej(this.err); }
  }
  read() { return new Promise((res, rej) => { this.waiter = { res, rej }; this.pump(); }); }
  write(s) { this.sock.write(s); }
}

async function cmd(c, line, ok) {
  c.write(line + CRLF);
  const r = await c.read();
  if (!ok.includes(r.code)) throw smtpError(r.code, r.text);
  return r;
}

function connect(host, port, secure) {
  return new Promise((res, rej) => {
    const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    sock.setTimeout(TIMEOUT_MS, () => sock.destroy(new Error('timeout')));
    sock.once(secure ? 'secureConnect' : 'connect', () => { sock.setTimeout(0); res(sock); });
    sock.once('error', (e) => rej(netError(e)));
  });
}

// One delivery attempt to one server. Resolves with the server's final reply; rejects with .temporary / .permanent set.
async function session({ host, port, helo, from, to, data, user, pass, secure = false, starttls = true, allowPlainAuth = false }) {
  let c = new Conn(await connect(host, port, secure));
  let encrypted = secure;
  try {
    const greet = await c.read();
    if (greet.code !== 220) throw smtpError(greet.code, greet.text);
    let ehlo = await cmd(c, `EHLO ${helo}`, [250]);
    if (starttls && /STARTTLS/i.test(ehlo.text)) {
      await cmd(c, 'STARTTLS', [220]);
      const raw = c.sock; raw.removeAllListeners();
      const secure = tls.connect({ socket: raw, servername: host });
      await new Promise((res, rej) => { secure.once('secureConnect', res); secure.once('error', (e) => rej(netError(e))); });
      c = new Conn(secure);
      encrypted = true;
      ehlo = await cmd(c, `EHLO ${helo}`, [250]);
    }
    if (user) {
      if (!encrypted && !allowPlainAuth) throw Object.assign(new Error('refusing to send the mail password without TLS'), { permanent: true, code: 0 });
      const authLine = (ehlo.text.split('\n').find((l) => /AUTH/i.test(l)) || '').toUpperCase();
      if (/PLAIN/.test(authLine)) {
        await cmd(c, `AUTH PLAIN ${Buffer.from(`\u0000${user}\u0000${pass || ''}`, 'utf8').toString('base64')}`, [235]);
      } else if (/LOGIN/.test(authLine)) {
        await cmd(c, 'AUTH LOGIN', [334]);
        await cmd(c, Buffer.from(user, 'utf8').toString('base64'), [334]);
        await cmd(c, Buffer.from(pass || '', 'utf8').toString('base64'), [235]);
      } else if (authLine) {
        throw Object.assign(new Error('server offers no login method this client supports'), { permanent: true, code: 0 });
      }
    }
    await cmd(c, `MAIL FROM:<${from}>`, [250]);
    await cmd(c, `RCPT TO:<${to}>`, [250, 251]);
    await cmd(c, 'DATA', [354]);
    c.write(data.replace(/(^|\r\n)\./g, '$1..') + '.' + CRLF);
    const done = await c.read();
    if (done.code !== 250) throw smtpError(done.code, done.text);
    c.write('QUIT' + CRLF);
    return done;
  } finally {
    c.sock.destroy();
  }
}

async function mxHosts(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx.length) return [domain];
    return mx.sort((a, b) => a.priority - b.priority).map((x) => x.exchange);
  } catch (e) {
    if (e.code === 'ENODATA' || e.code === 'ENOTFOUND') return [domain];
    throw netError(e);
  }
}

// Sends one message. cfg: {helo, from, relay?:{host,port,user,pass}, dkim?}. Throws with .temporary / .permanent.
async function deliver(to, raw, cfg) {
  const domain = to.slice(to.lastIndexOf('@') + 1);
  const targets = cfg.relay
    ? [{ host: cfg.relay.host, port: cfg.relay.port || 587, secure: !!cfg.relay.secure, user: cfg.relay.user, pass: cfg.relay.pass, allowPlainAuth: !!cfg.relay.allowPlainAuth }]
    : (await mxHosts(domain)).map((host) => ({ host, port: 25 }));
  let last = null;
  for (const t of targets) {
    try {
      const r = await session({ ...t, helo: cfg.helo, from: cfg.from, to, data: raw });
      return { code: r.code, text: r.text, host: t.host };
    } catch (e) {
      last = e;
      if (e.permanent) break; // the server said no: other MX hosts would say the same
    }
  }
  throw last || Object.assign(new Error('no mail server found'), { temporary: true, code: 0 });
}

module.exports = { buildMessage, assemble, dkimHeader, canonBody, textOf, deliver, mxHosts, session, encodeHeader, PROVIDERS };
