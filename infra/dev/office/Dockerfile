# meetless-office: LibreOffice + python-pptx/python-docx conversion service (dev/test).
# Built and run by infra/dev/deps.sh. Listens on 8000 inside the container; the
# compose file publishes it on 127.0.0.1:55434 only.
ARG BASE=debian:bookworm-slim
FROM ${BASE}
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-impress libreoffice-writer libreoffice-core \
      poppler-utils fonts-noto-cjk fonts-dejavu-core \
      python3 python3-pip python3-lxml python3-pil \
 && pip3 install --no-cache-dir --break-system-packages python-pptx==1.0.2 python-docx==1.1.2 \
 && apt-get purge -y python3-pip && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 10001 office
COPY convert_server.py make_fixtures.py /opt/meetless/
USER office
WORKDIR /home/office
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --retries=20 CMD python3 -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=2)"
CMD ["python3", "/opt/meetless/convert_server.py", "--host", "0.0.0.0", "--port", "8000"]
