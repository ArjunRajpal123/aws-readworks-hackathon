# Sound Along web app for EKS: Vite build served by nginx.
# Passage data (sa/product, sa/audio) is NOT baked in; a sidecar in the pod
# syncs it from the media bucket into /data/sa (see infra/cdk/lib/frontend-stack.ts).
FROM public.ecr.aws/docker/library/node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM public.ecr.aws/nginx/nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
