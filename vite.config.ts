import { defineConfig, loadEnv } from 'vite'
import fs from 'fs'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

function geminiDevProxy(mode) {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY || ''
  const logDirectory = path.resolve(process.cwd(), 'logs')
  const outputDirectory = path.resolve(process.cwd(), 'outputs')

  return {
    name: 'gemini-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/research-artifact', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          const body = await readRequestBody(req)
          const payload = JSON.parse(body || '{}')
          const receivedAt = new Date().toISOString()
          const outputDate = receivedAt.slice(0, 10)
          const artifactType = sanitizePathSegment(payload.artifactType || 'artifact')
          const filename = sanitizeFilename(payload.filename || `VoyagerLab_${artifactType}_${Date.now()}.csv`)
          const content = typeof payload.content === 'string' ? payload.content : ''
          const directory = path.join(outputDirectory, outputDate)
          const filePath = path.join(directory, filename)

          fs.mkdirSync(directory, { recursive: true })
          fs.writeFileSync(filePath, content, 'utf8')
          console.log(`[VoyagerLab][Artifact] ${artifactType} -> ${path.relative(process.cwd(), filePath)}`)

          res.statusCode = 204
          res.end()
        } catch (error) {
          console.error('[VoyagerLab][Artifact] Failed to write research artifact', error)
          res.statusCode = 500
          res.end(error instanceof Error ? error.message : 'Research artifact write failed')
        }
      })

      server.middlewares.use('/api/session-event-log', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          const body = await readRequestBody(req)
          const payload = JSON.parse(body || '{}')
          const receivedAt = new Date().toISOString()
          const logDate = receivedAt.slice(0, 10)
          const filePath = path.join(logDirectory, `voyagerlab-session-${logDate}.jsonl`)
          const entry = { receivedAt, ...payload }

          fs.mkdirSync(logDirectory, { recursive: true })
          fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8')
          console.log(`[VoyagerLab][SessionLog] ${entry.type || 'event'} ${entry.id || ''} -> ${path.relative(process.cwd(), filePath)}`)

          res.statusCode = 204
          res.end()
        } catch (error) {
          console.error('[VoyagerLab][SessionLog] Failed to write event log', error)
          res.statusCode = 500
          res.end(error instanceof Error ? error.message : 'Session event log failed')
        }
      })

      server.middlewares.use('/api/client-log', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          const body = await readRequestBody(req)
          const payload = JSON.parse(body || '{}')
          console.groupCollapsed(`[VoyagerLab][Client] ${payload.type || 'log'} ${payload.timestamp || new Date().toISOString()}`)
          console.log(JSON.stringify(payload, null, 2))
          console.groupEnd()
          res.statusCode = 204
          res.end()
        } catch (error) {
          console.error('[VoyagerLab][Client] Failed to read client log', error)
          res.statusCode = 500
          res.end(error instanceof Error ? error.message : 'Client log failed')
        }
      })

      server.middlewares.use('/api/gemini/stream', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        if (!apiKey) {
          res.statusCode = 500
          res.end('Missing GEMINI_API_KEY or VITE_GEMINI_API_KEY')
          return
        }

        try {
          const body = await readRequestBody(req)
          const { requestId, condition, model, attempt, requestPayload } = JSON.parse(body)
          const geminiModel = model || env.VITE_GEMINI_MODEL || 'gemini-3.0-pro'
          const payload = requestPayload || {}
          const logRequestId = requestId || `vite-${Date.now()}`
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?alt=sse&key=${apiKey}`
          let rawResponse = ''
          let lineBuffer = ''

          console.groupCollapsed(`[VoyagerLab][Vite] Gemini request ${logRequestId} ${new Date().toISOString()}`)
          console.log('Condition', condition || 'unknown')
          console.log('Attempt', attempt || 1)
          console.log('Model', geminiModel)
          console.log('Payload', JSON.stringify(payload, null, 2))
          console.groupEnd()

          const upstream = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })

          console.log(`[VoyagerLab][Vite] Gemini status ${logRequestId}: ${upstream.status}`)

          res.statusCode = upstream.status
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream')
          res.setHeader('Cache-Control', 'no-cache, no-transform')

          if (!upstream.body) {
            res.end()
            return
          }

          const reader = upstream.body.getReader()
          const decoder = new TextDecoder()

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunkText = decoder.decode(value, { stream: true })
            const lines = `${lineBuffer}${chunkText}`.split('\n')
            lineBuffer = lines.pop() || ''
            rawResponse += extractGeminiTextFromSseLines(lines)
            res.write(Buffer.from(value))
          }

          if (lineBuffer) {
            rawResponse += extractGeminiTextFromSseLines([lineBuffer])
          }

          console.groupCollapsed(`[VoyagerLab][Vite] Gemini raw response ${logRequestId} ${new Date().toISOString()}`)
          console.log('Condition', condition || 'unknown')
          console.log('Attempt', attempt || 1)
          console.log('Status', upstream.status)
          console.log(rawResponse)
          console.groupEnd()
          res.end()
        } catch (error) {
          console.error('[VoyagerLab][Vite] Gemini proxy failed', error)
          res.statusCode = 500
          res.end(error instanceof Error ? error.message : 'Gemini proxy failed')
        }
      })
    },
  }
}

function sanitizePathSegment(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'artifact'
}

function sanitizeFilename(value) {
  const filename = path.basename(String(value)).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '')
  const safeName = filename || 'artifact'
  return safeName.toLowerCase().endsWith('.csv') ? safeName : `${safeName}.csv`
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function extractGeminiTextFromSseLines(lines) {
  let extracted = ''

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (!data || data === '[DONE]') continue

    try {
      const parsed = JSON.parse(data)
      extracted += parsed.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || ''
    } catch {
      // Ignore partial or non-JSON SSE lines; the browser receives the original stream.
    }
  }

  return extracted
}

export default defineConfig(({ mode }) => ({
  plugins: [
    figmaAssetResolver(),
    react(),
    tailwindcss(),
    geminiDevProxy(mode),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
}))
