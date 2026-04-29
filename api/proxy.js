// Vercel Serverless Function: 代理 ofox API
// 支持两种路径：
//   /proxy/v1/...        → https://api.ofox.ai/v1/...        (OpenAI 协议, Bearer)
//   /proxy/gemini/...    → https://api.ofox.ai/gemini/...    (Gemini 原生协议, x-goog-api-key)

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '50mb',
  },
  maxDuration: 300,
};

const OFOX_HOST = 'https://api.ofox.ai';
const DEFAULT_KEY = process.env.OFOX_API_KEY || 'sk-of-rzlYLlHUUZRczWRGcKIDmbPxxNYauGXuhOFRgqnVMpHFhDeNzkyEYbLzlLaIPMjn';

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key, x-api-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const path = req.query.path || '';
  const targetUrl = `${OFOX_HOST}/${path}`;

  // 提取 API Key（前端可能用 Authorization 或 x-goog-api-key）
  let apiKey = DEFAULT_KEY;
  const authHeader = req.headers.authorization;
  const googHeader = req.headers['x-goog-api-key'];
  const xApiHeader = req.headers['x-api-key'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.slice(7);
  } else if (googHeader) {
    apiKey = googHeader;
  } else if (xApiHeader) {
    apiKey = xApiHeader;
  }

  // 根据路径决定用哪种认证
  const headers = {};
  if (path.startsWith('gemini/')) {
    // Gemini 原生协议
    headers['x-goog-api-key'] = apiKey;
  } else if (path.startsWith('anthropic/')) {
    // Anthropic 原生协议
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    // OpenAI 兼容协议（默认）
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // 复制 Content-Type
  if (req.headers['content-type']) {
    headers['Content-Type'] = req.headers['content-type'];
  }

  try {
    let body;
    if (req.method === 'POST' || req.method === 'PUT') {
      body = await readBody(req);
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    const data = await upstream.arrayBuffer();
    res.send(Buffer.from(data));

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(502).json({
      error: {
        message: `代理请求失败: ${err.message}`,
        type: 'proxy_error'
      }
    });
  }
}
