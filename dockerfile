# ════════════════════════════════════════════════════════════
# 🌙 by_moon — Djezzy Bot v13 (666gb_pro2) — Choreo Ready
# ════════════════════════════════════════════════════════════
FROM node:20-alpine

LABEL maintainer="by_moon" \
      description="Djezzy Telegram Bot v13 (666gb_pro2)" \
      version="13.0.0"

# ── أدوات مساعدة + المنطقة الزمنية ─────────────────────────
RUN apk add --no-cache tini curl ca-certificates tzdata && \
    cp /usr/share/zoneinfo/Africa/Algiers /etc/localtime && \
    echo "Africa/Algiers" > /etc/timezone && \
    update-ca-certificates

# ── مجلد العمل ──────────────────────────────────────────────
WORKDIR /app

# ── التبعيات أولاً (cache الطبقات) ─────────────────────────
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error && \
    npm cache clean --force

# ── الكود المصدري ──────────────────────────────────────────
COPY 666gb_pro2.js ./

# ── إنشاء مستخدم بمعرّف UID متوافق مع Choreo ───────────────
# Choreo يتطلب أن يكون UID بين 10000 و 20000
RUN addgroup -g 10014 -S appgroup && \
    adduser -u 10014 -S -G appgroup -h /app -s /sbin/nologin appuser

# ── مجلد البيانات + الصلاحيات ──────────────────────────────
RUN mkdir -p /app/data && \
    chown -R 10014:10014 /app

# ── التبديل إلى المستخدم غير root ──────────────────────────
USER 10014

# ── متغيرات البيئة ─────────────────────────────────────────
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512" \
    TZ=Africa/Algiers \
    DATA_DIR=/app/data \
    SKIP_DEP_INSTALL=1

# ── فحص الصحة ──────────────────────────────────────────────
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD pgrep -f "node 666gb_pro2.js" || exit 1

# ── init + تشغيل ───────────────────────────────────────────
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "666gb_pro2.js"]
