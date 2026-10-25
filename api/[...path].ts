import type { IncomingMessage, ServerResponse } from 'node:http'

export const config = {
  api: {
    bodyParser: false,
  },
}

const blockedRequestHeaders = new Set([
  'connection',
  'content-length',
  'host',
  'transfer-encoding',
])

const blockedResponseHeaders = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'transfer-encoding',
])

async function readRequestBody(request: IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const bytes = Buffer.concat(chunks)
  const body = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(body).set(bytes)
  return body
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const backendBase = process.env.RECODE_API_BASE_URL?.trim()
  if (!backendBase) {
    response.statusCode = 503
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ detail: 'The ReCode API is not configured.' }))
    return
  }

  let target: URL
  try {
    const base = new URL(backendBase)
    if (!['http:', 'https:'].includes(base.protocol)) {
      throw new Error('The API URL must use HTTP or HTTPS.')
    }
    target = new URL(request.url ?? '/', base)
  } catch {
    response.statusCode = 500
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ detail: 'The ReCode API URL is invalid.' }))
    return
  }

  try {
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined || blockedRequestHeaders.has(name.toLowerCase())) continue
      headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    }

    const method = request.method ?? 'GET'
    const init: RequestInit & { duplex?: 'half' } = { method, headers }
    if (!['GET', 'HEAD'].includes(method)) {
      init.body = await readRequestBody(request)
    }

    const upstream = await fetch(target, init)
    response.statusCode = upstream.status
    for (const [name, value] of upstream.headers) {
      if (blockedResponseHeaders.has(name.toLowerCase()) || name.toLowerCase() === 'set-cookie') continue
      response.setHeader(name, value)
    }
    const cookies = upstream.headers.getSetCookie()
    if (cookies.length > 0) response.setHeader('Set-Cookie', cookies)
    if (method === 'HEAD' || upstream.status === 204 || upstream.status === 304) {
      response.end()
      return
    }
    response.end(Buffer.from(await upstream.arrayBuffer()))
  } catch (error) {
    console.error('ReCode API proxy failed', error)
    response.statusCode = 502
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ detail: 'Could not reach the ReCode API.' }))
  }
}
