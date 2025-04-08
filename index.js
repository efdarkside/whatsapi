require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { SessionsClient } = require('@google-cloud/dialogflow');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// CONFIGURAÇÃO SEGURA DO DIALOGFLOW (Render.com)
// =============================================
const dialogflowClient = new SessionsClient({
  projectId: process.env.DIALOGFLOW_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') // Converte \n para quebras reais
  }
});

// Middlewares
app.use(bodyParser.json());

// ======================
// ROTAS DO WEBHOOK
// ======================

// Verificação do Webhook (Meta)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ Webhook verificado');
    res.status(200).send(challenge);
  } else {
    console.error('❌ Token de verificação inválido');
    res.sendStatus(403);
  }
});

// Recebimento de mensagens
app.post('/webhook', async (req, res) => {
  try {
    console.log('📩 Payload recebido:', JSON.stringify(req.body, null, 2));

    const entry = req.body.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];
    
    if (!message) {
      console.log('⚠️ Mensagem não reconhecida');
      return res.sendStatus(200);
    }

    const response = await processMessage(message.from, message.text?.body);
    res.status(200).json({ status: 'success', response });

  } catch (error) {
    console.error('🔥 Erro crítico:', error.stack);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ======================
// FUNÇÕES PRINCIPAIS
// ======================

// Processa mensagem (WhatsApp → Dialogflow → WhatsApp)
async function processMessage(sender, message) {
  try {
    // 1. Consulta ao Dialogflow
    const dialogflowResponse = await callDialogflow(message, sender);
    
    // 2. Envia resposta para WhatsApp
    await sendToWhatsApp(sender, dialogflowResponse);
    
    return { dialogflow: dialogflowResponse };

  } catch (error) {
    console.error('Erro no processamento:', error.stack);
    throw error;
  }
}

// Consulta segura ao Dialogflow
async function callDialogflow(message, sessionId) {
  try {
    console.log('🔑 Credenciais carregadas para o projeto:', process.env.DIALOGFLOW_PROJECT_ID);

    const sessionPath = dialogflowClient.projectAgentSessionPath(
      process.env.DIALOGFLOW_PROJECT_ID,
      sessionId
    );

    const [response] = await dialogflowClient.detectIntent({
      session: sessionPath,
      queryInput: {
        text: {
          text: message,
          languageCode: 'pt-BR',
        },
      },
    });

    return response.queryResult.fulfillmentText;

  } catch (error) {
    console.error('🔴 ERRO NO DIALOGFLOW:', {
      message: error.message,
      details: error.response?.data || 'Sem detalhes adicionais'
    });
    throw new Error('Falha na consulta ao Dialogflow');
  }
}

// Envia mensagem para WhatsApp
async function sendToWhatsApp(recipient, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('🔴 ERRO NO WHATSAPP:', error.response?.data || error.message);
    throw error;
  }
}

// ======================
// INICIALIZAÇÃO
// ======================
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🔗 Dialogflow Project ID: ${process.env.DIALOGFLOW_PROJECT_ID}`);
  console.log(`🔗 WhatsApp Number ID: ${process.env.WHATSAPP_PHONE_NUMBER_ID}`);
});
