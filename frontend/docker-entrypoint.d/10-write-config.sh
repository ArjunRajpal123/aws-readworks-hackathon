#!/bin/sh
# Runs automatically before nginx starts (the official nginx image executes
# every *.sh in /docker-entrypoint.d/, in order). The image is built with no
# API URL baked in -- SA_API_URL and SA_DATA_URL are set on the pod's "web"
# container by infra/cdk's FrontendStack, from ApiStack, at deploy time.
set -eu
{
  echo "window.SA_API_URL=\"${SA_API_URL:-}\";"
  echo "window.SA_DATA_URL=\"${SA_DATA_URL:-}\";"
} > /usr/share/nginx/html/config.js
