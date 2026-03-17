/**
 * Middleware Bridge - Facebook Lead Ads ↔ Twenty CRM
 * Conecta webhooks de Facebook Lead Ads con la API REST de Twenty.
 * Desplegable en Railway.
 */

const express = require('express');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Variables de entorno
const {
  FB_VERIFY_TOKEN,
  FB_PAGE_TOKEN,
  TWENTY_API_URL,
  TWENTY_API_KEY,
} = process.env;

// Middleware para parsear JSON
app.use(express.json());

/**
 * GET /webhook - Verificación de Facebook Webhook
 * Facebook envía hub.mode, hub.verify_token y hub.challenge.
 * Devolvemos hub.challenge solo si el token coincide.
 */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
    console.log('Webhook verificado correctamente');
    res.status(200).send(challenge);
  } else {
    console.warn('Verificación fallida: token inválido o modo incorrecto');
    res.sendStatus(403);
  }
});

/**
 * Obtiene los datos del lead desde la Graph API de Facebook
 */
async function fetchLeadFromFacebook(leadgenId) {
  const url = `https://graph.facebook.com/v21.0/${leadgenId}?access_token=${FB_PAGE_TOKEN}&fields=field_data`;
  const client = url.startsWith('https') ? https : http;

  return new Promise((resolve, reject) => {
    client.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message || 'Error en Graph API'));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Extrae email y full_name del array field_data de Facebook
 */
function extractLeadFields(fieldData) {
  if (!Array.isArray(fieldData)) return { email: null, fullName: null };

  let email = null;
  let fullName = null;

  for (const field of fieldData) {
    const value = field.values?.[0];
    if (field.name === 'email' && value) email = value;
    if (field.name === 'full_name' && value) fullName = value;
  }

  return { email, fullName };
}

/**
 * Crea una persona en Twenty CRM
 */
async function createPersonInTwenty(firstName, primaryEmail) {
  const url = new URL('/rest/people', TWENTY_API_URL);
  const body = JSON.stringify({
    firstName: firstName || 'Lead sin nombre',
    emails: { primaryEmail: primaryEmail || '' },
  });

  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${TWENTY_API_KEY}`,
      },
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data || '{}'));
        } else {
          reject(new Error(`Twenty API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * POST /webhook - Recibe notificaciones de nuevos leads desde Facebook
 */
app.post('/webhook', async (req, res) => {
  res.status(200).send('EVENT_RECEIVED');

  if (req.body.object !== 'page') return;

  for (const entry of req.body.entry || []) {
    const changes = entry.changes || [];
    for (const change of changes) {
      if (change.field !== 'leadgen') continue;

      const leadgenId = change.value?.leadgen_id;
      if (!leadgenId) {
        console.warn('Webhook sin leadgen_id');
        continue;
      }

      try {
        const leadData = await fetchLeadFromFacebook(leadgenId);
        const { email, fullName } = extractLeadFields(leadData.field_data);

        if (!email) {
          console.warn(`Lead ${leadgenId} sin email, omitiendo`);
          continue;
        }

        await createPersonInTwenty(fullName || email.split('@')[0], email);
        console.log(`Lead ${leadgenId} sincronizado en Twenty: ${email}`);
      } catch (err) {
        console.error(`Error procesando lead ${leadgenId}:`, err.message);
      }
    }
  }
});

// Health check para Railway
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'facebook-twenty-bridge' });
});

// Validar variables de entorno al iniciar
function validateEnv() {
  const required = ['FB_VERIFY_TOKEN', 'FB_PAGE_TOKEN', 'TWENTY_API_URL', 'TWENTY_API_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('Variables de entorno faltantes:', missing.join(', '));
  }
}

validateEnv();

app.listen(PORT, () => {
  console.log(`Middleware Bridge escuchando en puerto ${PORT}`);
});
