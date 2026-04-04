export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Vercelの環境変数から「声帯の鍵」を取得
  const GCP_TTS_API_KEY = process.env.GCP_TTS_API_KEY;

  if (!GCP_TTS_API_KEY) {
    return new Response(JSON.stringify({ error: "GCP TTS API Key is not set in Vercel." }), { status: 500 });
  }

  try {
    const body = await req.json();

    // サーバーサイドからGoogle Cloud TTSのAPIに安全にリクエスト
    const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GCP_TTS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error("API TTS Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
  }
}