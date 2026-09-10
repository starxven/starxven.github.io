const { createApp } = require('./app');

const app = createApp();
const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
  console.log(`[backend] Replicate: ${process.env.REPLICATE_API_KEY ? 'configured' : 'missing'}`);
  console.log(`[backend] ElevenLabs: ${(process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY) ? 'configured' : 'missing'}`);
});
