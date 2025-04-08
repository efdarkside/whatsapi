require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { SessionsClient } = require('@google-cloud/dialogflow');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração segura do cliente Dialogflow
const dialogflowClient = new SessionsClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json',
  projectId: process.env.DIALOGFLOW_PROJECT_ID
});

// Middlewares
app.use(bodyParser.json());

// Rotas
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

app.post('/webhook', async (req, res) => {
  try {
    console.log('📩 Payload recebido:', JSON.stringify(req.body, null, 2));

    const entry = req.body.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];
    
    if (!message) {
      console.log('⚠️ Mensagem não reconhecida');
      return res.sendStatus(200);
    }

    // Processamento da mensagem
    const response = await processMessage(
      message.from,
      message.text?.body
    );

    res.status(200).json({ status: 'success', response });
  } catch (error) {
    console.error('🔥 Erro crítico:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Funções principais
async function processMessage(sender, message) {
  try {
    // 1. Consulta ao Dialogflow
    const dialogflowResponse = await callDialogflow(message, sender);
    
    // 2. Envio para WhatsApp
    await sendToWhatsApp(sender, dialogflowResponse);
    
    return { dialogflow: dialogflowResponse };
  } catch (error) {
    console.error('Erro no processamento:', error);
    throw error;
  }
}

async function callDialogflow(message, sessionId) {
  try {
    const sessionPath = dialogflowClient.projectAgentSessionPath(
      process.env.DIALOGFLOW_PROJECT_ID,
      sessionId
    );

    const request = {
      session: sessionPath,
      queryInput: {
        text: {
          text: message,
          languageCode: 'pt-BR',
        },
      },
    };

    const [response] = await dialogflowClient.detectIntent(request);
    return response.queryResult.fulfillmentText;

  } catch (error) {
    console.error('🚨 Erro no Dialogflow:', {
      message: error.message,
      details: error.response?.data
    });
    throw new Error('Falha na consulta ao Dialogflow');
  }
}

async function sendToWhatsApp(recipient, message) {
  await axios.post(
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
    }
  );
}

// Inicialização
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🔗 Dialogflow Project ID: ${process.env.DIALOGFLOW_PROJECT_ID}`);
});
