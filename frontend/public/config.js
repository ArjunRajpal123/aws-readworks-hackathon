// Local-dev / no-container default: no API configured, so src/api.js falls
// back to reading sa/product/<id>.soundAlong.json straight from public/sa/.
// The deployed pod overwrites this file at container start (see
// docker-entrypoint.d/10-write-config.sh) with the real ApiStack URL.
window.SA_API_URL = "";
// AI assist endpoint (admin "Fill in with AI"); empty locally -> assist.js
// returns a labelled simulation instead of calling Bedrock.
window.SA_AI_ENDPOINT = "";
