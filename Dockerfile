FROM busybox:1.37

WORKDIR /www
COPY index.html demo-page.html ./
COPY assets ./assets
COPY components ./components

EXPOSE 4232
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4232/ >/dev/null || exit 1

CMD ["httpd", "-f", "-p", "4232", "-h", "/www"]
