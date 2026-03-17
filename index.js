/**
 * Middleware Bridge - Facebook Lead Ads ↔ Twenty CRM
 * Conecta webhooks de Facebook Lead Ads con la API REST de Twenty.
 * Desplegable en Railway.
 */

const express = require('express');
const https = require('https');

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

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
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
 * Extrae nameValue, lastNameValue y emailValue del array field_data de Facebook.
 * Busca los campos por su propiedad .name.
 */
function extractLeadFields(fieldData) {
  const result = { nameValue: null, lastNameValue: null, emailValue: null };

  if (!Array.isArray(fieldData)) return result;

  for (const field of fieldData) {
    const value = field.values?.[0];
    if (!value) continue;

    const name = field.name;
    if (name === 'first_name') result.nameValue = value;
    else if (name === 'last_name') result.lastNameValue = value;
    else if (name === 'full_name') {
      if (!result.nameValue || !result.lastNameValue) {
        const parts = String(value).trim().split(/\s+/);
        if (!result.nameValue) result.nameValue = parts[0] || null;
        if (!result.lastNameValue) result.lastNameValue = parts.slice(1).join(' ') || null;
      }
    } else if (name === 'email') result.emailValue = value;
  }

  return result;
}

/**
 * Crea una persona en Twenty CRM
 */
async function createPersonInTwenty(nameValue, lastNameValue, emailValue) {
  const personData = {
    name: {
      name: {
        firstName: nameValue || 'Lead',
        lastName: lastNameValue || 'Facebook',
      },
    },
    emails: { primaryEmail: emailValue },
  };

  console.log('JSON enviado a Twenty:', JSON.stringify(personData));

  const url = new URL('/rest/people', TWENTY_API_URL).toString();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TWENTY_API_KEY}`,
      },
      body: JSON.stringify(personData),
    });

    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      console.log('Respuesta de Twenty:', response.status, data);
      return data;
    } else {
      console.error('Error detallado de Twenty:', data);
      throw new Error(`Twenty API error ${response.status}: ${JSON.stringify(data)}`);
    }
  } catch (error) {
    if (!error.message?.includes('Twenty API error')) {
      console.error('Error detallado de Twenty:', error.message);
    }
    throw error;
  }
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
        console.log(`Lead ${leadgenId} field_data recibido:`, JSON.stringify(leadData.field_data));
        const { nameValue, lastNameValue, emailValue } = extractLeadFields(
          leadData.field_data
        );

        if (!emailValue) {
          console.warn(`Lead ${leadgenId} sin email, omitiendo`);
          continue;
        }

        await createPersonInTwenty(nameValue, lastNameValue, emailValue);
        console.log(`Lead ${leadgenId} sincronizado en Twenty: ${emailValue}`);
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
