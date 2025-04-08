require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { SessionsClient } = require('@google-cloud/dialogflow');

const app = express();
app.use(bodyParser.json());

// Configurações do Dialogflow
const DIALOGFLOW_PROJECT_ID = process.env.DIALOGFLOW_PROJECT_ID;
const sessionClient = new SessionsClient();

// Configurações do WhatsApp
const WHATSAPP_API_URL = 'https://graph.facebook.com/v13.0/me/messages';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

// Função para enviar mensagem ao WhatsApp
async function sendWhatsAppMessage(phoneNumber, message) {
  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        text: { body: message },
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('Erro ao enviar mensagem pelo WhatsApp:', error.response?.data || error.message);
    throw error;
  }
}

// Função para detectar intenção no Dialogflow
async function detectIntent(text, sessionId) {
  const sessionPath = sessionClient.projectAgentSessionPath(DIALOGFLOW_PROJECT_ID, sessionId);
  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: text,
        languageCode: 'pt-BR',
      },
    },
  };

  try {
    const [response] = await sessionClient.detectIntent(request);
    return response.queryResult.fulfillmentText;
  } catch (error) {
    console.error('Erro ao detectar intenção no Dialogflow:', error.message);
    throw error;
  }
}

// Rota para receber mensagens do WhatsApp (webhook)
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message) {
      return res.status(400).json({ error: 'Mensagem inválida' });
    }

    const phoneNumber = message.from;
    const messageText = message.text?.body;

    if (!messageText) {
      return res.status(400).json({ error: 'Mensagem sem texto' });
    }

    // Envia a mensagem para o Dialogflow
    const dialogflowResponse = await detectIntent(messageText, 'session-' + phoneNumber);

    // Envia a resposta de volta para o WhatsApp
    await sendWhatsAppMessage(phoneNumber, dialogflowResponse);

    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Rota de teste
app.get('/', (req, res) => {
  res.send('API WhatsApp + Dialogflow está funcionando!');
});

// Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
