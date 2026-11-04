#!/bin/sh
# Runs automatically before nginx starts (the official nginx image executes
# every *.sh in /docker-entrypoint.d/, in order). The image is built with no
# environment baked in -- these are set on the pod's "web" container by
# infra/cdk's FrontendStack at deploy time:
#   SA_API_URL            ApiStack's text-to-speech URL (src/api.js)
#   SA_AUTH_REGION        \
#   SA_AUTH_USER_POOL_ID   } AuthStack's Cognito pool + web client (src/auth.js)
#   SA_AUTH_CLIENT_ID     /
set -eu
cat > /usr/share/nginx/html/config.js <<EOF
window.SA_API_URL="${SA_API_URL:-}";
window.SA_AUTH={region:"${SA_AUTH_REGION:-}",userPoolId:"${SA_AUTH_USER_POOL_ID:-}",clientId:"${SA_AUTH_CLIENT_ID:-}"};
EOF
