# Facebook Lead Ads → Twenty CRM Bridge

Middleware que conecta Facebook Lead Ads con Twenty CRM (self-hosted). Desplegable en Railway.

## Requisitos

- Node.js 18+
- Cuenta de Facebook con Lead Ads configurados
- Twenty CRM self-hosted con API REST habilitada

## Variables de entorno

| Variable          | Descripción                                      |
|-------------------|--------------------------------------------------|
| `FB_VERIFY_TOKEN` | Token para verificar el webhook de Facebook      |
| `FB_PAGE_TOKEN`   | Page Access Token con permisos de leads          |
| `TWENTY_API_URL`  | URL base de Twenty (ej: `https://crm.tudominio.com`) |
| `TWENTY_API_KEY`  | API Key de Twenty (Bearer Token)                 |
| `PORT`            | Puerto (Railway lo asigna automáticamente)      |

## Configuración en Facebook

1. Crea una app en [Facebook for Developers](https://developers.facebook.com/).
2. Agrega el producto **Webhooks** y configura la suscripción a **Page** → campo `leadgen`.
3. URL del webhook: `https://tu-dominio.railway.app/webhook`
4. Token de verificación: el mismo valor que `FB_VERIFY_TOKEN`.

## Configuración en Twenty

En Twenty: **Settings → APIs & Webhooks**, genera una API key y copia la URL base del workspace.

## Despliegue en Railway

1. Conecta este repositorio a Railway.
2. Configura las variables de entorno en el panel.
3. Railway detectará Node.js y desplegará automáticamente.

## Endpoints

- `GET /webhook` — Verificación del webhook (Facebook)
- `POST /webhook` — Recibe notificaciones de nuevos leads
- `GET /health` — Health check
