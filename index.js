require('dotenv').config(); // Carrega variáveis de ambiente (.env)
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurações do Express
app.use(bodyParser.json()); // Para receber JSON no corpo das requisições

// Rota para receber mensagens do WhatsApp Business API
app.post('/webhook', async (req, res) => {
  try {
    const { message, sender } = req.body; // Supondo que o WhatsApp envia esses dados

    // 1. Envia a mensagem para o Dialogflow
    const dialogflowResponse = await callDialogflow(message);

    // 2. Envia a resposta do Dialogflow de volta para o WhatsApp
    await sendToWhatsApp(sender, dialogflowResponse);

    res.status(200).send('OK');
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).send('Erro interno');
  }
});

// Função para chamar o Dialogflow
async function callDialogflow(message) {
  const response = await axios.post(
    `https://dialogflow.googleapis.com/v2/projects/${process.env.DIALOGFLOW_PROJECT_ID}/agent/sessions/123456:detectIntent`,
    {
      queryInput: {
        text: {
          text: message,
          languageCode: 'pt-BR',
        },
      },
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.DIALOGFLOW_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data.queryResult.fulfillmentText;
}

// Função para enviar mensagem de volta ao WhatsApp
async function sendToWhatsApp(recipient, message) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: recipient,
      text: { body: message },
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
}
           
// Rota para verificação do webhook (Meta valida essa URL)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Verifica se o token bate com o seu "Verify Token"
  if (mode === 'subscribe' && token === process.env.WHATSAPP_ACCESS_TOKEN) {
    console.log('Webhook verificado!');
    res.status(200).send(challenge);
  } else {
    console.error('Falha na verificação do webhook');
    res.sendStatus(403);
  }
});
