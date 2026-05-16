# Multi-stage build: serve static frontend via Nginx
FROM nginx:1.25-alpine

# Remove default nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy landing page
COPY app/ /usr/share/nginx/html/

# Copy nginx config
COPY nginx/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
