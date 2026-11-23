import {
  X509Certificate,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from 'crypto';

// The little bit of X.509 the security extension needs: a PKCS#10 request for
// SignCertificate, and the CertificateHashData of an installed certificate.
// Written against DER directly so the emulator needs no crypto dependency.

// --- DER writing ---

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let n = length; n > 0; n >>= 8) bytes.unshift(n & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([tag]),
    derLength(content.length),
    content,
  ]);
}

const sequence = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const utf8 = (text: string) => tlv(0x0c, Buffer.from(text, 'utf8'));
const bitString = (content: Buffer) =>
  tlv(0x03, Buffer.concat([Buffer.from([0]), content]));

function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const bytes: number[] = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk = [part & 0x7f];
    for (let n = part >> 7; n > 0; n >>= 7) chunk.unshift((n & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

const OID_COMMON_NAME = '2.5.4.3';
const OID_ORGANIZATION = '2.5.4.10';
const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';

function name(attributes: [string, string][]): Buffer {
  return sequence(
    ...attributes
      .filter(([, value]) => value)
      .map(([type, value]) => set(sequence(oid(type), utf8(value)))),
  );
}

function pem(label: string, der: Buffer): string {
  const body = der
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
    .trimEnd();
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

export interface CsrResult {
  csrPem: string;
  privateKeyPem: string;
}

/** A PKCS#10 certificate request on a fresh P-256 key. */
export function generateCsr(
  commonName: string,
  organization: string,
): CsrResult {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const requestInfo = sequence(
    tlv(0x02, Buffer.from([0])), // version 0
    name([
      [OID_ORGANIZATION, organization],
      [OID_COMMON_NAME, commonName],
    ]),
    spki,
    tlv(0xa0, Buffer.alloc(0)), // no attributes
  );
  const signature = sign('sha256', requestInfo, privateKey);
  const request = sequence(
    requestInfo,
    sequence(oid(OID_ECDSA_SHA256)),
    bitString(signature),
  );
  return {
    csrPem: pem('CERTIFICATE REQUEST', request),
    privateKeyPem: privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
  };
}

// --- DER reading ---

interface Tlv {
  tag: number;
  /** Offset of the tag byte. */
  start: number;
  /** Offset of the first content byte. */
  content: number;
  /** Offset just past the element. */
  end: number;
}

function readTlv(der: Buffer, offset: number): Tlv {
  const tag = der[offset];
  let length = der[offset + 1];
  let content = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let i = 0; i < count; i++) length = (length << 8) | der[content + i];
    content += count;
  }
  return { tag, start: offset, content, end: content + length };
}

function children(der: Buffer, parent: Tlv): Tlv[] {
  const items: Tlv[] = [];
  for (let offset = parent.content; offset < parent.end; ) {
    const item = readTlv(der, offset);
    items.push(item);
    offset = item.end;
  }
  return items;
}

const sha256 = (data: Buffer) =>
  createHash('sha256').update(data).digest('hex');

export interface CertificateInfo {
  subject: string;
  serialNumber: string;
  issuerNameHash: string;
  issuerKeyHash: string;
  selfSigned: boolean;
}

/**
 * CertificateHashData (SHA-256) of a certificate.
 *
 * issuerKeyHash is the hash of the issuer's public key. It is exact for a
 * self-signed (root) certificate and when the issuer's certificate is given;
 * otherwise the certificate's own key is used as a stand-in.
 */
export function describeCertificate(
  certPem: string,
  issuerPem?: string,
): CertificateInfo {
  const cert = new X509Certificate(certPem);
  const der = cert.raw;
  const tbs = children(der, readTlv(der, 0))[0];
  const fields = children(der, tbs);
  // TBSCertificate: [0] version (optional), serial, signature, issuer, validity, subject, spki
  const shift = fields[0].tag === 0xa0 ? 1 : 0;
  const issuer = fields[shift + 2];
  const issuerNameHash = sha256(der.subarray(issuer.start, issuer.end));

  const keyOf = (x509: X509Certificate): Buffer => {
    const raw = x509.raw;
    const parts = children(raw, children(raw, readTlv(raw, 0))[0]);
    const spki = parts[(parts[0].tag === 0xa0 ? 1 : 0) + 5];
    const bits = children(raw, spki)[1];
    // Skip the "unused bits" byte of the BIT STRING.
    return raw.subarray(bits.content + 1, bits.end);
  };

  const selfSigned = cert.issuer === cert.subject;
  const issuerCert = issuerPem ? new X509Certificate(issuerPem) : cert;
  return {
    subject: cert.subject.replace(/\n/g, ', '),
    serialNumber: cert.serialNumber.replace(/^0+(?=.)/, '').toLowerCase(),
    issuerNameHash,
    issuerKeyHash: sha256(keyOf(issuerCert)),
    selfSigned,
  };
}

/** Split a PEM bundle into its certificates, leaf first. */
export function splitPemChain(chain: string): string[] {
  return (
    chain.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    ) ?? []
  );
}

/** True when the certificate was issued for this private key. */
export function certificateMatchesKey(
  certPem: string,
  privateKeyPem: string,
): boolean {
  try {
    const cert = new X509Certificate(certPem);
    const ours = createPublicKey(privateKeyPem).export({
      type: 'spki',
      format: 'der',
    });
    const theirs = cert.publicKey.export({ type: 'spki', format: 'der' });
    return Buffer.compare(ours, theirs) === 0;
  } catch {
    return false;
  }
}

export function isCertificate(text: string): boolean {
  try {
    new X509Certificate(text);
    return true;
  } catch {
    return false;
  }
}
