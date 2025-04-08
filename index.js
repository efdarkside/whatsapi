require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { SessionsClient } = require('@google-cloud/dialogflow');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// 1. CONFIGURAÇÃO INICIAL
// =============================================

// Monitoramento de token do WhatsApp
const TOKEN_EXPIRATION = process.env.WHATSAPP_TOKEN_EXPIRATION 
  ? new Date(process.env.WHATSAPP_TOKEN_EXPIRATION) 
  : null;

// Configuração do Dialogflow
const dialogflowClient = new SessionsClient({
  projectId: process.env.DIALOGFLOW_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
});

// =============================================
// 2. MIDDLEWARES
// =============================================

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Middleware para log de requisições
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  next();
});

// =============================================
// 3. FUNÇÕES PRINCIPAIS (ATUALIZADAS)
// =============================================

async function sendWhatsAppMessage(recipient, message) {
  const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  
  try {
    const response = await axios.post(url, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: { body: message }
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000
    });

    return response.data;

  } catch (error) {
    if (error.response?.data?.error?.code === 190) {
      console.error('🔴 TOKEN EXPIRADO:', error.response.data.error);
      throw new Error('TOKEN_EXPIRED');
    }
    throw error;
  }
}

async function detectIntent(sessionId, messageText) {
  const sessionPath = dialogflowClient.projectAgentSessionPath(
    process.env.DIALOGFLOW_PROJECT_ID,
    sessionId
  );

  const [response] = await dialogflowClient.detectIntent({
    session: sessionPath,
    queryInput: {
      text: {
        text: messageText,
        languageCode: 'pt-BR',
      },
    },
  });

  return response.queryResult.fulfillmentText;
}

// =============================================
// 4. ROTAS COM TRATAMENTO DE ERROS COMPLETO
// =============================================

app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    // Verificação robusta do corpo da requisição
    if (!req.body || typeof req.body !== 'object') {
      console.error('❌ Corpo da requisição inválido:', req.rawBody);
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const entry = req.body.entry?.[0];
    if (!entry) {
      console.log('⚠️ Entrada vazia recebida');
      return res.status(200).json({ status: 'ignored' });
    }

    const change = entry.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) {
      console.log('📭 Nenhuma mensagem válida encontrada');
      return res.status(200).json({ status: 'no_message' });
    }

    console.log(`📩 Mensagem recebida de ${message.from}: ${message.text?.body || '(sem texto)'}`);

    const dialogflowResponse = await detectIntent(message.from, message.text?.body || '');
    await sendWhatsAppMessage(message.from, dialogflowResponse);

    res.status(200).json({ status: 'success' });

  } catch (error) {
    console.error('🔥 ERRO:', {
      error: error.message,
      stack: error.stack,
      body: req.rawBody
    });

    if (error.message === 'TOKEN_EXPIRED') {
      return res.status(401).json({ error: 'token_expired' });
    }

    res.status(500).json({ error: 'internal_error' });
  }
});

// =============================================
// 5. INICIALIZAÇÃO E MONITORAMENTO
// =============================================

app.listen(PORT, () => {
  console.log(`
  🚀 Servidor rodando na porta ${PORT}
  ⏰ Token expira em: ${TOKEN_EXPIRATION || 'data não configurada'}
  `);

  // Verificação diária do token
  setInterval(() => {
    if (TOKEN_EXPIRATION && new Date() > TOKEN_EXPIRATION) {
      console.error('⏰ ALERTA: Token do WhatsApp expirou!');
    }
  }, 24 * 60 * 60 * 1000);
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason) => {
  console.error('💥 Rejeição não tratada:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('💣 Exceção não capturada:', error);
  process.exit(1);
});
