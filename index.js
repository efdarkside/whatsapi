require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { SessionsClient } = require('@google-cloud/dialogflow');

const app = express();
const PORT = process.env.PORT || 3000;

// ======================
// CONFIGURAÇÃO INICIAL
// ======================

// Configuração do cliente Dialogflow
const dialogflowClient = new SessionsClient({
  projectId: process.env.DIALOGFLOW_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
});

// ======================
// MIDDLEWARES
// ======================

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Middleware de logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ======================
// FUNÇÕES PRINCIPAIS
// ======================

/**
 * Envia mensagem via WhatsApp Business API
 */
async function sendWhatsAppMessage(recipient, message) {
  try {
    const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: {
        body: message,
        preview_url: false
      }
    };

    console.log('Enviando mensagem WhatsApp:', { recipient, messagePreview: message.substring(0, 30) });

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000
    });

    console.log('Mensagem enviada com sucesso:', response.data.id);
    return response.data;

  } catch (error) {
    console.error('Erro ao enviar mensagem:', {
      status: error.response?.status,
      error: error.response?.data?.error || error.message,
      recipient
    });
    throw error;
  }
}

/**
 * Processa a intenção no Dialogflow
 */
async function detectIntent(sessionId, messageText) {
  try {
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

  } catch (error) {
    console.error('Erro no Dialogflow:', {
      error: error.message,
      sessionId,
      projectId: process.env.DIALOGFLOW_PROJECT_ID
    });
    throw error;
  }
}

// ======================
// ROTAS
// ======================

/**
 * Rota de verificação do webhook
 */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verificado com sucesso');
    return res.status(200).send(challenge);
  }

  console.error('Falha na verificação do webhook');
  res.sendStatus(403);
});

/**
 * Rota principal para mensagens
 */
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    
    if (!change) {
      console.log('Payload sem changes:', req.body);
      return res.status(200).end();
    }

    // Processa mensagens recebidas
    if (change.value.messages) {
      const message = change.value.messages[0];
      console.log('Mensagem recebida:', {
        from: message.from,
        type: message.type,
        text: message.text?.body
      });

      const dialogflowResponse = await detectIntent(message.from, message.text?.body || '');
      await sendWhatsAppMessage(message.from, dialogflowResponse);
    }
    // Processa atualizações de status
    else if (change.value.statuses) {
      const status = change.value.statuses[0];
      console.log('Atualização de status:', {
        messageId: status.id,
        status: status.status,
        timestamp: status.timestamp
      });
    }

    res.status(200).end();

  } catch (error) {
    console.error('Erro no processamento:', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    res.status(500).end();
  }
});

// ======================
// INICIALIZAÇÃO
// ======================

app.listen(PORT, () => {
  console.log(`
  ====================================
  🚀 Servidor rodando na porta ${PORT}
  📞 WhatsApp Number ID: ${process.env.WHATSAPP_PHONE_NUMBER_ID}
  🤖 Dialogflow Project: ${process.env.DIALOGFLOW_PROJECT_ID}
  ====================================
  `);
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason) => {
  console.error('Erro não tratado:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Erro crítico:', error);
  process.exit(1);
});
