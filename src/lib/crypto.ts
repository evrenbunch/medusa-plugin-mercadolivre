import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

/*
 * The seller's tokens give full control of the Mercado Livre account, so they
 * are stored encrypted (AES-256-GCM) with a key derived from the plugin's
 * `encryptionKey`; a database dump alone does not expose them.
 */

const keyOf = (secret: string) => createHash('sha256').update(`mercadolivre:${secret}`).digest()
const b64 = (buffer: Buffer) => buffer.toString('base64url')

export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `v1.${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(body)}`
}

/** The plain text, or null when the value was sealed with another key or tampered with. */
export function open(sealed: string, secret: string): string | null {
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== 'v1' || !iv || !tag || !body) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

export const hmac = (value: string, secret: string) =>
  createHmac('sha256', keyOf(secret)).update(value).digest('base64url')

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
