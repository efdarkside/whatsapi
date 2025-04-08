require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { SessionsClient } = require('@google-cloud/dialogflow');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// CONFIGURAÇÃO SEGURA DO DIALOGFLOW (2024)
// =============================================
const getDialogflowClient = () => {
  try {
    // Validação rigorosa das variáveis
    if (!process.env.DIALOGFLOW_PROJECT_ID) {
      throw new Error('DIALOGFLOW_PROJECT_ID não definido');
    }

    if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      throw new Error('Credenciais do Google incompletas');
    }

    // Configuração recomendada pelo Google (2024)
    return new SessionsClient({
      projectId: process.env.DIALOGFLOW_PROJECT_ID,
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY,
      },
      apiEndpoint: 'dialogflow.googleapis.com',
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  } catch (error) {
    console.error('❌ Configuração do Dialogflow falhou:', error.message);
    process.exit(1);
  }
};

const dialogflowClient = getDialogflowClient();

// Middlewares
app.use(express.json());

// ======================
// ROTAS DO WEBHOOK (2024)
// ======================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ Webhook verificado');
    return res.status(200).send(challenge);
  }

  console.error('❌ Falha na verificação');
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    // Extração segura dos dados (com operador optional chaining)
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    
    if (!message) {
      console.log('⚠️ Payload inválido');
      return res.sendStatus(200);
    }

    // Processamento assíncrono
    await processWhatsAppMessage(message);
    res.status(200).json({ status: 'success' });

  } catch (error) {
    console.error('🔥 Erro no webhook:', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ======================
// FUNÇÕES PRINCIPAIS (2024)
// ======================
async function processWhatsAppMessage(message) {
  try {
    // 1. Processa a mensagem no Dialogflow
    const dialogflowResponse = await detectIntent(
      message.from, // Usa o número como sessionId
      message.text?.body
    );

    // 2. Envia resposta para WhatsApp
    await sendWhatsAppReply(
      message.from,
      dialogflowResponse
    );

  } catch (error) {
    console.error('🔴 Erro no processamento:', {
      messageId: message.id,
      error: error.message
    });
    throw error;
  }
}

async function detectIntent(sessionId, messageText) {
  try {
    // Cria session path com o novo formato (2024)
    const sessionPath = dialogflowClient.projectAgentSessionPath(
      process.env.DIALOGFLOW_PROJECT_ID,
      sessionId
    );

    console.log('🔍 Detectando intenção para sessão:', sessionPath);

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
    console.error('🔴 ERRO NO DIALOGFLOW:', {
      projectId: process.env.DIALOGFLOW_PROJECT_ID,
      errorDetails: error.response?.data || error.message,
      errorCode: error.code
    });
    throw new Error('Falha ao detectar intenção');
  }
}

async function sendWhatsAppReply(recipient, message) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000 // Timeout de 5 segundos
      }
    );

    console.log('📤 Mensagem enviada:', response.data);

  } catch (error) {
    console.error('🔴 ERRO NO WHATSAPP:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    throw error;
  }
}

// ======================
// INICIALIZAÇÃO (2024)
// ======================
app.listen(PORT, () => {
  console.log(`
  🚀 Servidor iniciado na porta ${PORT}
  📌 Configurações carregadas:
     - Projeto Dialogflow: ${process.env.DIALOGFLOW_PROJECT_ID}
     - Número WhatsApp: ${process.env.WHATSAPP_PHONE_NUMBER_ID}
  `);
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (error) => {
  console.error('💥 Erro não tratado:', error);
});
