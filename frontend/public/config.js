// Local-dev / no-container default: no API configured, so src/api.js falls
// back to reading sa/product/<id>.soundAlong.json straight from public/sa/,
// and src/data_api.js falls back to the built-in sample roster/sessions.
// The deployed pod overwrites this file at container start (see
// docker-entrypoint.d/10-write-config.sh) with the real ApiStack URLs.
window.SA_API_URL = "";
window.SA_DATA_URL = "";
